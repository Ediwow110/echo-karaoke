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
  ) ? 'playback'),
  false,
  'a waiting guest cannot read the playback state'
);

select is(
  (select public.read_room_guest(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  ) ? 'events'),
  false,
  'a waiting guest cannot read the event feed'
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

select throws_ok(
  $$select public.queue_read(
    (select room_id from ctx), 'me-guest', repeat('a', 40)
  )$$,
  '42501',
  null,
  'a waiting guest cannot read the queue through the queue endpoint'
);

select throws_ok(
  $$select public.vote_toggle(
    (select room_id from ctx), 'me-guest', repeat('a', 40),
    '00000000-0000-0000-0000-000000000000'::uuid
  )$$,
  '42501',
  null,
  'a waiting guest cannot vote'
);

select throws_ok(
  $$select public.playback_command(
    (select room_id from ctx), 'me-guest', repeat('a', 40),
    null::text, 'play'
  )$$,
  '42501',
  null,
  'a waiting guest cannot drive playback'
);

select throws_ok(
  $$select public.room_approve_member(
    (select room_id from ctx), 'me-bystander', repeat('z', 40),
    (select m.id from public.members m where m.user_id = 'me-guest')
  )$$,
  '28000',
  null,
  'a bystander with no host token cannot admit the waiting guest'
);

select is(
  (select jsonb_build_object(
    'count', jsonb_array_length(host -> 'door'),
    'displayName', host -> 'door' -> 0 ->> 'displayName',
    'memberId', host -> 'door' -> 0 ->> 'memberId'
  )
  from (
    select public.read_room_host(
      (select room_id from ctx), 'me-host', (select host_token from ctx)
    ) as host
  ) h),
  jsonb_build_object(
    'count', 1,
    'displayName', 'Waiting Guest',
    'memberId', (select m.id::text from public.members m where m.user_id = 'me-guest')
  ),
  'the door holds exactly the waiting guest before the host decides'
);

select is(
  (select private.room_roster((select room_id from ctx))::text like '%Waiting Guest%'),
  false,
  'a pending guest never appears in the roster'
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

-- The settings switch is the same gate, not a second one: whatever the host
-- sets must show up in the host read the switch renders from.
select is(
  (select public.room_set_admissions(
    (select room_id from ctx), 'me-host', (select host_token from ctx), false
  ) ->> 'admissionsLocked'),
  'false',
  'the host reopens the door through the settings operation'
);

select is(
  (select public.read_room_host(
    (select room_id from ctx), 'me-host', (select host_token from ctx)
  ) -> 'room' ->> 'admissionsLocked'),
  'false',
  'the host read agrees the door is open again'
);

select is(
  (select public.room_set_admissions(
    (select room_id from ctx), 'me-host', (select host_token from ctx), true
  ) ->> 'admissionsLocked'),
  'true',
  'the host closes the door through the settings operation'
);

select is(
  (select public.read_room_host(
    (select room_id from ctx), 'me-host', (select host_token from ctx)
  ) -> 'room' ->> 'admissionsLocked'),
  'true',
  'the host read reflects the closed door the switch renders'
);

select throws_ok(
  $$select public.join_room(
    (select room_code from ctx), 'me-locked-out', 'Locked Out', repeat('d', 40)
  )$$,
  '22023',
  'ROOM_CLOSED',
  'a guest arriving after the host closes the door is turned away'
);

select is(
  has_function_privilege('authenticated', 'public.room_approve_member(uuid, text, text, uuid)', 'execute'),
  false,
  'only the service role may call the door operations'
);

select is(
  has_function_privilege('authenticated', 'public.room_set_admissions(uuid, text, text, boolean)', 'execute'),
  false,
  'only the service role may close the door'
);

-- A waiting guest is not in the room, so they cannot be handed it. Without the
-- active check this promotion leaves a host row that the roster hides and the
-- door lists, and the new host never sees a host screen.
create temp table promote_ctx on commit drop as
select
  (promoted ->> 'roomId')::uuid as room_id,
  (promoted ->> 'roomCode') as room_code
from (select public.create_room(
  'ME00000000000004', 'me-promote-host', 'Promote Host',
  repeat('v', 40), repeat('w', 40), 'Promotion Check', false, true, true
) as promoted) s;

select public.join_room(
  (select room_code from promote_ctx), 'me-still-waiting', 'Still Waiting',
  repeat('x', 40)
);

select throws_ok(
  $$select public.room_transfer_host(
    (select room_id from promote_ctx), 'me-promote-host', repeat('w', 40),
    (select m.id from public.members m
      where m.room_id = (select room_id from promote_ctx)
        and m.user_id = 'me-still-waiting'),
    repeat('y', 40)
  )$$,
  '22023',
  null,
  'a guest still waiting at the door cannot be handed the room'
);

-- Default path: a room without the toggle admits people straight in.
create temp table open_ctx on commit drop as
select
  (open_room ->> 'roomId')::uuid as room_id,
  (open_room ->> 'roomCode') as room_code
from (select public.create_room(
  'ME00000000000002', 'me-open-host', 'Open Host',
  repeat('o', 40), repeat('p', 40)
) as open_room) s;

select is(
  (select public.join_room(
    (select room_code from open_ctx), 'me-open-guest', 'Walk Right In',
    repeat('n', 40)
  ) ->> 'status'),
  'joined',
  'a room without the toggle still admits guests straight in'
);

-- Transfer, then prove the outgoing pass is worth nothing afterwards.
create temp table heir_ctx on commit drop as
select
  (heir_room ->> 'roomId')::uuid as room_id,
  (heir_room ->> 'roomCode') as room_code
from (select public.create_room(
  'ME00000000000003', 'me-outgoing-host', 'Outgoing Host',
  repeat('q', 40), repeat('r', 40)
) as heir_room) s;

select public.join_room(
  (select room_code from heir_ctx), 'me-heir', 'Heir Apparent', repeat('s', 40)
);

select public.room_transfer_host(
  (select room_id from heir_ctx), 'me-outgoing-host', repeat('r', 40),
  (select m.id from public.members m
    where m.room_id = (select room_id from heir_ctx)
      and m.user_id = 'me-heir'),
  repeat('t', 40)
);

select throws_ok(
  $$select public.room_approve_member(
    (select room_id from heir_ctx), 'me-outgoing-host', repeat('r', 40),
    (select m.id from public.members m
      where m.room_id = (select room_id from heir_ctx)
        and m.user_id = 'me-heir')
  )$$,
  '28000',
  null,
  'the demoted host pass cannot admit anyone after a transfer'
);

-- The lock exempts a member the room already knows, and it turns nobody into
-- anything: a waiting guest rejoins as waiting.
create temp table pending_ctx on commit drop as
select
  (pending_room ->> 'roomId')::uuid as room_id,
  (pending_room ->> 'roomCode') as room_code
from (select public.create_room(
  'ME00000000000005', 'me-pending-host', 'Pending Host',
  repeat('k', 40), repeat('l', 40), 'Waiting Room', false, true, true
) as pending_room) s;

select public.join_room(
  (select room_code from pending_ctx), 'me-kept-waiting', 'Kept Waiting',
  repeat('m', 40)
);

select public.room_set_admissions(
  (select room_id from pending_ctx), 'me-pending-host', repeat('l', 40), true
);

select is(
  (select public.join_room(
    (select room_code from pending_ctx), 'me-kept-waiting', 'Kept Waiting',
    repeat('m', 40)
  ) ->> 'status'),
  'waiting',
  'a waiting guest can rejoin while the door is locked'
);

select is(
  (select public.read_room_guest(
    (select room_id from pending_ctx), 'me-kept-waiting', repeat('m', 40)
  ) ->> 'status'),
  'waiting',
  'and the locked door leaves them waiting, not admitted'
);

update public.rooms
set status = 'ended', ended_at = now()
where id = (select room_id from pending_ctx);

select is(
  (select public.read_room_guest(
    (select room_id from pending_ctx), 'me-kept-waiting', repeat('m', 40)
  ) ->> 'status'),
  'ended',
  'an ended room reads as ended even to a guest still waiting at the door'
);

select throws_ok(
  $$select public.room_set_admissions(
    (select room_id from ctx), 'me-guest', repeat('a', 40), true
  )$$,
  '28000',
  null,
  'a guest pass cannot close the door'
);

select * from finish();
rollback;
