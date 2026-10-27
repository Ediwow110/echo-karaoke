-- 0042: a room cannot outlive one day.
--
-- A host pass has no identity binding and no expiry, and the abandoned-room
-- sweep deletes only rooms nobody heartbeats. A pass lifted from a lost or
-- shared device therefore kept a dead room under host control forever. The
-- chosen bound is a hard 24 hour room lifetime: every liveness check treats an
-- older room as ended, join and mutation paths refuse, and a sweep removes the
-- row even while heartbeats keep arriving.
--
-- Reads report the expiry as the end time instead of failing, so an honest
-- client renders its existing "room ended" state before the sweep removes the
-- row. This is a deliberate product tradeoff: a party cannot run past 24 hours.

-- The ceiling itself. STABLE because it reads the clock; the previous
-- definition was IMMUTABLE, which was only true while it read status alone.
create or replace function private.require_live(p_room public.rooms)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_room.status <> 'live'
     or p_room.created_at <= now() - interval '24 hours' then
    raise exception 'ROOM_ENDED' using errcode = '22023';
  end if;
end;
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
  -- the room lock above, while the door operations take the member lock first
  -- and then a KEY SHARE lock on the room via the room_events foreign key;
  -- that is a lock cycle. The update below checks FOUND instead, which is
  -- enough to refuse a member a concurrent reject deleted.
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

    -- room_reject_member can delete the row between the read and this update.
    -- The update then touches nothing and v_member is all NULL, so refuse
    -- rather than hand back a deleted member's empty identity.
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

    insert into public.members (room_id, user_id, display_name, guest_token_hash, role, status)
    values (
      v_room.id, p_user_id, p_display_name, private.digest_token(p_guest_token), 'guest',
      case when v_room.require_approval then 'pending' else 'active' end
    )
    returning * into v_member;

    if v_member.status = 'active' then
      perform private.log_room_event(v_room.id, v_member.id, 'join');
    end if;
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'roomCode', v_room.code,
    'roomName', v_room.name,
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'role', v_member.role,
    'guestToken', p_guest_token,
    'status', case when v_member.status = 'active' then 'joined' else 'waiting' end
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
  -- The permissive check on purpose: a waiting guest must be able to read this,
  -- because this is how they learn they are waiting.
  v_member := private.require_guest_any(p_room_id, p_user_id, p_guest_token);

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
  v_member := private.require_guest_any(p_room_id, p_user_id, p_guest_token);

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

create or replace function public.host_access_check(
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
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status
  );
end;
$$;

-- The storage half of the ceiling. Unlike cleanup_abandoned_rooms this ignores
-- heartbeats entirely, so a stolen pass cannot retain the row. The lower bound
-- keeps a typo from deleting every live party in one statement.
create or replace function public.cleanup_expired_rooms(
  p_lifetime interval default interval '24 hours'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_lifetime is null
     or p_lifetime < interval '1 hour'
     or p_lifetime > interval '7 days' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.rooms r
  where r.created_at <= clock_timestamp() - p_lifetime;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_expired_rooms(interval) from public, anon, authenticated;
grant execute on function public.cleanup_expired_rooms(interval) to service_role;

select cron.schedule(
  'cleanup-expired-rooms',
  '*/15 * * * *',
  $$ select public.cleanup_expired_rooms(interval '24 hours') $$
);
