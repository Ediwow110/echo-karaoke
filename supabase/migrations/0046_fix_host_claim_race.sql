-- Serialize claims with transfers. room_transfer_host holds the room lock
-- while it demotes the caller and revokes the host secret. A claim that reads
-- the old host role before that commit and then waits on the secret row can
-- overwrite the revoked secret with a pass of its own. Taking the room lock
-- before the member read makes the claim wait behind the transfer and see the
-- committed demotion instead.

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
  if p_room_id is null
    or p_user_id is null
    or p_guest_token is null
    or p_host_token is null
    or char_length(p_guest_token) < 32
    or char_length(p_host_token) < 32 then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  -- Same lock order as room_transfer_host: room first, then member/secret.
  -- The member read below is a second statement, so under READ COMMITTED it
  -- sees the transfer once this lock is released.
  select r.* into v_room
    from public.rooms r
   where r.id = p_room_id
   for update;
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

revoke all on function public.room_claim_host(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.room_claim_host(uuid, text, text, text) to service_role;

-- echo_service is the deployed runtime login on Neon. Mirror 0035's guarded
-- grant so the new definition is callable after the migration runs.
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

  execute 'grant execute on function public.room_claim_host(uuid, text, text, text) to echo_service';
end;
$$;
