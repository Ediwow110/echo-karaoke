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
