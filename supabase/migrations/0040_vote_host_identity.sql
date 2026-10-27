-- 0040: a host votes with the pass that proves it hosts.
--
-- vote_toggle resolved the voter through the guest pass, and private.require_guest_any
-- matches on both the token hash and the anonymous user id that created it. A host
-- tab's anonymous identity can be replaced (an expired cookie signs in a fresh
-- anonymous user) while the host pass keeps working, so every vote from that screen
-- answered 401 while the whole rest of the host surface looked healthy. The host pass
-- is the stronger proof and it outlives the identity, so it now names the voter. The
-- guest path is untouched.

create or replace function public.vote_toggle(
  p_room_id uuid,
  p_user_id text,
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
  v_exists public.votes;
  v_count integer;
  v_was_voted boolean;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_host_token is not null and char_length(p_host_token) >= 32 then
    v_room := private.require_host(p_room_id, p_host_token);
    -- A room has one active host row, and the pass just proved this caller holds
    -- it. Resolving by role rather than by user id is what survives a replaced
    -- identity; require_host has already rejected a stale or transferred pass, so
    -- this cannot attribute a vote to somebody else's hosting.
    select * into v_member from public.members m
    where m.room_id = p_room_id
      and m.role = 'host'
      and m.status = 'active'
    limit 1;
    if not found then
      raise exception 'UNAUTHORIZED' using errcode = '28000';
    end if;
  else
    v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
  end if;

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
revoke all on function public.vote_toggle(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.vote_toggle(uuid, text, text, text, uuid) to service_role;

-- The four-argument form stays as a delegate until the next deploy has replaced
-- every caller. Dropping it here would 500 the vote path of the build that is
-- still serving during the migration window; this migration is safe in either
-- order and a later one can retire it.
create or replace function public.vote_toggle(
  p_room_id uuid,
  p_user_id text,
  p_guest_token text,
  p_song_id uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.vote_toggle($1, $2, $3, null, $4);
$$;

-- The host read resolved the viewer by user id, so a vote cast under a replaced
-- identity read back as "not voted" while its count stayed in the row. It now
-- resolves the room's host row, which is the same row the host pass proves.
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
      where m.room_id = v_room.id
        and m.role = 'host'
        and m.status = 'active'
      limit 1
    )),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

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

  execute 'grant execute on function public.vote_toggle(uuid, text, text, text, uuid) to echo_service';
  execute 'grant execute on function public.read_room_host(uuid, text, text) to echo_service';

  raise notice 'runtime role echo_service kept the vote and host-read surface';
end;
$$;
