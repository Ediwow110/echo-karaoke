-- New rooms use six-character codes. The sixteen-character form stays valid
-- for rooms created before this change, which remain joinable until they expire.
alter table public.rooms drop constraint if exists rooms_code_format_check;
alter table public.rooms add constraint rooms_code_format_check
  check (code ~ '^[0-9A-HJKMNP-TV-Z]{6}$' or code ~ '^[0-9A-HJKMNP-TV-Z]{16}$');

create or replace function public.create_room(
  p_code text,
  p_user_id text,
  p_display_name text,
  p_guest_token text,
  p_host_token text,
  p_name text default 'Karaoke room',
  p_guest_control_locked boolean default false,
  p_guest_playback_locked boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
  v_name text;
  v_limit jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^(?:[0-9A-HJKMNP-TV-Z]{6}|[0-9A-HJKMNP-TV-Z]{16})$' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_display_name is null or char_length(p_display_name) not between 1 and 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_guest_token is null or p_host_token is null
     or char_length(p_guest_token) < 32 or char_length(p_host_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_name := btrim(regexp_replace(coalesce(nullif(btrim(p_name), ''), 'Karaoke room'), '\s+', ' ', 'g'));
  if char_length(v_name) not between 1 and 48 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_limit := public.consume_rate_limit(p_user_id::text, 'create-room', 10, 3600);
  if coalesce((v_limit ->> 'allowed')::boolean, false) is not true then
    raise exception 'ROOM_CREATE_RATE_LIMITED' using errcode = '22023';
  end if;

  insert into public.rooms (
    code, name, guest_control_locked, guest_playback_locked
  )
  values (
    p_code,
    v_name,
    coalesce(p_guest_control_locked, false),
    coalesce(p_guest_playback_locked, true)
  )
  returning * into v_room;

  insert into public.members (room_id, user_id, display_name, guest_token_hash, role)
  values (v_room.id, p_user_id, p_display_name, private.digest_token(p_guest_token), 'host')
  returning * into v_member;

  insert into private.room_host_secrets (room_id, token_hash)
  values (v_room.id, private.digest_token(p_host_token));

  perform private.log_room_event(v_room.id, v_member.id, 'join');

  return jsonb_build_object(
    'roomId', v_room.id,
    'roomCode', v_room.code,
    'roomName', v_room.name,
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'role', v_member.role,
    'guestToken', p_guest_token,
    'hostToken', p_host_token
  );
end;
$$;

revoke all on function public.create_room(text, text, text, text, text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean)
  to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'echo_service') then
    execute 'grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean) to echo_service';
  end if;
end;
$$;
