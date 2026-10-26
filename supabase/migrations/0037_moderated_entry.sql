-- 0037: the host decides who comes in.
--
-- Two switches on the room and one status on the member, all defaulted so that no
-- room or member that exists today changes behavior. The gate lives in SQL: a
-- waiting guest's read is a reduced payload, not a client that hides things.

alter table public.rooms
  add column require_approval boolean not null default false;

alter table public.rooms
  add column admissions_locked boolean not null default false;

alter table public.members
  add column status text not null default 'active';

alter table public.members
  add constraint members_status_check check (status in ('active', 'pending'));

alter table public.room_events
  drop constraint room_events_type_check;
alter table public.room_events
  add constraint room_events_type_check check (
    event_type in (
      'join', 'add', 'remove', 'reorder', 'skip', 'vote', 'end',
      'clear_queue', 'lock', 'unlock', 'transfer_host', 'approve', 'reject'
    )
  );

-- Entry to the room now means active. Making that the default in the shared check
-- is what keeps every participating operation safe without editing each one: a
-- caller that forgets to ask about status still refuses a waiting guest.
create or replace function private.require_guest_any(
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
  v_member := private.require_guest_any(p_room_id, p_user_id, p_guest_token);
  if v_member.status <> 'active' then
    raise exception 'ROOM_PENDING' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

-- The roster stops describing people who are not in the room yet.
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
  where m.room_id = p_room_id
    and m.status = 'active';
$$;

create or replace function private.room_door(p_room_id uuid)
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
        'online', m.last_seen_at > now() - interval '30 seconds',
        'joinedAt', m.joined_at
      )
      order by m.joined_at
    ),
    '[]'::jsonb
  )
  from public.members m
  where m.room_id = p_room_id
    and m.status = 'pending';
$$;

-- create_room gains the toggle. The old eight-argument form is dropped rather than
-- overloaded: two forms with defaults would make every call ambiguous.
drop function if exists public.create_room(text, text, text, text, text, text, boolean, boolean);

create or replace function public.create_room(
  p_code text,
  p_user_id text,
  p_display_name text,
  p_guest_token text,
  p_host_token text,
  p_name text default 'Karaoke room',
  p_guest_control_locked boolean default false,
  p_guest_playback_locked boolean default true,
  p_require_approval boolean default false
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
    code, name, guest_control_locked, guest_playback_locked, require_approval
  )
  values (
    p_code,
    v_name,
    coalesce(p_guest_control_locked, false),
    coalesce(p_guest_playback_locked, true),
    coalesce(p_require_approval, false)
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
    'hostToken', p_host_token,
    'requireApproval', v_room.require_approval
  );
end;
$$;

-- join_room: the door checks happen after the room is known and before the member
-- row is written. A pending member rejoining keeps their place; the lock only
-- refuses arrivals the room has never seen.
drop function if exists public.join_room(text, text, text, text, integer);

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
  if v_room.status = 'ended' then
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

-- The waiting payload: identity and the host's name, nothing else.
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
    'queue', private.room_queue(v_room.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

-- The host read gains the door and the two switches, so settings can render both.
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
    'queue', private.room_queue(v_room.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

create or replace function public.room_approve_member(
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
    and m.role = 'guest'
    and m.status = 'pending'
  for update;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  update public.members
  set status = 'active'
  where id = v_member.id
  returning * into v_member;

  insert into public.room_events (room_id, member_id, event_type, payload)
  values (
    p_room_id, v_member.id, 'approve',
    jsonb_build_object('displayName', v_member.display_name)
  );

  return jsonb_build_object(
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'door', private.room_door(p_room_id)
  );
end;
$$;

-- A rejected member's row is deleted, which is what kills their pass: the digest
-- goes with the row. The event must not be attached to that row, because
-- room_events has a cascading composite foreign key to members — write it with a
-- null member_id and keep the name in the payload, or the record deletes itself.
create or replace function public.room_reject_member(
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
    and m.role = 'guest'
    and m.status = 'pending'
  for update;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.members where id = v_member.id;

  insert into public.room_events (room_id, member_id, event_type, payload)
  values (
    p_room_id, null, 'reject',
    jsonb_build_object('memberId', v_member.id, 'displayName', v_member.display_name)
  );

  return jsonb_build_object(
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'door', private.room_door(p_room_id)
  );
end;
$$;

revoke all on function private.require_guest_any(uuid, text, text) from public, anon, authenticated;
revoke all on function private.room_door(uuid) from public, anon, authenticated;

revoke all on function public.create_room(text, text, text, text, text, text, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean, boolean) to service_role;

-- join_room was dropped above, so it is a new object with none of its former
-- grants. Without these two lines the runtime role cannot execute it at all.
revoke all on function public.join_room(text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.join_room(text, text, text, text, integer) to service_role;

revoke all on function public.room_approve_member(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.room_approve_member(uuid, text, text, uuid) to service_role;

revoke all on function public.room_reject_member(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.room_reject_member(uuid, text, text, uuid) to service_role;

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

  execute 'grant execute on function public.create_room(text, text, text, text, text, text, boolean, boolean, boolean) to echo_service';
  execute 'grant execute on function public.join_room(text, text, text, text, integer) to echo_service';
  execute 'grant execute on function public.room_approve_member(uuid, text, text, uuid) to echo_service';
  execute 'grant execute on function public.room_reject_member(uuid, text, text, uuid) to echo_service';

  raise notice 'runtime role echo_service granted the moderated-entry surface';
end;
$$;

-- Keep the three doorbell paths open. Because private.require_guest now refuses
-- pending, the two functions a waiting guest still needs must move to the
-- permissive check or the waiting screen cannot work. (read_room_guest above
-- already calls require_guest_any.)
create or replace function public.room_access_check(p_room_id uuid, p_user_id text, p_guest_token text)
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

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'memberId', v_member.id
  );
end;
$$;

create or replace function public.touch_member(p_room_id uuid, p_user_id text, p_guest_token text)
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

  -- A waiting guest is still a heartbeat, but the ended-room guard from 0023
  -- survives: a heartbeat must not report a room that is over as live.
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
