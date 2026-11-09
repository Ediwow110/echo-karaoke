-- Apply the post-lock credential revalidation to the remaining room
-- mutations. Each of these functions authenticated before taking the room
-- lock; a transfer or member removal that committed while the statement
-- waited could let a revoked pass perform one last mutation. Re-run the
-- capability check against committed state while the room lock is held.

CREATE OR REPLACE FUNCTION public.host_command(p_room_id uuid, p_user_id text, p_host_token text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  -- Serialize with a transfer and revalidate the pass under the lock.
  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

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
$function$;

revoke all on function public.host_command(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.host_command(uuid, text, text, text) to service_role;

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
  v_current public.queue_songs;
  v_was_playing boolean := false;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_member_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  -- Serialize with skip, advance, remove, and clear so the current-song read
  -- below cannot be replaced between the cascade and the repair.
  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
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

  v_was_playing := coalesce((v_room.playback_state ->> 'isPlaying')::boolean, false);

  if (v_room.playback_state ->> 'currentSongId') is not null then
    select * into v_current
    from public.queue_songs q
    where q.id = (v_room.playback_state ->> 'currentSongId')::uuid
      and q.room_id = p_room_id;
  end if;

  delete from public.members where id = v_member.id;

  perform private.log_room_event(
    p_room_id,
    null,
    'remove',
    jsonb_build_object('memberId', p_member_id)
  );

  if v_current.id is not null and v_current.member_id = v_member.id then
    v_room := private.advance_queue(v_room, v_current);
    -- advance_queue intentionally starts a skip. A paused room must stay
    -- paused when the reason was moderation, not a skip.
    if not v_was_playing then
      update public.rooms r
      set playback_state = jsonb_set(
        jsonb_set(r.playback_state, '{isPlaying}', 'false'::jsonb),
        '{updatedAt}',
        to_jsonb(now())
      )
      where r.id = p_room_id
      returning * into v_room;
    end if;
    perform private.log_room_event(
      p_room_id,
      null,
      'skip',
      jsonb_build_object('reason', 'member_removed', 'memberId', p_member_id)
    );
  end if;

  return jsonb_build_object('memberId', p_member_id, 'removed', true);
end;
$$;

revoke all on function public.host_remove_member(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.host_remove_member(uuid, text, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.queue_remove(p_room_id uuid, p_user_id text, p_guest_token text, p_host_token text, p_song_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_is_host then
    v_room := private.require_host(p_room_id, p_host_token);
  else
    perform private.require_guest(p_room_id, p_user_id, p_guest_token);
  end if;
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
$function$;

revoke all on function public.queue_remove(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.queue_remove(uuid, text, text, text, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.queue_reorder(p_room_id uuid, p_user_id text, p_guest_token text, p_host_token text, p_song_id uuid, p_direction text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_is_host then
    v_room := private.require_host(p_room_id, p_host_token);
  else
    perform private.require_guest(p_room_id, p_user_id, p_guest_token);
  end if;
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
$function$;

revoke all on function public.queue_reorder(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.queue_reorder(uuid, text, text, text, uuid, text) to service_role;

CREATE OR REPLACE FUNCTION public.playback_report(p_room_id uuid, p_user_id text, p_host_token text, p_position_seconds integer, p_duration_seconds integer DEFAULT NULL::integer, p_song_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_room := private.require_host(p_room_id, p_host_token);
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
$function$;

revoke all on function public.playback_report(uuid, text, text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.playback_report(uuid, text, text, integer, integer, uuid) to service_role;

create or replace function public.playback_next_if_current(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_expected_song_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_current public.queue_songs;
begin
  if p_user_id is null or p_expected_song_id is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  if v_room.playback_state ->> 'currentSongId' is distinct from p_expected_song_id::text then
    return jsonb_build_object(
      'roomId', v_room.id, 'status', v_room.status,
      'playback', private.playback_json(v_room), 'advanced', false
    );
  end if;

  select * into v_current from public.queue_songs q
  where q.id = p_expected_song_id and q.room_id = p_room_id;
  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.advance_queue(v_room, v_current);
  perform private.log_room_event(p_room_id, null, 'skip');
  return jsonb_build_object(
    'roomId', v_room.id, 'status', v_room.status,
    'playback', private.playback_json(v_room), 'advanced', true
  );
end;
$$;

revoke all on function public.playback_next_if_current(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.playback_next_if_current(uuid, text, text, uuid) to service_role;

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
    -- A room has one host row. Resolve by role rather than by user id so a
    -- replaced identity cannot attribute the vote elsewhere; the post-lock
    -- recheck below is the authority check.
    select * into v_member from public.members m
    where m.room_id = p_room_id
      and m.role = 'host'
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

  if p_host_token is not null and char_length(p_host_token) >= 32 then
    v_room := private.require_host(p_room_id, p_host_token);
    select * into v_member from public.members m
    where m.room_id = p_room_id
      and m.role = 'host'
    limit 1;
    if not found then
      raise exception 'UNAUTHORIZED' using errcode = '28000';
    end if;
  else
    v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);
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

CREATE OR REPLACE FUNCTION public.touch_host(p_room_id uuid, p_host_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_room public.rooms;
  v_member public.members;
begin
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  select * into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  update public.members m
  set last_seen_at = now()
  where m.room_id = p_room_id
    and m.role = 'host'
    and m.last_seen_at < now() - interval '10 seconds';

  select * into v_member
  from public.members m
  where m.room_id = p_room_id
    and m.role = 'host';

  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  return jsonb_build_object('memberId', v_member.id);
end;
$function$;

revoke all on function public.touch_host(uuid, text) from public, anon, authenticated;
grant execute on function public.touch_host(uuid, text) to service_role;

-- echo_service is the deployed runtime login on Neon. Mirror the guarded
-- grants so the new definitions stay callable after the migration runs.
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

  execute 'grant execute on function public.host_command(uuid, text, text, text) to echo_service';
  execute 'grant execute on function public.host_remove_member(uuid, text, text, uuid) to echo_service';
  execute 'grant execute on function public.queue_remove(uuid, text, text, text, uuid) to echo_service';
  execute 'grant execute on function public.queue_reorder(uuid, text, text, text, uuid, text) to echo_service';
  execute 'grant execute on function public.playback_report(uuid, text, text, integer, integer, uuid) to echo_service';
  execute 'grant execute on function public.playback_next_if_current(uuid, text, text, uuid) to echo_service';
  execute 'grant execute on function public.vote_toggle(uuid, text, text, text, uuid) to echo_service';
  execute 'grant execute on function public.touch_host(uuid, text) to echo_service';
end;
$$;
