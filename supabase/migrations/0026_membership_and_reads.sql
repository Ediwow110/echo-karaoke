-- Count only recently present members against the room cap, let the host remove
-- a guest, reject votes on finished songs, and aggregate vote counts once per
-- room read instead of once per song.

create or replace function public.join_room(
  p_code text,
  p_user_id text,
  p_display_name text,
  p_guest_token text,
  p_member_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
  v_member_count integer;
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
  if p_member_limit is null or p_member_limit < 2 or p_member_limit > 500 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select * into v_room from public.rooms r where r.code = p_code for update;
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

    -- A stale guest returning is a new occupancy decision. An active guest
    -- returning keeps the fast path.
    if v_member.last_seen_at <= now() - interval '30 seconds' then
      select count(*) into v_member_count
      from public.members m
      where m.room_id = v_room.id
        and (m.role = 'host' or m.last_seen_at > now() - interval '30 seconds');

      if v_member_count >= p_member_limit then
        raise exception 'ROOM_FULL' using errcode = '22023';
      end if;
    end if;

    update public.members
    set display_name = p_display_name,
        guest_token_hash = private.digest_token(p_guest_token),
        last_seen_at = now()
    where id = v_member.id
    returning * into v_member;
  else
    -- A guest whose tab closed no longer occupies a slot. Their row and queue
    -- history stay until the room is deleted or the host removes them. The host
    -- always occupies a slot, even when its last heartbeat is stale.
    select count(*) into v_member_count
    from public.members m
    where m.room_id = v_room.id
      and (m.role = 'host' or m.last_seen_at > now() - interval '30 seconds');

    if v_member_count >= p_member_limit then
      raise exception 'ROOM_FULL' using errcode = '22023';
    end if;

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
$$;
revoke all on function public.join_room(text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.join_room(text, text, text, text, integer)
  to service_role;

create or replace function public.host_remove_member(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_member_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  select * into v_member
  from public.members m
  where m.id = p_member_id
    and m.room_id = p_room_id
    and m.role = 'guest';

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.members where id = v_member.id;

  perform private.log_room_event(
    p_room_id,
    null,
    'remove',
    jsonb_build_object('memberId', p_member_id)
  );

  return jsonb_build_object('memberId', p_member_id, 'removed', true);
end;
$$;
revoke all on function public.host_remove_member(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.host_remove_member(uuid, text, text, uuid)
  to service_role;

create or replace function public.vote_toggle(
  p_room_id uuid,
  p_user_id text,
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
  where q.id = p_song_id
    and q.room_id = p_room_id
    and q.status in ('queued', 'playing');

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
revoke all on function public.vote_toggle(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.vote_toggle(uuid, text, text, uuid)
  to service_role;

create or replace function private.room_queue(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
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
        'voteCount', coalesce(v.vote_count, 0)
      )
      order by q.position
    ),
    '[]'::jsonb
  )
  from public.queue_songs q
  join public.members m on m.id = q.member_id
  left join (
    select v.queue_song_id, count(*)::integer as vote_count
    from public.votes v
    where v.room_id = p_room_id
    group by v.queue_song_id
  ) v on v.queue_song_id = q.id
  where q.room_id = p_room_id
    and q.status in ('queued', 'playing');
$$;
revoke all on function private.room_queue(uuid) from public, anon, authenticated;
