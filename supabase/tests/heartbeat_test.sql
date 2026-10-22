begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

create temp table hb on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'memberId')::uuid as member_id,
  created ->> 'hostToken' as host_token,
  created ->> 'guestToken' as guest_token
from (
  select public.create_room(
    'HBTEST0000000001',
    'heartbeat-user-1',
    'Heartbeat Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

select is(
  has_function_privilege('anon', 'public.touch_host(uuid, text)', 'execute'),
  false,
  'anon cannot run the host heartbeat');
select is(
  has_function_privilege('service_role', 'public.touch_host(uuid, text)', 'execute'),
  true,
  'service_role can run the host heartbeat');

update public.members
set last_seen_at = now() - interval '1 minute'
where id = (select member_id from hb);

select ok(
  (select last_seen_at < now() - interval '30 seconds' from public.members where id = (select member_id from hb)),
  'the host heartbeat starts stale');
select is(
  public.touch_host((select room_id from hb), (select host_token from hb)) ->> 'memberId',
  (select member_id::text from hb),
  'the host pass refreshes the host member without an auth user id');
select ok(
  (select last_seen_at > now() - interval '10 seconds' from public.members where id = (select member_id from hb)),
  'the host heartbeat advances last_seen_at');

select throws_ok(
  format('select public.touch_host(%L::uuid, %L)', (select room_id from hb), repeat('x', 40)),
  '28000', 'UNAUTHORIZED',
  'the host heartbeat requires the host pass');
select throws_ok(
  format('select public.touch_member(%L::uuid, %L::text, %L)', (select room_id from hb), 'another-user', (select guest_token from hb)),
  '28000', 'UNAUTHORIZED',
  'the guest heartbeat remains bound to its auth user');

update public.rooms
set status = 'ended', ended_at = now()
where id = (select room_id from hb);

select throws_ok(
  format('select public.touch_host(%L::uuid, %L)', (select room_id from hb), (select host_token from hb)),
  '22023', 'ROOM_ENDED',
  'the host heartbeat rejects an ended room');
select throws_ok(
  format('select public.touch_member(%L::uuid, %L::text, %L)', (select room_id from hb), 'heartbeat-user-1', (select guest_token from hb)),
  '22023', 'ROOM_ENDED',
  'the guest heartbeat rejects an ended room');

select * from finish();
rollback;
