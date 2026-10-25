-- Transfer host: the person running a room can hand control to a guest who is
-- actually present.
--
-- Why this is two calls and not one. Host authority is a single shared secret
-- kept only as a digest (private.room_host_secrets.token_hash), so the database
-- cannot reveal it later, and the only device that can ever be handed the
-- plaintext is the one that minted it. If transfer returned the new secret, it
-- would go to the outgoing host, who is exactly the person losing it. So
-- room_transfer_host revokes the current secret and flips the roles, and the
-- promoted member calls room_claim_host with the guest credential they already
-- hold, which mints a secret that never passes through any other device.
--
-- The gap between the two is a second or two of nobody holding a host pass.
-- That is deliberate: an unusable window is safer than a moment where two
-- devices can both skip the song.

-- 'transfer_host' is a new event type, and room_events constrains the vocabulary.
alter table public.room_events
  drop constraint room_events_type_check;
alter table public.room_events
  add constraint room_events_type_check check (
    event_type in (
      'join', 'add', 'remove', 'reorder', 'skip', 'vote', 'end',
      'clear_queue', 'lock', 'unlock', 'transfer_host'
    )
  );

-- Two host rows would mean two valid claims on one room. Until now this was a
-- convention that nothing enforced; production was checked to satisfy it first.
create unique index members_one_host_per_room
  on public.members (room_id) where role = 'host';

create or replace function public.room_transfer_host(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_member_id uuid,
  p_guest_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller public.members;
  v_target public.members;
begin
  if p_guest_token is null or char_length(p_guest_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  select m.* into v_caller
    from public.members m
   where m.room_id = p_room_id
     and m.user_id = p_user_id
     and m.role = 'host';
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_member_id is null or p_member_id = v_caller.id then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- Only someone the room has heard from recently can be handed control, so a
  -- stale roster row cannot become the device nobody can pause.
  select m.* into v_target
    from public.members m
   where m.id = p_member_id
     and m.room_id = p_room_id
     and m.role = 'guest'
     and m.last_seen_at > now() - interval '2 minutes';
  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- Demote first: the one-host index would reject promoting before the current
  -- host gives the role up.
  update public.members
     set role = 'guest',
         guest_token_hash = private.digest_token(p_guest_token),
         last_seen_at = now()
   where id = v_caller.id;

  update public.members
     set role = 'host'
   where id = v_target.id;

  -- Replace the secret with a digest of a value nobody holds. The outgoing host
  -- loses the ability to act immediately, and there is nothing to leak.
  update private.room_host_secrets
     set token_hash = private.digest_token('revoked:' || gen_random_uuid()::text)
   where room_id = p_room_id;
  if not found then
    raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
  end if;

  insert into public.room_events (room_id, member_id, event_type, payload)
  values (
    p_room_id, v_caller.id, 'transfer_host',
    jsonb_build_object('toMemberId', v_target.id, 'toDisplayName', v_target.display_name)
  );

  return jsonb_build_object(
    'roomId', p_room_id,
    'role', 'guest',
    'guestToken', p_guest_token,
    'newHost', jsonb_build_object(
      'memberId', v_target.id,
      'displayName', v_target.display_name
    )
  );
end;
$$;

create or replace function public.room_claim_host(
  p_room_id uuid,
  p_user_id text,
  p_guest_token text,
  p_host_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
begin
  if p_guest_token is null or char_length(p_guest_token) < 32
    or p_host_token is null or char_length(p_host_token) < 32 then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  select r.* into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);

  select m.* into v_member
    from public.members m
   where m.room_id = p_room_id
     and m.user_id = p_user_id
     and m.guest_token_hash = private.digest_token(p_guest_token);
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  -- The role is the whole authorization: only the member the room was just
  -- transferred to can mint its new host pass.
  if v_member.role <> 'host' then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  update private.room_host_secrets
     set token_hash = private.digest_token(p_host_token)
   where room_id = p_room_id;
  if not found then
    raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'roomId', p_room_id,
    'memberId', v_member.id,
    'hostToken', p_host_token
  );
end;
$$;

revoke all on function public.room_transfer_host(uuid, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.room_claim_host(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.room_transfer_host(uuid, text, text, uuid, text) to service_role;
grant execute on function public.room_claim_host(uuid, text, text, text) to service_role;

-- echo_service is the role the deployed function connects as and it exists only
-- on Neon, so these grants are guarded the same way 0034 guards its own. Without
-- them every transfer answers 500 with SQLSTATE 42501 while pgTAP stays green.
do $$
declare
  has_runtime_role boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'echo_service')
    into has_runtime_role;

  if not has_runtime_role then
    raise notice 'echo_service is not present in this database; skipping runtime grants';
    return;
  end if;

  execute 'grant execute on function public.room_transfer_host(uuid, text, text, uuid, text) to echo_service';
  execute 'grant execute on function public.room_claim_host(uuid, text, text, text) to echo_service';

  raise notice 'runtime role echo_service granted the host-transfer surface';
end;
$$;
