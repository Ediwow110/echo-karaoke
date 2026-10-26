# Moderated Room Entry (Waiting Room) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host admit each new guest by hand, keep a waiting guest from learning anything about the room, and close the door to new arrivals mid-party.

**Architecture:** All admission state lives in PostgreSQL (one `status` on `members`, two booleans on `rooms`), and every refusal is decided in SQL rather than by a client that hides things. The host gets two new operations mirroring `room_transfer_host`; a pending guest's read is a reduced payload next to the existing `ended` branch.

**Tech Stack:** React 19 + Vite, TypeScript, one Vercel Function (`api/router.ts`) in Node 24, Postgres 17 on Neon, pgTAP via the local Supabase stack, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-moderated-room-entry-design.md`

## Global Constraints

- **Migration is `0037`.** `0036` is applied to production; migrations are forward-only and never edited after they are applied anywhere.
- **Run database tests against the local stack only:** `npx supabase test db --local`. Never point `supabase test db` at `main`; the env files name production.
- Every SQL function is `security definer` with `set search_path = ''` and schema-qualified names.
- Grants: `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`, then the guarded `do $$` block that grants to `echo_service` when that role exists (copy `0035` at `supabase/migrations/0035_room_transfer_host.sql:183-204`).
- `alter table public.rooms add column require_approval ...` must default `false`, and `members.status` must default `'active'`, so no existing room or member changes behavior.
- Body booleans are parsed with `readOptionalBoolean` from `server/operations/tokens.js`.
- Client copy stays in the app's voice: no exclamation marks, no "Oops", no emoji.
- Guest-facing controls keep a 44px minimum target; host big-screen controls may stay compact.
- Red-first: every task writes its test, runs it failing, then implements.

---

## File Structure

**Create**
- `supabase/migrations/0037_moderated_entry.sql` — columns, event vocabulary, the active-only `require_guest` plus `require_guest_any`, `join_room`, `read_room_guest`, `read_room_host`, `room_roster`, `room_door`, `create_room`, `room_approve_member`, `room_reject_member`, grants.
- `supabase/tests/moderated_entry_test.sql` — the ten assertions from spec §11.
- `server/operations/admission.ts` — `approveMember` and `rejectMember` handlers.
- `tests/unit/admission.test.ts` — operation-layer tests.
- `src/features/rooms/DoorList.tsx` — the "At the door" section used by Room settings.
- `src/app/WaitingRoom.tsx` — the pending guest's screen.
- `tests/unit/waitingRoom.test.tsx` — client waiting/door tests.

**Modify**
- `server/operations/errors.ts` — two new error codes.
- `server/operations/index.ts` — register `approve-member` and `reject-member`.
- `server/operations/createRoom.ts` — send the new flag.
- `server/operations/room.ts` — nothing (join payload passes through).
- `src/features/rooms/roomApi.ts` — `JoinedRoom.status`, `approveMember`, `rejectMember`, `createRoom` flag.
- `src/app/HomePage.tsx` — third create toggle.
- `src/app/GuestRoomPage.tsx` — render `WaitingRoom` when the read says `waiting`.
- `src/app/HostRoomPage.tsx` — expose `door`, `approveMember`, `rejectMember` on the host context; header badge.
- `src/app/HostSettingsPage.tsx` — mount `DoorList`.
- `tests/unit/guestRoomPage.test.tsx`, `tests/unit/hostRoomPage.test.tsx`, `tests/unit/homePage.test.tsx` — extend.

---

### Task 1: The database half (migration 0037 + pgTAP)

**Files:**
- Create: `supabase/migrations/0037_moderated_entry.sql`
- Test: `supabase/tests/moderated_entry_test.sql`

**Interfaces:**
- Consumes: `private.require_host(uuid, text)`, `private.require_live(public.rooms)`, `private.require_guest(uuid, text, text)`, `private.digest_token(text)`, `private.room_roster(uuid)`, `private.log_room_event(uuid, uuid, text)`.
- Produces (later tasks rely on these exact names):
  - `public.room_approve_member(p_room_id uuid, p_user_id text, p_host_token text, p_member_id uuid) returns jsonb` → `{ memberId, displayName, door }`
  - `public.room_reject_member(p_room_id uuid, p_user_id text, p_host_token text, p_member_id uuid) returns jsonb` → `{ memberId, displayName, door }`
  - `private.require_guest(uuid, text, text)` keeps its signature but now admits only `status = 'active'`; `private.require_guest_any(uuid, text, text)` is the same digest check without the status test, used by the three paths a waiting guest legitimately needs (room read, touch, access check).
  - `private.room_door(uuid) returns jsonb` → `[{ memberId, displayName, online, joinedAt }]`
  - `join_room(...)` return gains `status: 'joined' | 'waiting'`; `read_room_guest(...)` can return `status: 'waiting'`; `read_room_host(...)` gains `door` and `viewer.status`; `create_room(...)` gains `p_require_approval boolean default false`.

- [ ] **Step 1: Write the failing pgTAP file**

```sql
begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- A moderated room is only as private as its weakest read: a pending guest must be
-- unable to see the queue, the roster or the playback state, and the refusal lives
-- in SQL because a client that hides things is not a gate.

create temp table ctx on commit drop as
select
  (moderated ->> 'roomId')::uuid as room_id,
  (moderated ->> 'memberId')::uuid as host_member_id,
  'me-host' as host_user,
  repeat('h', 40) as host_token,
  (moderated ->> 'roomCode') as room_code
from (select public.create_room(
  'ME00000000000001', 'me-host', 'Door Host',
  repeat('g', 40), repeat('h', 40), 'Moderated', false, true, true
) as moderated) s;

select is(
  (select (public.join_room(
    (select room_code from ctx), 'me-guest', 'Waiting Guest',
    repeat('a', 40)
  ) ->> 'status')),
  'waiting',
  'a new guest lands in the waiting room when the host asked to approve'
);

select is(
  (select m.status from public.members m where m.user_id = 'me-guest'),
  'pending',
  'the member row is pending, not active'
);

select is(
  (select public.read_room_guest(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  ) ? 'queue'),
  false,
  'a waiting guest cannot read the queue'
);

select is(
  (select public.read_room_guest(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  ) ? 'roster'),
  false,
  'a waiting guest cannot read the roster'
);

select is(
  (select public.read_room_guest(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  ) ->> 'status'),
  'waiting',
  'the waiting read is its own status, not a live room with empty data'
);

select throws_ok(
  $$select public.queue_add(
    (select room_id from ctx), 'me-guest', repeat('a', 40), null,
    'aaaaaaaaaaa', 'A song'
  )$$,
  '42501',
  null,
  'a waiting guest cannot add a song'
);

select lives_ok(
  $$select public.touch_member(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  )$$,
  'a waiting guest can still say hello, which is what the doorbell runs on'
);

select is(
  (select public.room_approve_member(
    (select room_id from ctx), 'me-host', (select host_token from ctx),
    (select m.id from public.members m where m.user_id = 'me-guest')
  ) ->> 'displayName'),
  'Waiting Guest',
  'the host admits the guest by member id'
);

select is(
  (select (public.read_room_guest(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  ) ->> 'status')),
  'live',
  'once admitted the same pass reads the live room'
);

select is(
  (select public.read_room_guest(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  ) ? 'queue'),
  true,
  'and the queue is there'
);

select is(
  (select jsonb_array_length(public.read_room_host(
    (select room_id from ctx), 'me-host', (select host_token from ctx)
  ) -> 'door')),
  0,
  'the door list is empty after admitting'
);

-- Reject: the row goes, the pass dies, and the event survives the cascade.
select public.join_room(
  (select room_code from ctx), 'me-rejected', 'Turned Away', repeat('b', 40)
);

select is(
  (select public.room_reject_member(
    (select room_id from ctx), 'me-host', (select host_token from ctx),
    (select m.id from public.members m where m.user_id = 'me-rejected')
  ) ->> 'displayName'),
  'Turned Away',
  'the host rejects a waiting guest'
);

select throws_ok(
  $$select public.read_room_guest(
    (select room_id from ctx), 'me-rejected', repeat('b', 40)
  )$$,
  '28000',
  null,
  'a rejected pass authenticates as nothing'
);

select is(
  (select count(*) from public.room_events e
    where e.room_id = (select room_id from ctx)
      and e.event_type = 'reject'
      and e.payload ->> 'displayName' = 'Turned Away'),
  1::bigint,
  'the reject event outlives the member row it describes'
);

-- Locked door: new arrivals refused, people already inside unaffected.
update public.rooms set admissions_locked = true where id = (select room_id from ctx);

select throws_ok(
  $$select public.join_room(
    (select room_code from ctx), 'me-late', 'Too Late', repeat('c', 40)
  )$$,
  '22023',
  null,
  'a locked room refuses a new guest'
);

select lives_ok(
  $$select public.join_room(
    (select room_code from ctx), 'me-guest', 'Waiting Guest', repeat('a', 40)
  )$$,
  'an admitted guest still gets back in while the door is locked'
);

select is(
  (select public.room_roster((select room_id from ctx))::text like '%Turned Away%'),
  false,
  'rejected guests never appear in the roster'
);

select is(
  has_function_privilege('authenticated', 'public.room_approve_member(uuid, text, text, uuid)', 'execute'),
  false,
  'only the service role may call the door operations'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run it and watch it fail**

Run: `docker exec -i supabase_db_online-karaoke psql -U postgres -d postgres -t -A -f - < supabase/tests/moderated_entry_test.sql`
Expected: FAIL — `function public.create_room(... ) does not exist` for the nine-argument form.

- [ ] **Step 3: Write the migration**

```sql
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
  execute 'grant execute on function public.room_approve_member(uuid, text, text, uuid) to echo_service';
  execute 'grant execute on function public.room_reject_member(uuid, text, text, uuid) to echo_service';

  raise notice 'runtime role echo_service granted the moderated-entry surface';
end;
$$;
```

- [ ] **Step 4: Keep the three doorbell paths open**

Because `private.require_guest` now refuses pending, the two functions a waiting guest still needs must move to the permissive check or the waiting screen cannot work. (`read_room_guest` in Step 3 already calls `require_guest_any`.)

```sql
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
begin
  v_member := private.require_guest_any(p_room_id, p_user_id, p_guest_token);

  update public.members
  set last_seen_at = now()
  where id = v_member.id
    and last_seen_at < now() - interval '10 seconds';

  return jsonb_build_object('memberId', v_member.id);
end;
$$;
```

No grants are repeated: both signatures are unchanged and `create or replace` preserves their ACLs.

**Every other caller of `private.require_guest` becomes active-only without being touched** — `playback_command`, `queue_add`, `queue_read`, `vote_toggle`, `queue_remove`, `queue_reorder`, the queue preflight and the host heartbeat. That is the reason the test sits in the shared check: the safe default is the one you get by not thinking about it.

- [ ] **Step 5: Apply locally and make it green**

Run: `npx supabase db push --local`
Then: `npx supabase test db --local`
Expected: all files pass, including 17 new assertions.

- [ ] **Step 6: Prove the gate is load-bearing**

Temporarily change `private.require_guest` to skip the status check (`if false then`), run `npx supabase test db --local`, and confirm the queue assertion fails. Restore the check, confirm green again. This is the mutation proof that the assertion is not passing for the wrong reason.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0037_moderated_entry.sql supabase/tests/moderated_entry_test.sql
git commit -m "feat: gate room entry on the host's word, in SQL"
```

---

### Task 2: Operations `approve-member` and `reject-member`

**Files:**
- Create: `server/operations/admission.ts`, `tests/unit/admission.test.ts`
- Modify: `server/operations/errors.ts:17-31`, `server/operations/index.ts`

**Interfaces:**
- Consumes: `requireHostAccess` from `server/operations/catalogAccess.js`; `callOperation`, `requireMemberId`, `requireRoomId` from `server/operations/room.js`; `jsonResponse`/`HttpError` from `errors.js`.
- Produces: `approveMember(request, caller)` and `rejectMember(request, caller): Promise<Response>`; registry entries `'approve-member'` and `'reject-member'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../server/operations/errors';

const db = vi.hoisted(() => ({ query: vi.fn<(text: string, params: unknown[]) => Promise<unknown[]>>() }));

vi.mock('../../server/db/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/db/client.js')>();
  return { ...actual, serviceDatabase: () => ({ query: db.query }) };
});

import { approveMember, rejectMember } from '../../server/operations/admission';
import { requireHostAccess } from '../../server/operations/catalogAccess';

vi.mock('../../server/operations/catalogAccess', () => ({
  requireHostAccess: vi.fn(async () => undefined),
}));

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const CALLER = { userId: '33333333-3333-4333-8333-333333333333', accessToken: 'token' };

function request(headers: Record<string, string>, body: unknown = { roomId: ROOM_ID, memberId: MEMBER_ID }): Request {
  return new Request('http://localhost/api/approve-member', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('admission operations', () => {
  it('refuses without a host pass before touching the database', async () => {
    db.query.mockReset();
    await expect(approveMember(request({}), CALLER as never)).rejects.toMatchObject({ status: 403 });
    expect(db.query).not.toHaveBeenCalled();
    expect(requireHostAccess).not.toHaveBeenCalled();
  });

  it('admits through the database function and returns the new door', async () => {
    db.query.mockReset();
    db.query.mockResolvedValue([{ result: { memberId: MEMBER_ID, displayName: 'Waiting Guest', door: [] } }]);
    const response = await approveMember(request({ 'x-room-host-token': 'h'.repeat(32) }), CALLER as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ memberId: MEMBER_ID, displayName: 'Waiting Guest', door: [] });
    expect(String(db.query.mock.calls[0][0])).toContain('room_approve_member');
  });

  it('maps a denied grant to a failure rather than an empty success', async () => {
    db.query.mockReset();
    db.query.mockRejectedValue(new Error('permission denied for function room_reject_member'));
    await expect(rejectMember(request({ 'x-room-host-token': 'h'.repeat(32) }), CALLER as never))
      .rejects.toBeInstanceOf(HttpError);
  });
});
```

- [ ] **Step 2: Run it to watch it fail**

Run: `npx vitest run tests/unit/admission.test.ts`
Expected: FAIL — cannot resolve `server/operations/admission`.

- [ ] **Step 3: Add the error codes**

In `server/operations/errors.ts`, add to `ERROR_MAP`:

```ts
  ROOM_PENDING: { status: 403, message: 'The host has not let you into the room yet' },
  ROOM_CLOSED: { status: 403, message: 'The host has closed the room' },
```

- [ ] **Step 4: Write the handlers**

```ts
import { HttpError, jsonResponse } from './errors.js';
import { readJsonObject } from './tokens.js';
import { callOperation, requireMemberId, requireRoomId, type Caller } from './room.js';
import { requireHostAccess } from './catalogAccess.js';

async function admission(
  request: Request,
  caller: Caller,
  operation: 'room_approve_member' | 'room_reject_member',
): Promise<Response> {
  const hostToken = request.headers.get('x-room-host-token');
  if (hostToken === null || hostToken.length === 0) {
    throw new HttpError('FORBIDDEN', 403, 'Only the host can answer the door');
  }
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const memberId = requireMemberId(body.memberId);
  await requireHostAccess(caller, roomId, hostToken);

  // callOperation already unwraps the function's jsonb result, throws on an empty
  // one, and maps SQLSTATEs; a denied grant must read as a failure, never a success.
  const result = await callOperation(operation, [roomId, caller.userId, hostToken, memberId]);
  return jsonResponse(result);
}

export function approveMember(request: Request, caller: Caller): Promise<Response> {
  return admission(request, caller, 'room_approve_member');
}

export function rejectMember(request: Request, caller: Caller): Promise<Response> {
  return admission(request, caller, 'room_reject_member');
}
```

`requireMemberId` already exists at `server/operations/room.ts:45`; `callOperation` at `room.ts:65`.

- [ ] **Step 5: Register the operations**

In `server/operations/index.ts`, add `'approve-member'` and `'reject-member'` to the `OPERATIONS` list and two case arms calling the handlers, exactly like the `transfer-host` arm.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/admission.test.ts tests/unit/operationRegistry.test.ts`
Expected: PASS. If the registry test has a floor assertion on the operation count, raise it by two with a comment.

- [ ] **Step 7: Commit**

```bash
git add server/operations/admission.ts server/operations/errors.ts server/operations/index.ts tests/unit/admission.test.ts tests/unit/operationRegistry.test.ts
git commit -m "feat: let the host answer the door"
```

---

### Task 3: The waiting guest's screen

**Files:**
- Create: `src/app/WaitingRoom.tsx`, `tests/unit/waitingRoom.test.tsx`
- Modify: `src/features/rooms/roomApi.ts:61-90`, `src/app/GuestRoomPage.tsx:220`
- Test: extend `tests/unit/guestRoomPage.test.tsx`

**Interfaces:**
- Consumes: the `waiting` payload from Task 1 (`{ roomId, status, room: { name, hostName }, viewer }`); `useRoomData`'s existing polling, which stops only on `ended` (`src/features/rooms/useRoomData.ts:92`).
- Produces: `<WaitingRoom hostName roomName />`; `JoinedRoom.status?: 'joined' | 'waiting'`.

- [ ] **Step 1: Write the failing client tests**

In `tests/unit/waitingRoom.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import WaitingRoom from '../src/app/WaitingRoom';
import '@testing-library/jest-dom/vitest';

afterEach(cleanup);

describe('the waiting room', () => {
  it('names the host who has to let you in, and shows nothing from the room', async () => {
    // The server sends this payload instead of the room; the screen only renders it.
    const { container } = render(<WaitingRoom hostName="Rafa" roomName="Living Room TV" />);
    expect(screen.getByText(/living room tv/i)).toBeInTheDocument();
    expect(screen.getByText(/rafa needs to let you in/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/queue|song|now playing/i);
  });

  it('is announced as a status, so a screen reader says it changed', () => {
    render(<WaitingRoom hostName="Rafa" roomName="Living Room TV" />);
    expect(screen.getByRole('status')).toHaveTextContent(/rafa needs to let you in/i);
  });
});
```

In `tests/unit/guestRoomPage.test.tsx`, add:

```tsx
  it('waits at the door instead of showing an empty room', async () => {
    const api: EdgeApi = {
      invoke: (async (name: string) => {
        if (name === 'guest-room-read') {
          return {
            roomId, status: 'waiting',
            room: { id: roomId, name: 'Moderated', hostName: 'Rafa' },
            viewer: { memberId: 'm1', displayName: 'Guest', role: 'guest', status: 'pending' },
          };
        }
        return {};
      }) as unknown as EdgeApi['invoke'],
    };
    renderGuest(api); // use the file's existing render helper and roomId
    expect(await screen.findByText(/rafa needs to let you in/i)).toBeInTheDocument();
    expect(screen.queryByText(/shared playlist/i)).toBeNull();
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/waitingRoom.test.tsx tests/unit/guestRoomPage.test.tsx`
Expected: FAIL — module not found, then a missing waiting render.

- [ ] **Step 3: Write the component**

`src/app/WaitingRoom.tsx`:

```tsx
import { Logo } from '../ui';

type Props = {
  hostName: string;
  roomName: string;
};

export default function WaitingRoom({ hostName, roomName }: Props) {
  return (
    <div className="min-h-dvh bg-graphite text-ink">
      <header className="border-b border-line px-4 py-4">
        <Logo size="sm" />
      </header>
      <main className="mx-auto flex w-full max-w-[30rem] flex-col items-start gap-4 px-4 py-10">
        <p className="eyebrow text-gold">Waiting at the door</p>
        <h1 className="font-display text-[1.9rem] font-bold leading-[1.05] tracking-[-0.03em]">
          {roomName}
        </h1>
        <p role="status" className="text-[0.9375rem] leading-[1.6] text-ink-2">
          {hostName} needs to let you in. This screen opens by itself once they do.
        </p>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Carry `status` from the join response**

In `src/features/rooms/roomApi.ts`, add to `JoinedRoom`:

```ts
  /** 'waiting' means the host has to admit this device; absent on older servers. */
  status?: 'joined' | 'waiting';
```

In `verifyJoinedRoom`, after the existing field checks, parse and return it:

```ts
  const status = room.status === 'waiting' ? 'waiting' : room.status === 'joined' ? 'joined' : undefined;
```

and include `...(status === undefined ? {} : { status })` in the returned object.

- [ ] **Step 5: Render it**

In `src/app/GuestRoomPage.tsx`, immediately before the existing `if (data === null || data.status === 'ended')` block at line ~220:

```tsx
  if (data !== null && data.status === 'waiting') {
    const waitingRoom = (data as { room?: { name?: unknown; hostName?: unknown } }).room;
    return (
      <WaitingRoom
        roomName={typeof waitingRoom?.name === 'string' ? waitingRoom.name : 'This room'}
        hostName={typeof waitingRoom?.hostName === 'string' ? waitingRoom.hostName : 'The host'}
      />
    );
  }
```

Add `import WaitingRoom from './WaitingRoom';`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/waitingRoom.test.tsx tests/unit/guestRoomPage.test.tsx tests/unit/roomApi.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/WaitingRoom.tsx src/app/GuestRoomPage.tsx src/features/rooms/roomApi.ts tests/unit/waitingRoom.test.tsx tests/unit/guestRoomPage.test.tsx
git commit -m "feat: show a waiting guest the door, and nothing behind it"
```

---

### Task 4: The host's door list, badge, and create toggle

**Files:**
- Create: `src/features/rooms/DoorList.tsx`
- Modify: `src/app/HostRoomPage.tsx` (context + header badge), `src/app/HostSettingsPage.tsx`, `src/app/HomePage.tsx`, `src/features/rooms/roomApi.ts` (`createRoom`, `approveMember`, `rejectMember`)
- Test: extend `tests/unit/hostRoomPage.test.tsx`, `tests/unit/homePage.test.tsx`

**Interfaces:**
- Consumes: `post`-style helpers already in `roomApi.ts`; the host read's `door` array from Task 1; the operations from Task 2.
- Produces: `approveMember(api, roomId, memberId)` / `rejectMember(api, roomId, memberId)` in `roomApi.ts`; `door`, `approveGuest`, `rejectGuest` on the host outlet context.

- [ ] **Step 1: Write the failing host test**

In `tests/unit/hostRoomPage.test.tsx`, extend `liveRoom` with `door: []` and add:

```tsx
  it('shows who is waiting and admits them from settings', async () => {
    const withDoor = {
      ...liveRoom,
      door: [{ memberId: '9d1c', displayName: 'Waiting Guest', online: true, joinedAt: '2026-10-26T00:00:00Z' }],
    };
    const { api, calls } = makeApi(withDoor);
    renderHost(api, '/room/' + roomId + '/host/settings');

    expect(await screen.findByText('Waiting Guest')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /let waiting guest in/i }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'approve-member')).toBe(true);
    });
  });

  it('announces the door count on every host screen', async () => {
    const withDoor = {
      ...liveRoom,
      door: [{ memberId: '9d1c', displayName: 'Waiting Guest', online: true, joinedAt: '2026-10-26T00:00:00Z' }],
    };
    const { api } = makeApi(withDoor);
    renderHost(api);
    expect(await screen.findByText(/1 at the door/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/unit/hostRoomPage.test.tsx`
Expected: FAIL — no "Waiting Guest" and no badge.

- [ ] **Step 3: Add the client calls**

In `src/features/rooms/roomApi.ts`:

```ts
export type DoorEntry = { memberId: string; displayName: string; online: boolean; joinedAt: string };

export async function approveMember(api: EdgeApi, roomId: string, memberId: string): Promise<{ door: DoorEntry[] }> {
  return api.invoke('approve-member', { roomId, memberId }, { hostToken: loadHostToken(roomId) ?? undefined });
}

export async function rejectMember(api: EdgeApi, roomId: string, memberId: string): Promise<{ door: DoorEntry[] }> {
  return api.invoke('reject-member', { roomId, memberId }, { hostToken: loadHostToken(roomId) ?? undefined });
}
```

Extend `createRoom`'s options with `requireApproval?: boolean` and pass it as the ninth RPC argument (`requireApproval === true`), mirroring how `guestsCanAdd`/`guestsCanControlPlayback` are already inverted into the two lock booleans.

- [ ] **Step 4: Build the door list**

`src/features/rooms/DoorList.tsx`:

```tsx
import { Button } from '../../ui';
import type { DoorEntry } from './roomApi';

type Props = {
  door: DoorEntry[];
  busyId: string | null;
  onApprove: (memberId: string) => void;
  onReject: (memberId: string) => void;
};

export default function DoorList({ door, busyId, onApprove, onReject }: Props) {
  if (door.length === 0) {
    return <p className="text-[0.75rem] text-ink-2">Nobody is waiting at the door.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {door.map((entry) => (
        <li key={entry.memberId} className="flex flex-wrap items-center justify-between gap-3 rounded-badge border border-line bg-surface px-3 py-2">
          <span className="text-[0.8125rem] text-ink">{entry.displayName}</span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              busy={busyId === entry.memberId}
              onClick={() => onApprove(entry.memberId)}
            >
              Let {entry.displayName} in
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={busyId === entry.memberId}
              onClick={() => onReject(entry.memberId)}
            >
              Keep them out
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Wire the host context and the badge**

In `src/app/HostRoomPage.tsx`, mirror the existing `transferRoom` callback:

```tsx
  const [doorBusyId, setDoorBusyId] = useState<string | null>(null);
  const approveGuest = useCallback(async (memberId: string): Promise<void> => {
    setDoorBusyId(memberId);
    try {
      await approveMember(api, roomId, memberId);
      notify('They are in.');
      await refresh();
    } catch (caught) {
      notify('That guest could not be admitted.', caught instanceof Error ? caught.message : undefined, 'error');
    } finally {
      setDoorBusyId(null);
    }
  }, [api, notify, refresh, roomId]);
```

(`rejectGuest` is the same with `rejectMember` and "They were turned away.") Add `door`, `doorBusyId`, `approveGuest`, `rejectGuest` to the outlet context next to `transferRoom`.

In the host header, beside the existing roster chip, add:

```tsx
{door.length === 0 ? null : (
  <Chip tone="gold">{door.length} at the door</Chip>
)}
```

In `src/app/HostSettingsPage.tsx`, add a section that renders `<DoorList door={door} busyId={doorBusyId} onApprove={approveGuest} onReject={rejectGuest} />` under a heading "At the door", placed above the guest roster.

- [ ] **Step 6: Add the create toggle**

In `src/app/HomePage.tsx`, beside the existing two guest-permission switches, add a third with the same markup pattern:

```tsx
<Switch
  checked={requireApproval}
  onChange={setRequireApproval}
  label="Approve each guest"
  description="New guests wait at the door until you let them in. You can close the room later from settings."
/>
```

(`onChange` must match the switch component's real prop names — read one of the two existing switches and copy its signature exactly.) Pass `requireApproval` into `createRoom`.

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run tests/unit/hostRoomPage.test.tsx tests/unit/homePage.test.tsx && npx tsc --noEmit`
Expected: PASS and no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/features/rooms/DoorList.tsx src/features/rooms/roomApi.ts src/app/HostRoomPage.tsx src/app/HostSettingsPage.tsx src/app/HomePage.tsx tests/unit/hostRoomPage.test.tsx tests/unit/homePage.test.tsx
git commit -m "feat: give the host a door to answer"
```

---

### Task 5: Verify, apply to production, deploy, prove

**Files:** none modified; this task is verification and release.

**Interfaces:** Consumes everything above.

- [ ] **Step 1: Run the full local gates**

```bash
npx tsc --noEmit
npm test
npx supabase db push --local
npx supabase test db --local
npm run build
```
Expected: 0 type errors, all Vitest files pass, all pgTAP files pass, build succeeds.

- [ ] **Step 2: Mutation-check the two load-bearing assertions**

Revert `require_guest`'s status check and re-run the DB suite; confirm the queue assertion fails. Revert the `read_room_guest` waiting branch; confirm the three "cannot read" assertions fail. Restore both.

- [ ] **Step 3: Apply 0037 to production, migration before deploy**

```bash
set -a && . ./server/.env.neon && set +a
export NEON_DATABASE_URL="$(printf '%s' "$NEON_DATABASE_URL" | tr -d '\r' | sed 's/^"//; s/"$//')"
npx supabase db push --db-url "$NEON_DATABASE_URL" --dry-run
npx supabase db push --db-url "$NEON_DATABASE_URL"
```

Then verify by query: `schema_migrations` reads `0037`, `members.status` exists, and `echo_service` has execute on both door functions.

- [ ] **Step 4: Push and watch**

```bash
git push origin HEAD:master
gh run watch "$(gh run list --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```
Then confirm the Vercel deployment reached Ready.

- [ ] **Step 5: The two-browser proof**

With the Playwright browser as the host at TV size and an isolated 390px context as the guest:

1. Create a room with "Approve each guest" on; the guest joins and sees the waiting screen with the host's name and no queue.
2. The host's settings show the guest at the door; the header badge reads "1 at the door".
3. Approve; the guest's screen becomes the live remote within one poll, with no reload.
4. Lock admissions from settings; a third context is refused with "The host has closed the room".
5. Reject a second waiting guest; their next poll reports the pass is gone.

Record the event rows (`join`, `approve`, `reject`) and end the room afterwards.

- [ ] **Step 6: Commit any doc updates**

Append the shipped section to `docs/deployment/hosted-setup.md` (proof, costs, what was not verified) and commit.

---

## Self-Review

**Spec coverage:** §3 switches → Task 1 (`require_approval`, `admissions_locked`) and Task 4 (create toggle). §4 data → Task 1. §5 join order → Task 1 `join_room`. §6 pending read and participation → Task 1 (`read_room_guest`, the active-only `require_guest`, roster/door) and Task 3 (screen). §7 host side → Tasks 2 and 4. §8 client → Tasks 3 and 4. §9 failure modes → covered by Task 1's assertions (ended before pending, lock exempts members, rejoin preserves status) and Task 5's live proof. §10 deploy order → Task 5. §11 tests → Task 1's ten groups plus Tasks 2-4. §12 out of scope → nothing built for it. §13 order → the task order.

**Two corrections the plan makes to the spec, deliberately:**

1. The gate goes into `private.require_guest` itself rather than into the operations the spec named, so `queue_read`, `vote_toggle`, `queue_remove` and `queue_reorder` are covered too. A waiting guest able to read the queue through a second operation would defeat the feature, and putting the test in the shared check means a future operation inherits the safe behavior instead of having to remember it.
2. The `reject` event cannot carry the rejected member's id: `room_events` has a cascading composite foreign key to `members` (`0001_room_core.sql:107-108`), so the event would delete itself along with the row. It is written with a null `member_id` and the name in the payload.

**Type consistency:** `DoorEntry` is defined once (Task 4) and used by `DoorList` and the host context. `require_guest_any` and `require_guest` both return `public.members`, so a caller can swap one for the other without touching the rest of its body. The door payload key is `door` in both SQL and client. Operation names are `approve-member` / `reject-member` everywhere.
