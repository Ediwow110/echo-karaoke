-- Karaoke room core schema.
-- Browser roles receive no karaoke table access. Supabase Edge Functions verify
-- the anonymous Auth JWT plus a room-scoped guest or host bearer token, then use
-- the service role to run these authorized operations.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  status text not null default 'live',
  guest_control_locked boolean not null default false,
  playback_state jsonb not null default jsonb_build_object(
    'currentSongId', null,
    'positionSeconds', 0,
    'isPlaying', false,
    'updatedAt', null
  ),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint rooms_code_key unique (code),
  constraint rooms_code_format_check check (code ~ '^[0-9A-HJKMNP-TV-Z]{16}$'),
  constraint rooms_status_check check (status in ('live', 'ended')),
  constraint rooms_ended_at_check check ((status = 'ended') = (ended_at is not null))
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  guest_token_hash bytea not null,
  role text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint members_role_check check (role in ('host', 'guest')),
  constraint members_display_name_check check (char_length(display_name) between 1 and 32),
  constraint members_room_user_key unique (room_id, user_id),
  constraint members_id_room_key unique (id, room_id)
);

create index members_room_id_idx on public.members (room_id);
create index members_user_id_room_id_idx on public.members (user_id, room_id);

create table private.room_host_secrets (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  token_hash bytea not null,
  created_at timestamptz not null default now()
);

create table public.queue_songs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  member_id uuid not null,
  video_id text not null,
  title text not null,
  channel_title text,
  thumbnail_url text,
  duration_seconds integer,
  status text not null default 'queued',
  position bigint not null,
  created_at timestamptz not null default now(),
  constraint queue_songs_status_check check (status in ('queued', 'playing', 'played', 'skipped')),
  constraint queue_songs_video_id_check check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint queue_songs_title_check check (char_length(title) between 1 and 500),
  constraint queue_songs_duration_check check (duration_seconds is null or duration_seconds >= 0),
  constraint queue_songs_position_check check (position > 0),
  constraint queue_songs_room_position_key unique (room_id, position),
  constraint queue_songs_id_room_key unique (id, room_id),
  constraint queue_songs_member_room_fkey foreign key (member_id, room_id)
    references public.members (id, room_id) on delete cascade
);

create index queue_songs_room_id_position_idx on public.queue_songs (room_id, position);
create index queue_songs_member_id_created_at_idx on public.queue_songs (member_id, created_at desc);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  queue_song_id uuid not null,
  member_id uuid not null,
  created_at timestamptz not null default now(),
  constraint votes_song_member_key unique (queue_song_id, member_id),
  constraint votes_song_room_fkey foreign key (queue_song_id, room_id)
    references public.queue_songs (id, room_id) on delete cascade,
  constraint votes_member_room_fkey foreign key (member_id, room_id)
    references public.members (id, room_id) on delete cascade
);

create index votes_room_id_idx on public.votes (room_id);

create table public.room_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  member_id uuid,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint room_events_type_check check (
    event_type in ('join', 'add', 'remove', 'reorder', 'skip', 'vote', 'end', 'clear_queue', 'lock', 'unlock')
  ),
  constraint room_events_member_room_fkey foreign key (member_id, room_id)
    references public.members (id, room_id) on delete cascade
);

create index room_events_room_id_created_at_idx on public.room_events (room_id, created_at desc);

alter table public.rooms enable row level security;
alter table public.members enable row level security;
alter table public.queue_songs enable row level security;
alter table public.votes enable row level security;
alter table public.room_events enable row level security;
alter table private.room_host_secrets enable row level security;

revoke all on table public.rooms from public, anon, authenticated;
revoke all on table public.members from public, anon, authenticated;
revoke all on table public.queue_songs from public, anon, authenticated;
revoke all on table public.votes from public, anon, authenticated;
revoke all on table public.room_events from public, anon, authenticated;
revoke all on table private.room_host_secrets from public, anon, authenticated;

grant select, insert, update, delete on table public.rooms to service_role;
grant select, insert, update, delete on table public.members to service_role;
grant select, insert, update, delete on table public.queue_songs to service_role;
grant select, insert, update, delete on table public.votes to service_role;
grant select, insert, update, delete on table public.room_events to service_role;
grant usage on sequence public.room_events_id_seq to service_role;

-- Keep the server role to the operations these functions actually use.
revoke truncate, references, trigger on table public.rooms from service_role;
revoke truncate, references, trigger on table public.members from service_role;
revoke truncate, references, trigger on table public.queue_songs from service_role;
revoke truncate, references, trigger on table public.votes from service_role;
revoke truncate, references, trigger on table public.room_events from service_role;


create or replace function private.digest_token(p_token text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select extensions.digest(p_token, 'sha256');
$$;

create or replace function private.require_guest(
  p_room_id uuid,
  p_user_id uuid,
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

create or replace function private.require_host(
  p_room_id uuid,
  p_host_token text
)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if p_host_token is null or char_length(p_host_token) < 32 then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  select r.* into v_room
  from public.rooms r
  join private.room_host_secrets s on s.room_id = r.id
  where r.id = p_room_id
    and s.token_hash = private.digest_token(p_host_token);

  if not found then
    raise exception 'UNAUTHORIZED' using errcode = '28000';
  end if;

  return v_room;
end;
$$;

create or replace function private.require_live(p_room public.rooms)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_room.status <> 'live' then
    raise exception 'ROOM_ENDED' using errcode = '22023';
  end if;
end;
$$;

create or replace function private.require_guest_controls(p_room public.rooms, p_member public.members)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_room.guest_control_locked and p_member.role <> 'host' then
    raise exception 'GUEST_CONTROLS_LOCKED' using errcode = '22023';
  end if;
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
        'voteCount', (select count(*) from public.votes v where v.queue_song_id = q.id)
      )
      order by q.position
    ),
    '[]'::jsonb
  )
  from public.queue_songs q
  join public.members m on m.id = q.member_id
  where q.room_id = p_room_id
    and q.status in ('queued', 'playing');
$$;

create or replace function private.room_events_recent(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'eventId', e.id,
        'type', e.event_type,
        'memberId', e.member_id,
        'createdAt', e.created_at
      )
      order by e.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    select * from public.room_events ev
    where ev.room_id = p_room_id
    order by ev.created_at desc
    limit 50
  ) e;
$$;

create or replace function private.log_room_event(
  p_room_id uuid,
  p_member_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.room_events (room_id, member_id, event_type, payload)
  values (p_room_id, p_member_id, p_event_type, coalesce(p_payload, '{}'::jsonb));
$$;

create or replace function public.create_room(
  p_code text,
  p_user_id uuid,
  p_display_name text,
  p_guest_token text,
  p_host_token text
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

  insert into public.rooms (code) values (p_code) returning * into v_room;

  insert into public.members (room_id, user_id, display_name, guest_token_hash, role)
  values (v_room.id, p_user_id, p_display_name, private.digest_token(p_guest_token), 'host')
  returning * into v_member;

  insert into private.room_host_secrets (room_id, token_hash)
  values (v_room.id, private.digest_token(p_host_token));

  perform private.log_room_event(v_room.id, v_member.id, 'join');

  return jsonb_build_object(
    'roomId', v_room.id,
    'roomCode', v_room.code,
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'role', v_member.role,
    'guestToken', p_guest_token,
    'hostToken', p_host_token
  );
end;
$$;

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
    'memberId', v_member.id,
    'displayName', v_member.display_name,
    'role', v_member.role,
    'guestToken', p_guest_token
  );
end;
$$;

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
      'status', v_room.status,
      'guestControlLocked', v_room.guest_control_locked,
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
      'status', v_room.status,
      'guestControlLocked', v_room.guest_control_locked,
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

create or replace function public.touch_member(
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

  update public.members
  set last_seen_at = now()
  where id = v_member.id
    and last_seen_at < now() - interval '10 seconds';

  return jsonb_build_object('memberId', v_member.id);
end;
$$;

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
    'guestControlLocked', v_room.guest_control_locked
  );
end;
$$;
revoke all on function private.digest_token(text) from public, anon, authenticated;
revoke all on function private.require_guest(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.require_host(uuid, text) from public, anon, authenticated;
revoke all on function private.require_live(public.rooms) from public, anon, authenticated;
revoke all on function private.require_guest_controls(public.rooms, public.members) from public, anon, authenticated;
revoke all on function private.log_room_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.room_roster(uuid) from public, anon, authenticated;
revoke all on function private.room_queue(uuid) from public, anon, authenticated;
revoke all on function private.room_events_recent(uuid) from public, anon, authenticated;

revoke all on function public.create_room(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.join_room(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.read_room_guest(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.read_room_host(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.touch_member(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.host_command(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.create_room(text, uuid, text, text, text) to service_role;
grant execute on function public.join_room(text, uuid, text, text) to service_role;
grant execute on function public.read_room_guest(uuid, uuid, text) to service_role;
grant execute on function public.read_room_host(uuid, uuid, text) to service_role;
grant execute on function public.touch_member(uuid, uuid, text) to service_role;
grant execute on function public.host_command(uuid, uuid, text, text) to service_role;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;