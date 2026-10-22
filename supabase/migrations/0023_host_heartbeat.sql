-- The host heartbeat must survive an anonymous auth session replacement. The
-- host pass is room-scoped and not bound to the auth user id, so the heartbeat
-- carries the host capability instead of the guest pass.

CREATE OR REPLACE FUNCTION public.touch_host(p_room_id uuid, p_host_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_member public.members;
begin
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  update public.members m
  set last_seen_at = now()
  where m.room_id = p_room_id
    and m.role = 'host'
    and m.last_seen_at < now() - interval '10 seconds';

  select * into v_member
  from public.members m
  where m.room_id = p_room_id
    and m.role = 'host';

  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  return jsonb_build_object('memberId', v_member.id);
end;
$function$;
revoke all on function public.touch_host(uuid, text) from public, anon, authenticated;
grant execute on function public.touch_host(uuid, text) to service_role;

-- A heartbeat must not keep an ended room alive.
CREATE OR REPLACE FUNCTION public.touch_member(p_room_id uuid, p_user_id text, p_guest_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_member public.members;
begin
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);

  update public.members
  set last_seen_at = now()
  where id = v_member.id
    and last_seen_at < now() - interval '10 seconds';

  return jsonb_build_object('memberId', v_member.id);
end;
$function$;
revoke all on function public.touch_member(uuid, text, text) from public, anon, authenticated;
grant execute on function public.touch_member(uuid, text, text) to service_role;
