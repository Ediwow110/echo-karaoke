-- The room member cap is supplied by the service so it can be configured
-- without a migration. Joining locks the room row, so concurrent joins cannot
-- both pass the count check and exceed the cap.

drop function if exists public.join_room(text, text, text, text);

CREATE OR REPLACE FUNCTION public.join_room(
  p_code text,
  p_user_id text,
  p_display_name text,
  p_guest_token text,
  p_member_limit integer DEFAULT 50
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_member public.members;
  v_member_count integer;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_display_name is null or char_length(p_display_name) not between 1 and 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_member_limit is null or p_member_limit < 2 or p_member_limit > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select * into v_room from public.rooms r where r.code = p_code for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND' using errcode = '22023';
  end if;
  if v_room.status = 'ended' then
    raise exception 'ROOM_ENDED' using errcode = '22023';
  end if;

  select * into v_member
  from public.members m
  where m.room_id = v_room.id and m.user_id = p_user_id;

  if found then
    if v_member.role = 'host' then
      raise exception 'HOST_ALREADY_IN_ROOM' using errcode = '22023';
    end if;

    update public.members
    set display_name = p_display_name,
        guest_token_hash = private.digest_token(p_guest_token),
        last_seen_at = now()
    where id = v_member.id
    returning * into v_member;
  else
    select count(*) into v_member_count
    from public.members m
    where m.room_id = v_room.id;

    if v_member_count >= p_member_limit then
      raise exception 'ROOM_FULL' using errcode = '22023';
    end if;

    insert into public.members (room_id, user_id, display_name, guest_token_hash, role)
    values (v_room.id, p_user_id, p_display_name, private.digest_token(p_guest_token), 'guest')
    returning * into v_member;

    perform private.log_room_event(v_room.id, v_member.id, 'join');
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'roomCode', v_room.code,
    'roomName', v_room.name,
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'role', v_member.role,
    'guestToken', p_guest_token
  );
end;
$function$;
revoke all on function public.join_room(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.join_room(text, text, text, text, integer) to service_role;
