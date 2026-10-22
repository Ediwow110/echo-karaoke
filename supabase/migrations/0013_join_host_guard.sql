-- A host who opens their own invite in the same browser shares the anonymous
-- auth user behind the host member row. Joining must not rename that row or
-- replace its guest token hash, or the host identity becomes a guest remote.
create or replace function public.join_room(
  p_code text,
  p_user_id uuid,
  p_display_name text,
  p_guest_token text
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
  if p_display_name is null or char_length(p_display_name) not between 1 and 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select * into v_room from public.rooms r where r.code = p_code;
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
$$;
