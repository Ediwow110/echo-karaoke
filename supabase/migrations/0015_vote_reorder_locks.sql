-- Keep every mutator on the same lock order: room row first, then queue/votes.
-- This prevents vote/remove deadlocks and stops reorders on an ended room.

create or replace function public.vote_toggle(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text,
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
$$;
