-- Playback state and commands. The host screen is the only player.

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
begin
  if p_song.id is null then
    v_state := jsonb_build_object(
      'currentSongId', null,
      'currentVideoId', null,
      'positionSeconds', 0,
      'isPlaying', false,
      'updatedAt', to_jsonb(now())
    );
  else
    v_state := jsonb_build_object(
      'currentSongId', p_song.id,
      'currentVideoId', p_song.video_id,
      'positionSeconds', greatest(coalesce(p_position_seconds, 0), 0),
      'isPlaying', coalesce(p_is_playing, false),
      'updatedAt', to_jsonb(now())
    );
  end if;

  update public.rooms r
  set playback_state = v_state
  where r.id = p_room_id
  returning * into v_room;

  return v_room;
end;
$$;

create or replace function private.advance_queue(
  p_room public.rooms,
  p_from_song public.queue_songs
)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next public.queue_songs;
  v_room public.rooms;
begin
  if p_from_song.id is not null then
    update public.queue_songs q
    set status = 'played'
    where q.id = p_from_song.id;
  end if;

  select * into v_next
  from public.queue_songs q
  where q.room_id = p_room.id
    and q.status = 'queued'
    and (p_from_song.id is null or q.position > p_from_song.position)
  order by q.position
  limit 1;

  if not found then
    select * into v_next
    from public.queue_songs q
    where q.room_id = p_room.id and q.status = 'queued'
    order by q.position
    limit 1;
  end if;

  if not found then
    return private.set_playback(p_room.id, null::public.queue_songs, 0, false);
  end if;

  update public.queue_songs q set status = 'playing' where q.id = v_next.id;

  v_room := private.set_playback(p_room.id, v_next, 0, true);

  return v_room;
end;
$$;

create or replace function public.playback_command(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text,
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
    perform private.require_guest_controls(v_room, v_member);
  end if;

  perform private.require_live(v_room);

  if v_action not in ('play', 'pause', 'next') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  perform 1 from public.rooms r where r.id = p_room_id for update;

  select * into v_room from public.rooms r where r.id = p_room_id;

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
$$;

create or replace function public.playback_report(
  p_room_id uuid,
  p_user_id uuid,
  p_host_token text,
  p_position_seconds integer
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
  v_state := jsonb_set(v_state, '{updatedAt}', to_jsonb(now()));

  update public.rooms r set playback_state = v_state where r.id = p_room_id
  returning * into v_room;

  return private.playback_json(v_room);
end;
$$;

revoke all on function private.playback_json(public.rooms) from public, anon, authenticated;
revoke all on function private.set_playback(uuid, public.queue_songs, integer, boolean) from public, anon, authenticated;
revoke all on function private.advance_queue(public.rooms, public.queue_songs) from public, anon, authenticated;
revoke all on function public.playback_command(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.playback_report(uuid, uuid, text, integer) from public, anon, authenticated;

grant execute on function public.playback_command(uuid, uuid, text, text, text) to service_role;
grant execute on function public.playback_report(uuid, uuid, text, integer) to service_role;