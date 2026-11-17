-- A stale guest could revive its member row after a newcomer took the freed
-- slot, so the room exceeded its cap without another join. Apply the same
-- recently-present cap to the revive, and remove the uncapped three-argument
-- overload so the service role cannot bypass it.
drop function if exists public.touch_member(uuid, text, text);

create or replace function public.touch_member(
  p_room_id uuid,
  p_user_id text,
  p_guest_token text,
  p_member_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_room public.rooms;
  v_member_count integer;
begin
  if p_member_limit is null or p_member_limit < 2 or p_member_limit > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);

  if v_member.last_seen_at <= now() - interval '30 seconds' then
    select count(*) into v_member_count
    from public.members m
    where m.room_id = p_room_id
      and m.id <> v_member.id
      and (m.role = 'host' or m.last_seen_at > now() - interval '30 seconds');

    -- The stale member is not in the active count; reviving it must not push
    -- the roster past the same cap join_room enforces.
    if v_member_count >= p_member_limit then
      raise exception 'ROOM_FULL' using errcode = '22023';
    end if;
  end if;

  update public.members
  set last_seen_at = now()
  where id = v_member.id
    and last_seen_at < now() - interval '10 seconds';

  return jsonb_build_object('memberId', v_member.id);
end;
$$;

revoke all on function public.touch_member(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.touch_member(uuid, text, text, integer) to service_role;

do $$
declare
  has_runtime_role boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'echo_service')
    into has_runtime_role;

  if not has_runtime_role then
    raise notice 'echo_service is not present in this database; skipping runtime grant';
    return;
  end if;

  execute 'grant execute on function public.touch_member(uuid, text, text, integer) to echo_service';

  raise notice 'runtime role echo_service can run the capped heartbeat';
end;
$$;
