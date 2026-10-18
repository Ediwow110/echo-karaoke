-- Search needs a cheap access check that returns no room data.

create or replace function public.room_access_check(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_room public.rooms;
begin
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'memberId', v_member.id
  );
end;
$$;

revoke all on function public.room_access_check(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.room_access_check(uuid, uuid, text) to service_role;
