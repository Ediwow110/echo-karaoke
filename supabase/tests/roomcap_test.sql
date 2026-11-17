begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

create temp table cap on commit drop as
select (created ->> 'roomId')::uuid as room_id
from (
  select public.create_room(
    'CAPTEST000000001',
    'cap-host',
    'Cap Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

select function_privs_are(
  'public', 'join_room',
  array['text', 'text', 'text', 'text', 'integer'],
  'anon', array[]::text[],
  'anon cannot execute join_room');
select is(
  has_function_privilege('service_role', 'public.join_room(text, text, text, text, integer)', 'execute'),
  true,
  'service_role can execute join_room');

select is(
  public.join_room('CAPTEST000000001', 'cap-guest-1', 'Guest One', repeat('a', 40), 3) ->> 'role',
  'guest',
  'the first guest joins a room capped at three');
select is(
  public.join_room('CAPTEST000000001', 'cap-guest-2', 'Guest Two', repeat('b', 40), 3) ->> 'role',
  'guest',
  'the second guest fills the room');
select throws_ok(
  format('select public.join_room(%L, %L, %L, %L, 3)', 'CAPTEST000000001', 'cap-guest-3', 'Guest Three', repeat('c', 40)),
  '22023', 'ROOM_FULL',
  'a new guest is rejected at the cap');
select is(
  public.join_room('CAPTEST000000001', 'cap-guest-1', 'Guest One Again', repeat('d', 40), 3) ->> 'role',
  'guest',
  'an existing guest rejoins at the cap');

update public.members
set last_seen_at = now() - interval '2 minutes'
where room_id = (select room_id from cap)
  and user_id = 'cap-guest-2';

select is(
  public.join_room('CAPTEST000000001', 'cap-guest-3', 'Guest Three Arrives', repeat('j', 40), 3) ->> 'role',
  'guest',
  'an inactive guest frees a room slot');

select throws_ok(
  format('select public.join_room(%L, %L, %L, %L, 3)', 'CAPTEST000000001', 'cap-guest-2', 'Guest Two Returns', repeat('k', 40)),
  '22023', 'ROOM_FULL',
  'a stale guest cannot re-enter a full room');

select throws_ok(
  format('select public.touch_member(%L::uuid, %L, %L, %L)', (select room_id from cap), 'cap-guest-2', repeat('b', 40), 3),
  '22023', 'ROOM_FULL',
  'a stale guest heartbeat cannot revive past the cap');

-- Free one slot, then the same stale guest must revive: the cap blocks a
-- crowded revive, not every heartbeat from a member that went quiet.
update public.members
set last_seen_at = now() - interval '2 minutes'
where room_id = (select room_id from cap)
  and user_id = 'cap-guest-3';

select is(
  public.touch_member((select room_id from cap), 'cap-guest-2', repeat('b', 40), 3) ->> 'memberId',
  (select id::text from public.members
    where room_id = (select room_id from cap) and user_id = 'cap-guest-2'),
  'a stale guest revives when a slot is free');

select throws_ok(
  format('select public.touch_member(%L::uuid, %L, %L, 1)', (select room_id from cap), 'cap-guest-2', repeat('b', 40)),
  '22023', 'VALIDATION_ERROR',
  'the heartbeat cap below two is rejected');
select throws_ok(
  format('select public.touch_member(%L::uuid, %L, %L, 501)', (select room_id from cap), 'cap-guest-2', repeat('b', 40)),
  '22023', 'VALIDATION_ERROR',
  'the heartbeat cap above five hundred is rejected');

select is(
  (select count(*) from pg_proc
    where proname = 'touch_member'
      and pronamespace = 'public'::regnamespace
      and proargtypes::text = 'uuid text text'),
  0::bigint,
  'the uncapped three-argument heartbeat overload is gone');
select function_privs_are(
  'public', 'touch_member',
  array['uuid', 'text', 'text', 'integer'],
  'anon', array[]::text[],
  'anon cannot execute the capped heartbeat');
select is(
  has_function_privilege('service_role', 'public.touch_member(uuid, text, text, integer)', 'execute'),
  true,
  'service_role can execute the capped heartbeat');
select is(
  has_function_privilege('echo_service', 'public.touch_member(uuid, text, text, integer)', 'execute'),
  true,
  'the runtime role can execute the capped heartbeat');

create temp table cap2 on commit drop as
select (created ->> 'roomId')::uuid as room_id
from (
  select public.create_room(
    'CAPTEST000000002',
    'cap-host-2',
    'Cap Host Two',
    repeat('l', 40),
    repeat('n', 40)
  ) as created
) s;

select is(
  public.join_room('CAPTEST000000002', 'cap-guest-7', 'Guest Seven', repeat('p', 40), 2) ->> 'role',
  'guest',
  'one guest joins a room capped at two');

update public.members
set last_seen_at = now() - interval '2 minutes'
where room_id = (select room_id from cap2)
  and role = 'host';

select throws_ok(
  format('select public.join_room(%L, %L, %L, %L, 2)', 'CAPTEST000000002', 'cap-guest-8', 'Guest Eight', repeat('q', 40)),
  '22023', 'ROOM_FULL',
  'a stale host still occupies a slot');

select throws_ok(
  format('select public.join_room(%L, %L, %L, %L, 1)', 'CAPTEST000000001', 'cap-guest-4', 'Guest Four', repeat('e', 40)),
  '22023', 'VALIDATION_ERROR',
  'a cap below two is rejected');
select throws_ok(
  format('select public.join_room(%L, %L, %L, %L, 501)', 'CAPTEST000000001', 'cap-guest-5', 'Guest Five', repeat('f', 40)),
  '22023', 'VALIDATION_ERROR',
  'a cap above five hundred is rejected');
select is(
  public.join_room('CAPTEST000000001', 'cap-guest-6', 'Guest Six', repeat('i', 40)) ->> 'role',
  'guest',
  'the fourth argument keeps the default cap');

select * from finish();
rollback;
