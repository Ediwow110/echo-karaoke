-- Authorization checks happen before the room lock, so revalidate the room
-- and its guest controls after the lock is held. The queue limit is counted
-- after that lock as well; otherwise parallel requests can all pass it.

create or replace function public.queue_add(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text,
  p_host_token text,
  p_video_id text,
  p_title text,
  p_channel_title text default null,
  p_thumbnail_url text default null,
  p_duration_seconds integer default null
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
$$;
