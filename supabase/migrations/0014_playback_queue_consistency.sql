-- Serialize playback reports and queue mutations with skips/advances, and keep
-- playback state honest when the queue is cleared or its current song is removed.

create or replace function public.playback_report(
  p_room_id uuid,
  p_user_id uuid,
  p_host_token text,
  p_position_seconds integer,
  p_duration_seconds integer default null,
  p_song_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.queue_remove(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text,
  p_host_token text,
  p_song_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

create or replace function public.host_command(
  p_room_id uuid,
  p_user_id uuid,
  p_host_token text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
