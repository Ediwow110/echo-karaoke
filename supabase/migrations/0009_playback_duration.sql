-- The host player knows the real video duration. Store it with playback so
-- every phone can show an honest progress bar.

create or replace function private.playback_json(p_room public.rooms)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'currentSongId', p_room.playback_state ->> 'currentSongId',
    'currentVideoId', p_room.playback_state ->> 'currentVideoId',
    'positionSeconds', coalesce((p_room.playback_state ->> 'positionSeconds')::int, 0),
    'durationSeconds', nullif(p_room.playback_state ->> 'durationSeconds', '')::int,
    'isPlaying', coalesce((p_room.playback_state ->> 'isPlaying')::boolean, false),
    'updatedAt', p_room.playback_state ->> 'updatedAt'
  );
$$;

create or replace function private.set_playback(
  p_room_id uuid,
  p_song public.queue_songs,
  p_position_seconds integer,
  p_is_playing boolean
)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_state jsonb;
  v_previous public.rooms;
begin
  select * into v_previous from public.rooms r where r.id = p_room_id;

  if p_song.id is null then
    v_state := jsonb_build_object(
      'currentSongId', null,
      'currentVideoId', null,
      'positionSeconds', 0,
      'durationSeconds', null,
      'isPlaying', false,
      'updatedAt', to_jsonb(now())
    );
  else
    v_state := jsonb_build_object(
      'currentSongId', p_song.id,
      'currentVideoId', p_song.video_id,
      'positionSeconds', greatest(coalesce(p_position_seconds, 0), 0),
      'durationSeconds', null,
      'isPlaying', coalesce(p_is_playing, false),
      'updatedAt', to_jsonb(now())
    );

    -- Pause, resume and start must not throw away a duration the player
    -- already reported for the same video.
    if v_previous.playback_state ->> 'currentSongId' = p_song.id::text then
      v_state := jsonb_set(
        v_state,
        '{durationSeconds}',
        coalesce(v_previous.playback_state -> 'durationSeconds', 'null'::jsonb)
      );
    end if;
  end if;

  update public.rooms r
  set playback_state = v_state
  where r.id = p_room_id
  returning * into v_room;

  return v_room;
end;
$$;

drop function if exists public.playback_report(uuid, uuid, text, integer);

create function public.playback_report(
  p_room_id uuid,
  p_user_id uuid,
  p_host_token text,
  p_position_seconds integer,
  p_duration_seconds integer default null
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

revoke all on function public.playback_report(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.playback_report(uuid, uuid, text, integer, integer) to service_role;
