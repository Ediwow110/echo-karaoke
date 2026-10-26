-- 0039: the queue projection carries the viewer's own vote.
--
-- A vote control has to show whether this device already pressed it. The
-- toggle answers that at the moment of the click, but the next four-second read
-- replaces the whole queue, and a count alone cannot say whose count it is. So
-- the read carries the flag: room_queue grows a member parameter and the three
-- functions that project the queue pass the viewer they already authenticated.

create or replace function private.room_queue(p_room_id uuid, p_member_id uuid)
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
        'voteCount', coalesce(v.vote_count, 0),
        -- NULL viewer means nobody to attribute a vote to, which is the same
        -- answer as a viewer who has not voted: nothing is pressed.
        'votedByViewer', p_member_id is not null and exists (
          select 1 from public.votes mine
          where mine.queue_song_id = q.id
            and mine.member_id = p_member_id
        )
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
revoke all on function private.room_queue(uuid, uuid) from public, anon, authenticated;
grant execute on function private.room_queue(uuid, uuid) to service_role;

-- read_room_guest, copied from 0037 with the viewer passed to the projection.
-- create or replace keeps the grants 0037 gave this signature, so the runtime
-- role still reaches it; the guarded block at the bottom re-proves that.
create or replace function public.read_room_guest(
  p_room_id uuid,
  p_user_id text,
  p_guest_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
  v_room public.rooms;
begin
  -- The permissive check on purpose: a waiting guest must be able to read this,
  -- because this is how they learn they are waiting.
  v_member := private.require_guest_any(p_room_id, p_user_id, p_guest_token);

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

  if v_member.status = 'pending' then
    return jsonb_build_object(
      'roomId', v_room.id,
      'status', 'waiting',
      'room', jsonb_build_object(
        'id', v_room.id,
        'name', v_room.name,
        'hostName', coalesce(
          (select m.display_name from public.members m
           where m.room_id = v_room.id and m.role = 'host' limit 1),
          'the host'
        )
      ),
      'viewer', jsonb_build_object(
        'memberId', v_member.id,
        'displayName', v_member.display_name,
        'role', v_member.role,
        'status', v_member.status
      )
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
      'requireApproval', v_room.require_approval,
      'admissionsLocked', v_room.admissions_locked,
      'createdAt', v_room.created_at
    ),
    'viewer', jsonb_build_object(
      'memberId', v_member.id,
      'displayName', v_member.display_name,
      'role', v_member.role,
      'status', v_member.status
    ),
    'roster', private.room_roster(v_room.id),
    'queue', private.room_queue(v_room.id, v_member.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

-- read_room_host, copied from 0037 with the host's own member row resolved.
create or replace function public.read_room_host(
  p_room_id uuid,
  p_user_id text,
  p_host_token text
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
      'requireApproval', v_room.require_approval,
      'admissionsLocked', v_room.admissions_locked,
      'createdAt', v_room.created_at,
      'endedAt', v_room.ended_at
    ),
    'roster', private.room_roster(v_room.id),
    'door', private.room_door(v_room.id),
    'queue', private.room_queue(v_room.id, (
      select m.id from public.members m
      where m.room_id = v_room.id and m.user_id = p_user_id
      limit 1
    )),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

-- queue_read, copied from 0021 with the viewer passed to the projection.
create or replace function public.queue_read(
  p_room_id uuid,
  p_user_id text,
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
  return private.room_queue(p_room_id, v_member.id);
end;
$$;

-- Nothing may project the queue without saying whose view it is. The one-
-- argument form is dropped rather than left as a wrapper so a future caller
-- cannot quietly ask for a queue with no viewer attached.
drop function private.room_queue(uuid);

-- Prove the runtime role still reaches the reads. Their signatures did not
-- change, so create or replace kept 0037's grants; this block is the guard for
-- a database where the role exists and for re-running the chain from scratch.
do $$
declare
  has_runtime_role boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'echo_service')
    into has_runtime_role;

  if not has_runtime_role then
    raise notice 'echo_service is not present in this database; skipping runtime grants';
    return;
  end if;

  execute 'grant execute on function public.read_room_guest(uuid, text, text) to echo_service';
  execute 'grant execute on function public.read_room_host(uuid, text, text) to echo_service';
  execute 'grant execute on function public.queue_read(uuid, text, text) to echo_service';

  raise notice 'runtime role echo_service kept the queue reads';
end;
$$;
