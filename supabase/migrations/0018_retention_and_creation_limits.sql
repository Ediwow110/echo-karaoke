-- Retention and room-creation abuse controls.
-- Cleanup stays opt-in: nothing in this migration schedules a deletion.

create index if not exists rooms_ended_at_retention_idx
  on public.rooms (ended_at)
  where status = 'ended';

create or replace function public.cleanup_ended_rooms(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_before is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_before > clock_timestamp() - interval '1 day' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.rooms
  where status = 'ended'
    and ended_at <= p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_ended_rooms(timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_ended_rooms(timestamptz) to service_role;

-- The creator names the room and chooses the opening guest permissions.
create or replace function public.create_room(
  p_code text,
  p_user_id uuid,
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
  if p_code is null or p_code !~ '^[0-9A-HJKMNP-TV-Z]{16}$' then
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

  -- Ten rooms per session per hour keeps a single anonymous caller from
  -- minting codes and rows without bound.
  v_limit := public.consume_rate_limit(p_user_id::text, 'create-room', 10, 3600);
  if coalesce((v_limit ->> 'allowed')::boolean, false) is not true then
    raise exception 'ROOM_CREATE_RATE_LIMITED' using errcode = '22023';
  end if;

  insert into public.rooms (code, name, guest_control_locked, guest_playback_locked)
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

revoke all on function public.create_room(text, uuid, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_room(text, uuid, text, text, text, text, boolean, boolean) to service_role;
