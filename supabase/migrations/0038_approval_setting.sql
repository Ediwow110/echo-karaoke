-- 0038: approval is a setting, not a creation-time choice.
--
-- The create form no longer asks: every new room moderates entry, and the host
-- changes their mind from Room settings. Turning it off admits whoever is already
-- waiting, because a doorbell nobody answers is worse than an open door, and a
-- host who switched moderation off is not moderating any more.

create or replace function public.room_set_approval(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_require_approval boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member record;
  v_admitted integer := 0;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_require_approval is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  update public.rooms
  set require_approval = p_require_approval
  where id = p_room_id
  returning * into v_room;

  if not p_require_approval then
    for v_member in
      update public.members
      set status = 'active'
      where room_id = p_room_id
        and status = 'pending'
      returning id, display_name
    loop
      insert into public.room_events (room_id, member_id, event_type, payload)
      values (
        p_room_id, v_member.id, 'approve',
        jsonb_build_object('displayName', v_member.display_name, 'because', 'approval turned off')
      );
      v_admitted := v_admitted + 1;
    end loop;
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'requireApproval', v_room.require_approval,
    'admitted', v_admitted,
    'door', private.room_door(p_room_id)
  );
end;
$$;

revoke all on function public.room_set_approval(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.room_set_approval(uuid, text, text, boolean) to service_role;

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

  execute 'grant execute on function public.room_set_approval(uuid, text, text, boolean) to echo_service';

  raise notice 'runtime role echo_service granted the approval setting';
end;
$$;
