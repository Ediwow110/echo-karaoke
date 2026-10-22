-- Room experience: named rooms, separate guest permissions, host-only moderation.

alter table public.rooms
  add column name text not null default 'Karaoke room',
  add column guest_playback_locked boolean not null default true;

alter table public.rooms
  add constraint rooms_name_check check (char_length(name) between 1 and 48);

-- The creator names the room and chooses the opening guest permissions.
drop function if exists public.create_room(text, uuid, text, text, text);

create function public.create_room(
  p_code text,
  p_user_id uuid,
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

  insert into public.rooms (code, name, guest_control_locked, guest_playback_locked)
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

revoke all on function public.create_room(text, uuid, text, text, text, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.create_room(text, uuid, text, text, text, text, boolean, boolean) to service_role;

-- Joining returns the room identity so the remote can name the room at once.
create or replace function public.join_room(
  p_code text,
  p_user_id uuid,
  p_display_name text,
  p_guest_token text
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
  if p_display_name is null or char_length(p_display_name) not between 1 and 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 32 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select * into v_room from public.rooms r where r.code = p_code;
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
    update public.members
    set display_name = p_display_name,
        guest_token_hash = private.digest_token(p_guest_token),
        last_seen_at = now()
    where id = v_member.id
    returning * into v_member;
  else
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

-- Readings carry the name and the two independent guest permissions.
create or replace function public.read_room_guest(
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
  v_room public.rooms;
begin
  v_member := private.require_guest(p_room_id, p_user_id, p_guest_token);

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
      'createdAt', v_room.created_at
    ),
    'viewer', jsonb_build_object(
      'memberId', v_member.id,
      'displayName', v_member.display_name,
      'role', v_member.role
    ),
    'roster', private.room_roster(v_room.id),
    'queue', private.room_queue(v_room.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

create or replace function public.read_room_host(
  p_room_id uuid,
  p_user_id uuid,
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
      'createdAt', v_room.created_at,
      'endedAt', v_room.ended_at
    ),
    'roster', private.room_roster(v_room.id),
    'queue', private.room_queue(v_room.id),
    'playback', v_room.playback_state,
    'events', private.room_events_recent(v_room.id)
  );
end;
$$;

-- Host commands handle both guest permissions.
create or replace function public.host_command(
  p_room_id uuid,
  p_user_id uuid,
  p_host_token text,
  p_action text
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
    perform private.require_live(v_room);
    delete from public.queue_songs where room_id = v_room.id;
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
$$;

-- Guests may play or pause only when the host allows it. Skipping stays host-only.
create or replace function public.playback_command(
  p_room_id uuid,
  p_user_id uuid,
  p_guest_token text,
  p_host_token text,
  p_action text
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
  v_current public.queue_songs;
  v_actor uuid;
  v_action text := lower(coalesce(p_action, ''));
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
  end if;

  perform private.require_live(v_room);

  if v_action not in ('play', 'pause', 'next') then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  if not v_is_host then
    if v_action = 'next' then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
    if v_room.guest_playback_locked then
      raise exception 'GUEST_CONTROLS_LOCKED' using errcode = '22023';
    end if;
  end if;

  perform 1 from public.rooms r where r.id = p_room_id for update;

  select * into v_room from public.rooms r where r.id = p_room_id;

  if (v_room.playback_state ->> 'currentSongId') is not null then
    select * into v_current
    from public.queue_songs q
    where q.id = (v_room.playback_state ->> 'currentSongId')::uuid;
  end if;

  if v_action = 'play' then
    if v_current.id is null then
      v_room := private.advance_queue(v_room, null::public.queue_songs);
    else
      update public.queue_songs q set status = 'playing' where q.id = v_current.id;
      v_room := private.set_playback(
        p_room_id,
        v_current,
        coalesce((v_room.playback_state ->> 'positionSeconds')::int, 0),
        true
      );
    end if;
  elsif v_action = 'pause' then
    v_room := private.set_playback(
      p_room_id,
      v_current,
      coalesce((v_room.playback_state ->> 'positionSeconds')::int, 0),
      false
    );
  else
    v_room := private.advance_queue(v_room, v_current);
    if v_is_host then
      v_actor := null;
    else
      v_actor := v_member.id;
    end if;
    perform private.log_room_event(p_room_id, v_actor, 'skip');
  end if;

  return jsonb_build_object(
    'roomId', v_room.id,
    'status', v_room.status,
    'playback', private.playback_json(v_room)
  );
end;
$$;

-- Guests add and vote, but removing and reordering stay with the host.
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

  select * into v_song from public.queue_songs q
  where q.id = p_song_id and q.room_id = p_room_id;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
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

  perform 1 from public.rooms r where r.id = p_room_id for update;

  select * into v_song from public.queue_songs q
  where q.id = p_song_id and q.room_id = p_room_id;

  if not found then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
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

  update public.queue_songs set position = v_offset where id = v_song.id;
  update public.queue_songs set position = v_target where id = v_neighbour.id;
  update public.queue_songs set position = v_neighbour_position where id = v_song.id;

  perform private.log_room_event(p_room_id, v_song.member_id, 'reorder');

  return private.queue_song_json(v_song.id);
end;
$$;
