begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Host authority is a pass with no identity binding, and the abandoned-room
-- sweep deletes only rooms nobody heartbeats. A pass lifted from a lost or
-- shared device therefore kept a dead room under host control forever. A room
-- now has a hard 24 hour life: every liveness check reports ended, mutations
-- refuse, and a sweep removes the row even while heartbeats arrive.

create temp table live_ctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'roomCode') as room_code
from (select public.create_room(
  'KA00000000000001', 'lt-host', 'Lifetime Host',
  repeat('a', 40), repeat('b', 40)
) as created) c;

select public.join_room(
  (select room_code from live_ctx), 'lt-guest', 'Lifetime Guest', repeat('c', 40), 50
);

select is(
  public.read_room_guest(
    (select room_id from live_ctx), 'lt-guest', repeat('c', 40)
  ) ->> 'status',
  'live',
  'a new room reads as live');

update public.rooms set created_at = now() - interval '23 hours'
  where id = (select room_id from live_ctx);

select is(
  public.read_room_guest(
    (select room_id from live_ctx), 'lt-guest', repeat('c', 40)
  ) ->> 'status',
  'live',
  'a room just under the ceiling is still live');

select is(
  public.host_access_check(
    (select room_id from live_ctx), 'lt-host', repeat('b', 40)
  ) ->> 'status',
  'live',
  'the host guard still reports live under the ceiling');

update public.rooms set created_at = now() - interval '24 hours 1 minute'
  where id = (select room_id from live_ctx);

select is(
  public.read_room_guest(
    (select room_id from live_ctx), 'lt-guest', repeat('c', 40)
  ) ->> 'status',
  'ended',
  'a guest read reports an expired room as ended');

select isnt(
  public.read_room_guest(
    (select room_id from live_ctx), 'lt-guest', repeat('c', 40)
  ) ->> 'endedAt',
  null,
  'the guest read names the expiry as the end time');

select is(
  public.read_room_host(
    (select room_id from live_ctx), 'lt-host', repeat('b', 40)
  ) ->> 'status',
  'ended',
  'the host read reports an expired room as ended');

select is(
  public.host_access_check(
    (select room_id from live_ctx), 'lt-host', repeat('b', 40)
  ) ->> 'status',
  'ended',
  'the host guard reports an expired room as ended');

select is(
  public.room_access_check(
    (select room_id from live_ctx), 'lt-guest', repeat('c', 40)
  ) ->> 'status',
  'ended',
  'the guest guard reports an expired room as ended');

select throws_ok(
  format('select public.touch_host(%L::uuid, %L)',
    (select room_id from live_ctx), repeat('b', 40)),
  '22023', 'ROOM_ENDED',
  'a stolen host pass cannot heartbeat an expired room');

select throws_ok(
  format('select public.join_room(%L, %L, %L, %L, 50)',
    (select room_code from live_ctx), 'lt-late', 'Late Guest', repeat('d', 40)),
  '22023', 'ROOM_ENDED',
  'a guest cannot join an expired room');

-- The sweep is the storage half of the same ceiling: it must remove a room
-- even when a member heartbeat is still arriving for it.
create temp table sweep_ctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id
from (select public.create_room(
  'KA00000000000002', 'lt-sweep-host', 'Sweep Host',
  repeat('e', 40), repeat('f', 40)
) as created) c;

select public.touch_host((select room_id from sweep_ctx), repeat('f', 40));

update public.rooms set created_at = now() - interval '25 hours'
  where id = (select room_id from sweep_ctx);

select public.cleanup_expired_rooms(interval '24 hours');

select is(
  (select count(*) from public.rooms where id = (select room_id from sweep_ctx)),
  0::bigint,
  'the expiry sweep removes a heartbeated room past the ceiling');

select throws_ok(
  $$select public.cleanup_expired_rooms(interval '5 minutes')$$,
  '22023',
  'VALIDATION_ERROR',
  'the expiry sweep refuses a lifetime short enough to delete live parties');

select is(
  has_function_privilege('anon', 'public.cleanup_expired_rooms(interval)', 'execute'),
  false,
  'anon cannot run the expiry sweep');

select is(
  has_function_privilege('service_role', 'public.cleanup_expired_rooms(interval)', 'execute'),
  true,
  'the runtime role can run the expiry sweep');

select * from finish();
rollback;
