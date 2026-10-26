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

select is(
  has_function_privilege('authenticated', 'public.room_approve_member(uuid, text, text, uuid)', 'execute'),
  false,
  'only the service role may call the door operations'
);

select * from finish();
rollback;
