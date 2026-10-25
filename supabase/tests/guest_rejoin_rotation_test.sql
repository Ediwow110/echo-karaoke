-- DOCUMENTATION/REGRESSION FIXTURE: run ONLY after explicit approval on
-- an isolated disposable Neon test branch with the applicable migrations.
-- This describes current SQL behavior. It is NOT an idempotent-replay fix.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create temp table rejoin_ctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id
from (
  select public.create_room(
    'RJ0N000000000001', 'rejoin-host',
    'Rejoin Test Host', repeat('h', 40), repeat('i', 40)
  ) as created
) x;

create temp table first_join on commit drop as
select (joined ->> 'memberId')::uuid as member_id
from (
  select public.join_room(
    'RJ0N000000000001', 'rejoin-guest',
    'Test Guest', repeat('a', 40), 50
  ) as joined
) x;

select lives_ok(
  format('select public.read_room_guest(%L::uuid, %L, %L)',
    (select room_id from rejoin_ctx), 'rejoin-guest', repeat('a', 40)),
  'the initial guest pass reads the room');

select is(
  (public.join_room(
    'RJ0N000000000001', 'rejoin-guest',
    'Test Guest', repeat('b', 40), 50
  ) ->> 'memberId')::uuid,
  (select member_id from first_join),
  'same-identity rejoin reuses the membership row');

select is(
  (select count(*)::int from public.members
   where room_id = (select room_id from rejoin_ctx)
     and user_id = 'rejoin-guest' and role = 'guest'),
  1,
  'same-identity rejoin does not duplicate the member');

select throws_ok(
  format('select public.read_room_guest(%L::uuid, %L, %L)',
    (select room_id from rejoin_ctx), 'rejoin-guest', repeat('a', 40)),
  '28000', 'UNAUTHORIZED',
  'rejoin revoked the previous guest capability');

select lives_ok(
  format('select public.read_room_guest(%L::uuid, %L, %L)',
    (select room_id from rejoin_ctx), 'rejoin-guest', repeat('b', 40)),
  'the newly issued guest capability reads the room');

select * from finish();
rollback;
