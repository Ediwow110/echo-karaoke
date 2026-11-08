-- 0041: door operations take the room row first, and the host pass alone names
-- the caller who can hand a room over.
--
-- Lock order. join_room locks the rooms row FOR UPDATE and then updates the
-- member row (rejoin rotation). The door operations locked the member row first
-- and then inserted a room_events row, whose composite foreign key takes a KEY
-- SHARE lock on rooms. Host approval racing a rejoin therefore formed a cycle:
-- Postgres aborted one side with 40P01, which surfaced as INTERNAL_ERROR and
-- rolled the approve back. Every function here now locks the room row before
-- any member row and revalidates the host pass afterwards, so a pass revoked
-- while the call waited for the lock cannot still act.
--
-- Transfer identity. 0040 established that a host tab's anonymous identity can
-- be replaced while the host pass keeps working. room_transfer_host still
-- matched the caller row by user id, so after a replacement this was the one
-- host privilege that answered UNAUTHORIZED forever, stranding the room on a
-- tab that could not hand it over. The caller host row is now resolved by role,
-- exactly as vote_toggle does, and the demoted row is rebound to the caller's
-- current identity so the guest pass the transfer returns is usable.

create or replace function public.room_approve_member(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_member_id uuid
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
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_member_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- Cheap rejection before a caller without a valid pass can take a lock.
  v_room := private.require_host(p_room_id, p_host_token);

  -- 0015 order: the room row first, then members. The room_events insert below
  -- needs a KEY SHARE lock on this row; taking the member lock first is the
  -- other half of the cycle join_room closes.
  select r.* into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  -- The pass may have been revoked while this call waited for the lock.
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  select * into v_member
  from public.members m
  where m.id = p_member_id
    and m.room_id = p_room_id
    and m.role = 'guest'
    and m.status = 'pending'
  for update;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  update public.members
  set status = 'active'
  where id = v_member.id
  returning * into v_member;

  insert into public.room_events (room_id, member_id, event_type, payload)
  values (
    p_room_id, v_member.id, 'approve',
    jsonb_build_object('displayName', v_member.display_name)
  );

  return jsonb_build_object(
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'door', private.room_door(p_room_id)
  );
end;
$$;

create or replace function public.room_reject_member(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_member_id uuid
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
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_member_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  select r.* into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  select * into v_member
  from public.members m
  where m.id = p_member_id
    and m.room_id = p_room_id
    and m.role = 'guest'
    and m.status = 'pending'
  for update;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.members where id = v_member.id;

  insert into public.room_events (room_id, member_id, event_type, payload)
  values (
    p_room_id, null, 'reject',
    jsonb_build_object('memberId', v_member.id, 'displayName', v_member.display_name)
  );

  return jsonb_build_object(
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'door', private.room_door(p_room_id)
  );
end;
$$;

create or replace function public.room_set_admissions(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_locked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_locked is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  select r.* into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  update public.rooms
  set admissions_locked = p_locked
  where id = p_room_id
  returning * into v_room;

  return jsonb_build_object(
    'roomId', v_room.id,
    'admissionsLocked', p_locked
  );
end;
$$;

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
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  select r.* into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  -- Revalidate under the lock: a concurrent transfer revokes the old secret,
  -- and the waiting call must not act on a pass that has just died.
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  -- The pass named the caller; the room has exactly one host row. Resolving by
  -- role, not by the anonymous user id, survives an identity replacement.
  select m.* into v_caller
    from public.members m
   where m.room_id = p_room_id
     and m.role = 'host'
     and m.status = 'active'
   limit 1;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_member_id is null or p_member_id = v_caller.id then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- Only someone the room has heard from recently can be handed control, so a
  -- stale roster row cannot become the device nobody can pause.
  -- A host row must be active: a pending host is invisible to the roster and listed at their own door.
  select m.* into v_target
    from public.members m
   where m.id = p_member_id
     and m.room_id = p_room_id
     and m.role = 'guest'
     and m.status = 'active'
     and m.last_seen_at > now() - interval '2 minutes';
  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- Demote first: the one-host index would reject promoting before the current
  -- host gives the role up. Rebind the demoted row to the caller's current
  -- identity when that identity has no other row in this room, so the guest
  -- pass returned below works even after an anonymous session replacement.
  update public.members
     set role = 'guest',
         user_id = case
           when exists (
             select 1 from public.members x
             where x.room_id = p_room_id
               and x.user_id = p_user_id
               and x.id <> v_caller.id
           ) then v_caller.user_id
           else p_user_id
         end,
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
