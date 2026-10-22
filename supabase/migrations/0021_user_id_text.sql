-- The auth identity issues a string user id, so the member user id and
-- every operation parameter that carries one become text. The dropped
-- functions are recreated with the same bodies and non-user arguments.
alter table public.members alter column user_id type text using user_id::text;

drop function if exists public.create_room(text, uuid, text, text, text, text, boolean, boolean);
drop function if exists public.host_access_check(uuid, uuid, text);
drop function if exists public.host_command(uuid, uuid, text, text);
drop function if exists public.join_room(text, uuid, text, text);
drop function if exists public.playback_command(uuid, uuid, text, text, text);
drop function if exists public.playback_report(uuid, uuid, text, integer, integer, uuid);
drop function if exists public.queue_add(uuid, uuid, text, text, text, text, text, text, integer);
drop function if exists public.queue_read(uuid, uuid, text);
drop function if exists public.queue_remove(uuid, uuid, text, text, uuid);
drop function if exists public.queue_reorder(uuid, uuid, text, text, uuid, text);
drop function if exists public.read_room_guest(uuid, uuid, text);
drop function if exists public.read_room_host(uuid, uuid, text);
drop function if exists public.room_access_check(uuid, uuid, text);
drop function if exists public.touch_member(uuid, uuid, text);
drop function if exists public.vote_toggle(uuid, uuid, text, uuid);
drop function if exists private.require_guest(uuid, uuid, text);

CREATE OR REPLACE FUNCTION private.require_guest(p_room_id uuid, p_user_id text, p_guest_token text)
 RETURNS members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.members;
begin
  if p_guest_token is null or char_length(p_guest_token) < 32 or p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  select * into v_member
  from public.members m
  where m.room_id = p_room_id
    and m.user_id = p_user_id
    and m.guest_token_hash = private.digest_token(p_guest_token);

  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  return v_member;
end;
$function$;
revoke all on function private.require_guest(uuid, text, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_room(p_code text, p_user_id text, p_display_name text, p_guest_token text, p_host_token text, p_name text DEFAULT 'Karaoke room'::text, p_guest_control_locked boolean DEFAULT false, p_guest_playback_locked boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public.create_room(text, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean) to service_role;

CREATE OR REPLACE FUNCTION public.host_access_check(p_room_id uuid, p_user_id text, p_host_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status
  );
end;
$function$;
revoke all on function public.host_access_check(uuid, text, text) from public, anon, authenticated;
grant execute on function public.host_access_check(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.host_command(p_room_id uuid, p_user_id text, p_host_token text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  if p_action = 'end' then
    perform private.require_live(v_room);
    update public.rooms
    set status = 'ended', ended_at = now()
    where id = v_room.id
    returning * into v_room;
    perform private.log_room_event(v_room.id, null, 'end');
  elsif p_action = 'lock' then
    perform private.require_live(v_room);
    update public.rooms set guest_control_locked = true where id = v_room.id
    returning * into v_room;
    perform private.log_room_event(v_room.id, null, 'lock');
  elsif p_action = 'unlock' then
    perform private.require_live(v_room);
    update public.rooms set guest_control_locked = false where id = v_room.id
    returning * into v_room;
    perform private.log_room_event(v_room.id, null, 'unlock');
  elsif p_action = 'lock_playback' then
    perform private.require_live(v_room);
    update public.rooms set guest_playback_locked = true where id = v_room.id
    returning * into v_room;
    perform private.log_room_event(v_room.id, null, 'lock');
  elsif p_action = 'unlock_playback' then
    perform private.require_live(v_room);
    update public.rooms set guest_playback_locked = false where id = v_room.id
    returning * into v_room;
    perform private.log_room_event(v_room.id, null, 'unlock');
  elsif p_action = 'clear_queue' then
    select * into v_room from public.rooms r where r.id = p_room_id for update;
    perform private.require_live(v_room);
    delete from public.queue_songs where room_id = v_room.id;
    update public.rooms r
    set playback_state = jsonb_build_object(
      'currentSongId', null,
      'currentVideoId', null,
      'positionSeconds', 0,
      'durationSeconds', null,
      'isPlaying', false,
      'updatedAt', to_jsonb(now())
    )
    where r.id = v_room.id
    returning * into v_room;
    perform private.log_room_event(v_room.id, null, 'clear_queue');
  else
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'guestControlLocked', v_room.guest_control_locked,
    'guestPlaybackLocked', v_room.guest_playback_locked
  );
end;
$function$;
revoke all on function public.host_command(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.host_command(uuid, text, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.join_room(p_code text, p_user_id text, p_display_name text, p_guest_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public.join_room(text, text, text, text) from public, anon, authenticated;
grant execute on function public.join_room(text, text, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.playback_command(p_room_id uuid, p_user_id text, p_guest_token text, p_host_token text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_member public.members;
  v_is_host boolean := false;
  v_current public.queue_songs;
  v_actor uuid;
  v_action text := lower(coalesce(p_action, ''));
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_host_token is not null then
    v_room := private.require_host(p_room_id, p_host_token);
    v_is_host := true;
  else
    v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
    select * into v_room from public.rooms r where r.id = p_room_id;
  end if;

  perform private.require_live(v_room);

  if v_action not in ('play', 'pause', 'next') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  if not v_is_host then
    if v_action = 'next' then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if v_room.guest_playback_locked then
      raise exception 'GUEST_CONTROLS_LOCKED' using errcode = '22023';
    end if;
  end if;

  perform 1 from public.rooms r where r.id = p_room_id for update;

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);
  if not v_is_host then
    if v_room.guest_playback_locked then
      raise exception 'GUEST_CONTROLS_LOCKED' using errcode = '22023';
    end if;
  end if;

  if (v_room.playback_state ->> 'currentSongId') is not null then
    select * into v_current
    from public.queue_songs q
    where q.id = (v_room.playback_state ->> 'currentSongId')::uuid;
  end if;

  if v_action = 'play' then
    if v_current.id is null then
      v_room := private.advance_queue(v_room, null::public.queue_songs);
    else
      update public.queue_songs q set status = 'playing' where q.id = v_current.id;
      v_room := private.set_playback(
        p_room_id,
        v_current,
        coalesce((v_room.playback_state ->> 'positionSeconds')::int, 0),
        true
      );
    end if;
  elsif v_action = 'pause' then
    v_room := private.set_playback(
      p_room_id,
      v_current,
      coalesce((v_room.playback_state ->> 'positionSeconds')::int, 0),
      false
    );
  else
    v_room := private.advance_queue(v_room, v_current);
    if v_is_host then
      v_actor := null;
    else
      v_actor := v_member.id;
    end if;
    perform private.log_room_event(p_room_id, v_actor, 'skip');
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'playback', private.playback_json(v_room)
  );
end;
$function$;
revoke all on function public.playback_command(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.playback_command(uuid, text, text, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.playback_report(p_room_id uuid, p_user_id text, p_host_token text, p_position_seconds integer, p_duration_seconds integer DEFAULT NULL::integer, p_song_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_state jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  -- A skip or auto-advance may commit while this report is in flight. Lock the
  -- room and re-read the state so a late report cannot restore the old video.
  select * into v_room from public.rooms r where r.id = p_room_id for update;
  perform private.require_live(v_room);

  if p_song_id is not null
     and (v_room.playback_state ->> 'currentSongId') is distinct from p_song_id::text then
    return private.playback_json(v_room);
  end if;

  v_state := v_room.playback_state;
  v_state := jsonb_set(v_state, '{positionSeconds}', to_jsonb(greatest(coalesce(p_position_seconds, 0), 0)));
  if p_duration_seconds is not null and p_duration_seconds > 0 then
    v_state := jsonb_set(v_state, '{durationSeconds}', to_jsonb(p_duration_seconds));
  end if;
  v_state := jsonb_set(v_state, '{updatedAt}', to_jsonb(now()));

  update public.rooms r set playback_state = v_state where r.id = p_room_id
  returning * into v_room;

  return private.playback_json(v_room);
end;
$function$;
revoke all on function public.playback_report(uuid, text, text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.playback_report(uuid, text, text, integer, integer, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.queue_add(p_room_id uuid, p_user_id text, p_guest_token text, p_host_token text, p_video_id text, p_title text, p_channel_title text DEFAULT NULL::text, p_thumbnail_url text DEFAULT NULL::text, p_duration_seconds integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_member public.members;
  v_is_host boolean := false;
  v_recent integer;
  v_position bigint;
  v_song public.queue_songs;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_host_token is not null then
    v_room := private.require_host(p_room_id, p_host_token);
    v_is_host := true;

    select * into v_member
    from public.members m
    where m.room_id = p_room_id and m.role = 'host'
    order by m.joined_at
    limit 1;

    if not found then
      raise exception 'UNAUTHORIZED' using errcode = '28000';
    end if;
  else
    v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
    select * into v_room from public.rooms r where r.id = p_room_id;
    perform private.require_guest_controls(v_room, v_member);
  end if;

  perform private.require_live(v_room);

  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_title is null or char_length(p_title) not between 1 and 500 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- This call holds the room row lock until the transaction finishes.
  v_position := private.next_queue_position(p_room_id);

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);
  if v_is_host = false then
    perform private.require_guest_controls(v_room, v_member);
  end if;

  if exists (
    select 1 from public.queue_songs q
    where q.room_id = p_room_id
      and q.video_id = p_video_id
      and q.status in ('queued', 'playing')
  ) then
    raise exception 'DUPLICATE_SONG' using errcode = '22023';
  end if;

  if v_is_host = false then
    select count(*) into v_recent
    from public.queue_songs q
    where q.member_id = v_member.id
      and q.created_at > now() - interval '1 minute';

    if v_recent >= 5 then
      raise exception 'RATE_LIMITED' using errcode = '22023';
    end if;
  end if;

  insert into public.queue_songs (
    room_id, member_id, video_id, title, channel_title, thumbnail_url, duration_seconds, position
  )
  values (
    p_room_id, v_member.id, p_video_id, p_title, p_channel_title, p_thumbnail_url, p_duration_seconds, v_position
  )
  returning * into v_song;

  perform private.log_room_event(p_room_id, v_member.id, 'add');

  return private.queue_song_json(v_song.id);
end;
$function$;
revoke all on function public.queue_add(uuid, text, text, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.queue_add(uuid, text, text, text, text, text, text, text, integer) to service_role;

CREATE OR REPLACE FUNCTION public.queue_read(p_room_id uuid, p_user_id text, p_guest_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.members;
begin
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
  return private.room_queue(p_room_id);
end;
$function$;
revoke all on function public.queue_read(uuid, text, text) from public, anon, authenticated;
grant execute on function public.queue_read(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.queue_remove(p_room_id uuid, p_user_id text, p_guest_token text, p_host_token text, p_song_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_song public.queue_songs;
  v_is_host boolean := false;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_host_token is not null then
    v_room := private.require_host(p_room_id, p_host_token);
    v_is_host := true;
  else
    perform private.require_guest(p_room_id, p_user_id, p_guest_token);
    select * into v_room from public.rooms r where r.id = p_room_id;
  end if;

  perform private.require_live(v_room);

  if not v_is_host then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- The song may become current between the host's click and this request.
  select * into v_room from public.rooms r where r.id = p_room_id for update;
  perform private.require_live(v_room);

  select * into v_song from public.queue_songs q
  where q.id = p_song_id and q.room_id = p_room_id;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  if (v_room.playback_state ->> 'currentSongId') = v_song.id::text then
    raise exception 'SONG_PLAYING' using errcode = '22023';
  end if;

  delete from public.queue_songs where id = v_song.id;

  perform private.log_room_event(p_room_id, v_song.member_id, 'remove');

  return jsonb_build_object('songId', v_song.id, 'removed', true);
end;
$function$;
revoke all on function public.queue_remove(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.queue_remove(uuid, text, text, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.queue_reorder(p_room_id uuid, p_user_id text, p_guest_token text, p_host_token text, p_song_id uuid, p_direction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_song public.queue_songs;
  v_neighbour public.queue_songs;
  v_is_host boolean := false;
  v_target bigint;
  v_neighbour_position bigint;
  v_offset bigint;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_host_token is not null then
    v_room := private.require_host(p_room_id, p_host_token);
    v_is_host := true;
  else
    perform private.require_guest(p_room_id, p_user_id, p_guest_token);
    select * into v_room from public.rooms r where r.id = p_room_id;
  end if;

  perform private.require_live(v_room);

  if not v_is_host then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_direction not in ('up', 'down') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select * into v_room from public.rooms r where r.id = p_room_id for update;
  perform private.require_live(v_room);

  select * into v_song from public.queue_songs q
  where q.id = p_song_id and q.room_id = p_room_id and q.status = 'queued';

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  if p_direction = 'up' then
    select * into v_neighbour from public.queue_songs q
    where q.room_id = p_room_id
      and q.status = 'queued'
      and q.position < v_song.position
    order by q.position desc limit 1;
  else
    select * into v_neighbour from public.queue_songs q
    where q.room_id = p_room_id
      and q.status = 'queued'
      and q.position > v_song.position
    order by q.position asc limit 1;
  end if;

  if not found then
    return private.queue_song_json(v_song.id);
  end if;

  v_target := v_song.position;
  v_neighbour_position := v_neighbour.position;
  v_offset := (select coalesce(max(q.position), 0) from public.queue_songs q where q.room_id = p_room_id) + 1000;

  update public.queue_songs set position = v_offset where id = v_song.id;
  update public.queue_songs set position = v_target where id = v_neighbour.id;
  update public.queue_songs set position = v_neighbour_position where id = v_song.id;

  perform private.log_room_event(p_room_id, v_song.member_id, 'reorder');

  return private.queue_song_json(v_song.id);
end;
$function$;
revoke all on function public.queue_reorder(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.queue_reorder(uuid, text, text, text, uuid, text) to service_role;

CREATE OR REPLACE FUNCTION public.read_room_guest(p_room_id uuid, p_user_id text, p_guest_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.members;
  v_room public.rooms;
begin
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if v_room.status = 'ended' then
    return jsonb_build_object(
      'roomId', v_room.id,
      'status', 'ended',
      'endedAt', v_room.ended_at
    );
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'room', jsonb_build_object(
      'id', v_room.id,
      'code', v_room.code,
      'name', v_room.name,
      'status', v_room.status,
      'guestControlLocked', v_room.guest_control_locked,
      'guestPlaybackLocked', v_room.guest_playback_locked,
      'createdAt', v_room.created_at
    ),
    'viewer', jsonb_build_object(
      'memberId', v_member.id,
      'displayName', v_member.display_name,
      'role', v_member.role
    ),
    'roster', private.room_roster(v_room.id),
    'queue', private.room_queue(v_room.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$function$;
revoke all on function public.read_room_guest(uuid, text, text) from public, anon, authenticated;
grant execute on function public.read_room_guest(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.read_room_host(p_room_id uuid, p_user_id text, p_host_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'room', jsonb_build_object(
      'id', v_room.id,
      'code', v_room.code,
      'name', v_room.name,
      'status', v_room.status,
      'guestControlLocked', v_room.guest_control_locked,
      'guestPlaybackLocked', v_room.guest_playback_locked,
      'createdAt', v_room.created_at,
      'endedAt', v_room.ended_at
    ),
    'roster', private.room_roster(v_room.id),
    'queue', private.room_queue(v_room.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$function$;
revoke all on function public.read_room_host(uuid, text, text) from public, anon, authenticated;
grant execute on function public.read_room_host(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.room_access_check(p_room_id uuid, p_user_id text, p_guest_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public.room_access_check(uuid, text, text) from public, anon, authenticated;
grant execute on function public.room_access_check(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.touch_member(p_room_id uuid, p_user_id text, p_guest_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_member public.members;
begin
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  update public.members
  set last_seen_at = now()
  where id = v_member.id
    and last_seen_at < now() - interval '10 seconds';

  return jsonb_build_object('memberId', v_member.id);
end;
$function$;
revoke all on function public.touch_member(uuid, text, text) from public, anon, authenticated;
grant execute on function public.touch_member(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION public.vote_toggle(p_room_id uuid, p_user_id text, p_guest_token text, p_song_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_member public.members;
  v_song public.queue_songs;
  v_exists public.votes;
  v_count integer;
  v_was_voted boolean;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  perform private.require_live(v_room);
  perform private.require_guest_controls(v_room, v_member);

  select * into v_song from public.queue_songs q
  where q.id = p_song_id and q.room_id = p_room_id;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select * into v_exists from public.votes v
  where v.queue_song_id = p_song_id and v.member_id = v_member.id;

  v_was_voted := found;

  if v_was_voted then
    delete from public.votes where id = v_exists.id;
  else
    insert into public.votes (room_id, queue_song_id, member_id)
    values (p_room_id, p_song_id, v_member.id);
  end if;

  select count(*) into v_count from public.votes v where v.queue_song_id = p_song_id;

  perform private.log_room_event(p_room_id, v_member.id, 'vote');

  return jsonb_build_object(
    'songId', p_song_id,
    'voteCount', v_count,
    'votedByViewer', not v_was_voted
  );
end;
$function$;
revoke all on function public.vote_toggle(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.vote_toggle(uuid, text, text, uuid) to service_role;
