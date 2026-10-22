-- One active copy of a video per room. A song can return after it has played.

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

  v_position := private.next_queue_position(p_room_id);

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
