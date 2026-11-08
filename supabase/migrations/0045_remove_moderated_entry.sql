-- 0045: the door is gone. Scanning the code puts you in the room.
--
-- Moderated entry is removed, not defaulted off: there is no waiting state, no
-- approval switch, and no host door surface. A guest row is a member the moment
-- join_room writes it. Anyone who was waiting when this ran keeps their row and
-- their pass; dropping the status column simply makes them ordinary members.
--
-- The event type check keeps 'approve' and 'reject' because room_events rows
-- from before this migration are history and must stay readable.

-- The one guest check. With no pending state there is nothing left to gate, so
-- the permissive variant and the status check collapse into a single function.
create or replace function private.require_guest(
  p_room_id uuid,
  p_user_id text,
  p_guest_token text
)
returns public.members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.members;
begin
  if p_guest_token is null or char_length(p_guest_token) < 32 or p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  select * into v_member
  from public.members m
  where m.room_id = p_room_id
    and m.user_id = p_user_id
    and m.guest_token_hash = private.digest_token(p_guest_token);

  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  return v_member;
end;
$$;

create or replace function private.room_roster(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'memberId', m.id,
        'displayName', m.display_name,
        'role', m.role,
        'online', m.last_seen_at > now() - interval '30 seconds'
      )
      order by m.joined_at
    ),
    '[]'::jsonb
  )
  from public.members m
  where m.room_id = p_room_id;
$$;

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
  v_member_found boolean := false;
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
  if v_room.status = 'ended'
     or v_room.created_at <= now() - interval '24 hours' then
    raise exception 'ROOM_ENDED' using errcode = '22023';
  end if;

  -- Deliberately no FOR UPDATE here. A lock on this row would be taken after
  -- the room lock above, while host_remove_member deletes a member row and the
  -- room_events insert takes a KEY SHARE lock on the room; that is a lock
  -- cycle. The update below checks FOUND instead, which is enough to refuse a
  -- member a concurrent removal deleted.
  select * into v_member
  from public.members m
  where m.room_id = v_room.id and m.user_id = p_user_id;
  v_member_found := found;

  if v_room.admissions_locked and not v_member_found then
    raise exception 'ROOM_CLOSED' using errcode = '22023';
  end if;

  if v_member_found then
    if v_member.role = 'host' then
      raise exception 'HOST_ALREADY_IN_ROOM' using errcode = '22023';
    end if;

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

    -- The member can be removed between the read and this update. The update
    -- then touches nothing and v_member is all NULL, so refuse rather than hand
    -- back a deleted member's empty identity.
    if not found then
      raise exception 'UNAUTHORIZED' using errcode = '28000';
    end if;
  else
    select count(*) into v_member_count
    from public.members m
    where m.room_id = v_room.id
      and (m.role = 'host' or m.last_seen_at > now() - interval '30 seconds');

    if v_member_count >= p_member_limit then
      raise exception 'ROOM_FULL' using errcode = '22023';
    end if;

    insert into public.members (room_id, user_id, display_name, guest_token_hash, role)
    values (
      v_room.id, p_user_id, p_display_name, private.digest_token(p_guest_token), 'guest'
    )
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
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  -- An expired room reads as ended before the sweep removes it, with the
  -- ceiling named as the end time.
  if v_room.status = 'live'
     and v_room.created_at <= now() - interval '24 hours' then
    v_room.status := 'ended';
    v_room.ended_at := v_room.created_at + interval '24 hours';
  end if;

  if v_room.status = 'ended' then
    return jsonb_build_object(
      'roomId', v_room.id,
      'status', 'ended',
      'endedAt', v_room.ended_at
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
      'admissionsLocked', v_room.admissions_locked,
      'createdAt', v_room.created_at
    ),
    'viewer', jsonb_build_object(
      'memberId', v_member.id,
      'displayName', v_member.display_name,
      'role', v_member.role
    ),
    'roster', private.room_roster(v_room.id),
    'queue', private.room_queue(v_room.id, v_member.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

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

  if v_room.status = 'live'
     and v_room.created_at <= now() - interval '24 hours' then
    v_room.status := 'ended';
    v_room.ended_at := v_room.created_at + interval '24 hours';
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
      'admissionsLocked', v_room.admissions_locked,
      'createdAt', v_room.created_at,
      'endedAt', v_room.ended_at
    ),
    'roster', private.room_roster(v_room.id),
    'queue', private.room_queue(v_room.id, (
      select m.id from public.members m
      where m.room_id = v_room.id
        and m.role = 'host'
      limit 1
    )),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

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
    -- A room has one host row, and the pass just proved this caller holds it.
    -- Resolving by role rather than by user id is what survives a replaced
    -- identity; require_host has already rejected a stale or transferred pass,
    -- so this cannot attribute a vote to somebody else's hosting.
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

create or replace function public.room_transfer_host(
  p_room_id uuid,
  p_user_id text,
  p_host_token text,
  p_member_id uuid,
  p_guest_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_caller public.members;
  v_target public.members;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_room := private.require_host(p_room_id, p_host_token);

  select r.* into v_room from public.rooms r where r.id = p_room_id for update;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  -- Revalidate under the lock: a concurrent transfer revokes the old secret,
  -- and the waiting call must not act on a pass that has just died.
  v_room := private.require_host(p_room_id, p_host_token);
  perform private.require_live(v_room);

  -- The pass named the caller; the room has exactly one host row. Resolving by
  -- role, not by the anonymous user id, survives an identity replacement.
  select m.* into v_caller
    from public.members m
   where m.room_id = p_room_id
     and m.role = 'host'
   limit 1;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if p_member_id is null or p_member_id = v_caller.id then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- Only someone the room has heard from recently can be handed control, so a
  -- stale roster row cannot become the device nobody can pause.
  select m.* into v_target
    from public.members m
   where m.id = p_member_id
     and m.room_id = p_room_id
     and m.role = 'guest'
     and m.last_seen_at > now() - interval '2 minutes';
  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- Demote first: the one-host index would reject promoting before the current
  -- host gives the role up. Rebind the demoted row to the caller's current
  -- identity when that identity has no other row in this room, so the guest
  -- pass returned below works even after an anonymous session replacement.
  update public.members
     set role = 'guest',
         user_id = case
           when exists (
             select 1 from public.members x
             where x.room_id = p_room_id
               and x.user_id = p_user_id
               and x.id <> v_caller.id
           ) then v_caller.user_id
           else p_user_id
         end,
         guest_token_hash = private.digest_token(p_guest_token),
         last_seen_at = now()
   where id = v_caller.id;

  update public.members
     set role = 'host'
   where id = v_target.id;

  -- Replace the secret with a digest of a value nobody holds. The outgoing host
  -- loses the ability to act immediately, and there is nothing to leak.
  update private.room_host_secrets
     set token_hash = private.digest_token('revoked:' || gen_random_uuid()::text)
   where room_id = p_room_id;
  if not found then
    raise exception 'INTERNAL_ERROR' using errcode = 'P0001';
  end if;

  insert into public.room_events (room_id, member_id, event_type, payload)
  values (
    p_room_id, v_caller.id, 'transfer_host',
    jsonb_build_object('toMemberId', v_target.id, 'toDisplayName', v_target.display_name)
  );

  return jsonb_build_object(
    'roomId', p_room_id,
    'role', 'guest',
    'guestToken', p_guest_token,
    'newHost', jsonb_build_object(
      'memberId', v_target.id,
      'displayName', v_target.display_name
    )
  );
end;
$$;

create or replace function public.room_access_check(
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
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  if v_room.status = 'live'
     and v_room.created_at <= now() - interval '24 hours' then
    v_room.status := 'ended';
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'memberId', v_member.id
  );
end;
$$;

create or replace function public.touch_member(
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
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

  -- The ended-room guard survives: a heartbeat must not report a room that is
  -- over as live.
  select * into v_room from public.rooms r where r.id = p_room_id;
  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  perform private.require_live(v_room);

  update public.members
  set last_seen_at = now()
  where id = v_member.id
    and last_seen_at < now() - interval '10 seconds';

  return jsonb_build_object('memberId', v_member.id);
end;
$$;

-- create_room loses its approval argument. The eight-argument form is the live
-- signature. The nine-argument form stays as a delegate for the deploy window,
-- exactly as 0040 kept its four-argument vote form: the shipped server still
-- calls it, and dropping it here would 500 room creation until the new build
-- lands. The approval argument is accepted and ignored, which is the same
-- behavior the removal promises. The delegate has no defaults on its trailing
-- arguments so the two forms never compete for a short call; a later migration
-- retires it once no deployed build calls it.

create or replace function public.create_room(
  p_code text,
  p_user_id text,
  p_display_name text,
  p_guest_token text,
  p_host_token text,
  p_name text default 'Karaoke room',
  p_guest_control_locked boolean default false,
  p_guest_playback_locked boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_member public.members;
  v_name text;
  v_limit jsonb;
begin
  if p_user_id is null then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9A-HJKMNP-TV-Z]{16}$' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_display_name is null or char_length(p_display_name) not between 1 and 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_guest_token is null or p_host_token is null
     or char_length(p_guest_token) < 32 or char_length(p_host_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_name := btrim(regexp_replace(coalesce(nullif(btrim(p_name), ''), 'Karaoke room'), '\s+', ' ', 'g'));
  if char_length(v_name) not between 1 and 48 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_limit := public.consume_rate_limit(p_user_id::text, 'create-room', 10, 3600);
  if coalesce((v_limit ->> 'allowed')::boolean, false) is not true then
    raise exception 'ROOM_CREATE_RATE_LIMITED' using errcode = '22023';
  end if;

  insert into public.rooms (
    code, name, guest_control_locked, guest_playback_locked
  )
  values (
    p_code,
    v_name,
    coalesce(p_guest_control_locked, false),
    coalesce(p_guest_playback_locked, true)
  )
  returning * into v_room;

  insert into public.members (room_id, user_id, display_name, guest_token_hash, role)
  values (v_room.id, p_user_id, p_display_name, private.digest_token(p_guest_token), 'host')
  returning * into v_member;

  insert into private.room_host_secrets (room_id, token_hash)
  values (v_room.id, private.digest_token(p_host_token));

  perform private.log_room_event(v_room.id, v_member.id, 'join');

  return jsonb_build_object(
    'roomId', v_room.id,
    'roomCode', v_room.code,
    'roomName', v_room.name,
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'role', v_member.role,
    'guestToken', p_guest_token,
    'hostToken', p_host_token
  );
end;
$$;

revoke all on function public.create_room(text, text, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean) to service_role;

-- The deploy-window delegate. A function's defaults cannot be removed in place,
-- so the old nine-argument form is dropped and rebuilt without them: an
-- eight-argument call must resolve to the live signature alone. The grants the
-- shipped build holds are restored by hand, including the runtime role's.
drop function if exists public.create_room(text, text, text, text, text, text, boolean, boolean, boolean);

create function public.create_room(
  p_code text,
  p_user_id text,
  p_display_name text,
  p_guest_token text,
  p_host_token text,
  p_name text,
  p_guest_control_locked boolean,
  p_guest_playback_locked boolean,
  p_require_approval boolean
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.create_room($1, $2, $3, $4, $5, $6, $7, $8);
$$;

revoke all on function public.create_room(text, text, text, text, text, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean, boolean) to service_role;

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

  execute 'grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean) to echo_service';
  execute 'grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean, boolean) to echo_service';

  raise notice 'runtime role echo_service granted both create_room forms';
end;
$$;

-- The door operations and the door listing go with the feature. Their grants
-- disappear with the objects.
drop function if exists public.room_approve_member(uuid, text, text, uuid);
drop function if exists public.room_reject_member(uuid, text, text, uuid);
drop function if exists public.room_set_approval(uuid, text, text, boolean);
drop function if exists private.room_door(uuid);
drop function if exists private.require_guest_any(uuid, text, text);

-- Nothing can be pending any more, and nothing can switch approval on again.
alter table public.members drop constraint if exists members_status_check;
alter table public.members drop column if exists status;
alter table public.rooms drop column if exists require_approval;
