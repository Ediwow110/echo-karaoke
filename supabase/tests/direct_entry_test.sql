-- Direct entry: scanning a code puts a guest in the room, with no door.
--
-- This replaces the moderated-entry suite. It pins the removal in both
-- directions: the new join lands a working member immediately, and the door
-- objects are actually gone rather than merely unused.
begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- The eight-argument form is live. The nine-argument form survives one deploy
-- window as a delegate (the shipped server still calls it), so keep it working
-- until a later migration retires it.
select isnt(
  to_regprocedure('public.create_room(text, text, text, text, text, text, boolean, boolean)'),
  null::regprocedure,
  'the eight-argument create_room is the live signature');
select isnt(
  to_regprocedure('public.create_room(text, text, text, text, text, text, boolean, boolean, boolean)'),
  null::regprocedure,
  'the nine-argument create_room survives as the deploy-window delegate');

-- The door surface is gone.
select is(
  to_regprocedure('public.room_approve_member(uuid, text, text, uuid)'),
  null::regprocedure,
  'approve-member no longer exists');
select is(
  to_regprocedure('public.room_reject_member(uuid, text, text, uuid)'),
  null::regprocedure,
  'reject-member no longer exists');
select is(
  to_regprocedure('public.room_set_approval(uuid, text, text, boolean)'),
  null::regprocedure,
  'set-approval no longer exists');
select is(
  to_regprocedure('private.room_door(uuid)'),
  null::regprocedure,
  'the door listing no longer exists');
select is(
  to_regprocedure('private.require_guest_any(uuid, text, text)'),
  null::regprocedure,
  'the permissive guest check no longer exists');

-- The columns are gone, so no write path can reintroduce a waiting state.
select is(
  (select count(*)::int
   from information_schema.columns
   where table_schema = 'public' and table_name = 'members' and column_name = 'status'),
  0,
  'members has no status column');
select is(
  (select count(*)::int
   from information_schema.columns
   where table_schema = 'public' and table_name = 'rooms' and column_name = 'require_approval'),
  0,
  'rooms has no require_approval column');

create temp table dctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'NPQRSTVWXYZ01234',
    'direct-host',
    'Direct Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

-- A join is a membership the moment it lands: no status gate, and the guest
-- read returns the live room on the very next call.
create temp table dguest on commit drop as
select
  (joined ->> 'memberId')::uuid as member_id,
  (joined ->> 'guestToken') as guest_token,
  joined
from (
  select public.join_room(
    'NPQRSTVWXYZ01234',
    'direct-guest',
    'Direct Guest',
    repeat('m', 40)
  ) as joined
) s;

select is(
  (select joined ? 'status' from dguest),
  false,
  'join answers without a waiting status');

select is(
  (select count(*)::int
   from public.members
   where room_id = (select room_id from dctx)
     and user_id = 'direct-guest'),
  1,
  'the joining guest owns exactly one member row');

select is(
  public.read_room_guest(
    (select room_id from dctx),
    'direct-guest',
    (select guest_token from dguest)
  ) ->> 'status',
  'live',
  'the guest reads the live room immediately');

select is(
  public.read_room_guest(
    (select room_id from dctx),
    'direct-guest',
    (select guest_token from dguest)
  ) -> 'room' ? 'requireApproval',
  false,
  'the guest read carries no approval switch');

select is(
  public.read_room_host(
    (select room_id from dctx),
    'direct-host',
    (select host_token from dctx)
  ) ? 'door',
  false,
  'the host read carries no door');

select is(
  public.read_room_host(
    (select room_id from dctx),
    'direct-host',
    (select host_token from dctx)
  ) -> 'room' ? 'requireApproval',
  false,
  'the host read carries no approval switch');

select is(
  public.read_room_guest(
    (select room_id from dctx),
    'direct-guest',
    (select guest_token from dguest)
  ) -> 'viewer' ? 'status',
  false,
  'the viewer payload has no membership status');

-- The surviving door lock still refuses an arrival the room has never seen.
select lives_ok(
  format('select public.room_set_admissions(%L::uuid, %L::text, %L, true)',
    (select room_id from dctx), 'direct-host', (select host_token from dctx)),
  'the host closes the door to new guests');
select throws_ok(
  format('select public.join_room(%L, %L::text, %L::text, %L)',
    'NPQRSTVWXYZ01234', 'direct-late', 'Late Guest', repeat('n', 40)),
  '22023', 'ROOM_CLOSED',
  'a new guest is turned away while the door is closed');
select lives_ok(
  format('select public.room_set_admissions(%L::uuid, %L::text, %L, false)',
    (select room_id from dctx), 'direct-host', (select host_token from dctx)),
  'the host reopens the door');
select lives_ok(
  format('select public.join_room(%L, %L::text, %L::text, %L)',
    'NPQRSTVWXYZ01234', 'direct-late', 'Late Guest', repeat('n', 40)),
  'a new guest joins as soon as the door reopens');

-- The delegate ignores the approval flag: it cannot moderate anything because
-- nothing can be pending. Calling it with true must still land a direct guest.
select lives_ok(
  format('select public.create_room(%L, %L::text, %L::text, %L, %L, %L::text, false, true, true)',
    'NPQRSTVWXYZ01235', 'delegate-host', 'Delegate Host', repeat('x', 40), repeat('y', 40), 'Delegate room'),
  'the nine-argument delegate still creates a room');
select is(
  (select public.join_room('NPQRSTVWXYZ01235', 'delegate-guest', 'Delegate Guest', repeat('z', 40))) ? 'status',
  false,
  'a room created through the delegate still admits its guest directly');

-- The runtime role must reach the new signature, or the app 42501s on create.
select is(
  has_function_privilege('service_role', 'public.create_room(text, text, text, text, text, text, boolean, boolean)', 'execute'),
  true,
  'service_role can create a room');
select is(
  (select case
     when not exists (select 1 from pg_roles where rolname = 'echo_service') then true
     else has_function_privilege('echo_service', 'public.create_room(text, text, text, text, text, text, boolean, boolean)', 'execute')
   end),
  true,
  'the runtime role can create a room when it exists');

select * from finish();
rollback;
