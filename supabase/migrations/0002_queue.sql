-- Queue operations. Every entry point is a server-only function that
-- rechecks the caller capability because the service role bypasses RLS.

create or replace function private.next_queue_position(p_room_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_next bigint;
begin
  -- Locking the room row serialises concurrent additions for this room.
  perform 1 from public.rooms r where r.id = p_room_id for update;

  select coalesce(max(q.position), 0) + 1 into v_next
  from public.queue_songs q
  where q.room_id = p_room_id;

  return v_next;
end;
$$;

create or replace function private.queue_song_json(p_song_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'songId', q.id,
    'videoId', q.video_id,
    'title', q.title,
    'channelTitle', q.channel_title,
    'thumbnailUrl', q.thumbnail_url,
    'durationSeconds', q.duration_seconds,
    'status', q.status,
    'position', q.position,
    'memberId', q.member_id,
    'addedBy', m.display_name,
    'voteCount', (select count(*) from public.votes v where v.queue_song_id = q.id)
  )
  from public.queue_songs q
  join public.members m on m.id = q.member_id
  where q.id = p_song_id;
$$;

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
  v_member public.members;
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
    v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
    select * into v_room from public.rooms r where r.id = p_room_id;
    perform private.require_guest_controls(v_room, v_member);
  end if;

  perform private.require_live(v_room);

  select * into v_song from public.queue_songs q
  where q.id = p_song_id and q.room_id = p_room_id;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  if v_is_host = false and v_song.member_id <> v_member.id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  delete from public.queue_songs where id = v_song.id;

  perform private.log_room_event(p_room_id, v_song.member_id, 'remove');

  return jsonb_build_object('songId', v_song.id, 'removed', true);
end;
$$;

create or replace function public.queue_reorder(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text,
  p_host_token text,
  p_song_id uuid,
  p_direction text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
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
    v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
    select * into v_room from public.rooms r where r.id = p_room_id;
    perform private.require_guest_controls(v_room, v_member);
  end if;

  perform private.require_live(v_room);

  if p_direction not in ('up', 'down') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  perform 1 from public.rooms r where r.id = p_room_id for update;

  select * into v_song from public.queue_songs q
  where q.id = p_song_id and q.room_id = p_room_id;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  if v_is_host = false and v_song.member_id <> v_member.id then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_direction = 'up' then
    select * into v_neighbour from public.queue_songs q
    where q.room_id = p_room_id and q.position < v_song.position
    order by q.position desc limit 1;
  else
    select * into v_neighbour from public.queue_songs q
    where q.room_id = p_room_id and q.position > v_song.position
    order by q.position asc limit 1;
  end if;

  if not found then
    return private.queue_song_json(v_song.id);
  end if;

  v_target := v_song.position;
  v_neighbour_position := v_neighbour.position;
  v_offset := (select coalesce(max(q.position), 0) from public.queue_songs q where q.room_id = p_room_id) + 1000;

  -- Park the moving song above every stored position so the unique key never collides.
  update public.queue_songs set position = v_offset where id = v_song.id;
  update public.queue_songs set position = v_target where id = v_neighbour.id;
  update public.queue_songs set position = v_neighbour_position where id = v_song.id;

  perform private.log_room_event(p_room_id, v_song.member_id, 'reorder');

  return private.queue_song_json(v_song.id);
end;
$$;

create or replace function public.queue_read(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
  return private.room_queue(p_room_id);
end;
$$;

revoke all on function private.next_queue_position(uuid) from public, anon, authenticated;
revoke all on function private.queue_song_json(uuid) from public, anon, authenticated;

revoke all on function public.queue_add(uuid, uuid, text, text, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.queue_remove(uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.queue_reorder(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke all on function public.queue_read(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.queue_add(uuid, uuid, text, text, text, text, text, text, integer) to service_role;
grant execute on function public.queue_remove(uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.queue_reorder(uuid, uuid, text, text, uuid, text) to service_role;
grant execute on function public.queue_read(uuid, uuid, text) to service_role;