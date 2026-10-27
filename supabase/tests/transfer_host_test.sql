begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Host authority is one shared secret stored only as a digest, so a transfer
-- cannot hand the new secret to the device that asked for it. The flow is
-- therefore two calls: transfer invalidates the outgoing secret and flips the
-- roles, and the promoted member mints their own secret with the guest
-- credential they already hold. These tests pin both halves.

create temp table ctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'memberId')::uuid as host_member_id,
  'th-host' as host_user,
  repeat('h', 40) as old_host_token,
  (joined ->> 'memberId')::uuid as guest_member_id,
  'th-guest' as guest_user,
  repeat('a', 40) as guest_token
from (
  select public.create_room(
    'TH00000000000001', 'th-host', 'Transferring Host',
    repeat('g', 40), repeat('h', 40)
  ) as created
) c
cross join (
  select public.join_room(
    'TH00000000000001', 'th-guest', 'Receiving Guest', repeat('a', 40), 50
  ) as joined
) j;

-- A second guest who must never be able to claim the room.
insert into public.members (room_id, user_id, display_name, guest_token_hash, role)
select (select room_id from ctx), 'th-other', 'Bystander',
  extensions.digest(repeat('o', 40), 'sha256'), 'guest';

select throws_ok(
  format('select public.room_transfer_host(%L::uuid, %L, %L, %L::uuid, %L)',
    (select room_id from ctx), 'th-guest', repeat('a', 40),
    (select host_member_id from ctx), repeat('b', 40)),
  '28000', 'UNAUTHORIZED',
  'a guest cannot transfer the room to someone else');

select throws_ok(
  format('select public.room_transfer_host(%L::uuid, %L, %L, %L::uuid, %L)',
    (select room_id from ctx), 'th-host', repeat('h', 40),
    gen_random_uuid(), repeat('b', 40)),
  '22023', 'VALIDATION_ERROR',
  'control cannot be handed to a stranger who is not in the room');

update public.members set last_seen_at = now() - interval '10 minutes'
  where user_id = 'th-guest';
select throws_ok(
  format('select public.room_transfer_host(%L::uuid, %L, %L, %L::uuid, %L)',
    (select room_id from ctx), 'th-host', repeat('h', 40),
    (select guest_member_id from ctx), repeat('b', 40)),
  '22023', 'VALIDATION_ERROR',
  'control cannot be handed to a guest who has gone quiet');
update public.members set last_seen_at = now() where user_id = 'th-guest';

create temp table done on commit drop as
select (transferred ->> 'guestToken') as new_guest_token,
       transferred ->> 'role' as caller_role
from (
  select public.room_transfer_host(
    (select room_id from ctx), 'th-host', repeat('h', 40),
    (select guest_member_id from ctx), repeat('b', 40)
  ) as transferred
) t;

select is((select caller_role from done), 'guest',
  'the outgoing host is told they are now a guest');

select is(
  (select role from public.members where id = (select guest_member_id from ctx)), 'host',
  'the chosen guest becomes host');
select is(
  (select role from public.members where id = (select host_member_id from ctx)), 'guest',
  'the calling host becomes a guest');

select throws_ok(
  format('select public.host_access_check(%L::uuid, %L, %L)',
    (select room_id from ctx), 'th-host', repeat('h', 40)),
  '28000', 'UNAUTHORIZED',
  'the old host pass stops working the moment control moves');

select lives_ok(
  format('select public.read_room_guest(%L::uuid, %L, %L)',
    (select room_id from ctx), 'th-host', (select new_guest_token from done)),
  'the demoted host keeps a working guest pass instead of being dropped');

select throws_ok(
  format('select public.room_claim_host(%L::uuid, %L, %L, %L)',
    (select room_id from ctx), 'th-other', repeat('o', 40), repeat('c', 40)),
  '28000', 'UNAUTHORIZED',
  'only the member the room was transferred to can claim the host pass');

select throws_ok(
  format('select public.room_claim_host(%L::uuid, %L, %L, %L)',
    (select room_id from ctx), 'th-guest', repeat('wrong', 40), repeat('c', 40)),
  '28000', 'UNAUTHORIZED',
  'claiming is bound to the guest pass that member already holds');

create temp table claimed on commit drop as
select (c ->> 'hostToken') as host_token
from (
  select public.room_claim_host(
    (select room_id from ctx), 'th-guest', repeat('a', 40), repeat('c', 40)
  ) as c
) x;

select isnt((select host_token from claimed), null::text,
  'the promoted member receives a host pass of their own');

select is(
  (public.host_access_check(
    (select room_id from ctx), 'th-guest', (select host_token from claimed)) ->> 'status'),
  'live',
  'the claimed pass authenticates against the same guard every host call uses');

select throws_ok(
  format('select public.host_access_check(%L::uuid, %L, %L)',
    (select room_id from ctx), 'th-guest', repeat('h', 40)),
  '28000', 'UNAUTHORIZED',
  'the pre-transfer secret is dead for the new host too');

select throws_ok(
  format(
    'insert into public.members (room_id, user_id, display_name, guest_token_hash, role) '
    || 'values (%L::uuid, %L, %L, extensions.digest(%L, %L), %L)',
    (select room_id from ctx), 'th-sneak', 'Second Host', 's', 'sha256', 'host'),
  '23505', null,
  'a room cannot end up with two host members');

select is(
  has_function_privilege('anon',
    'public.room_transfer_host(uuid, text, text, uuid, text)', 'execute'),
  false, 'anon cannot transfer a room');
select is(
  has_function_privilege('authenticated',
    'public.room_claim_host(uuid, text, text, text)', 'execute'),
  false, 'authenticated cannot claim a host pass');
select is(
  has_function_privilege('service_role',
    'public.room_transfer_host(uuid, text, text, uuid, text)', 'execute'),
  true, 'the runtime role can transfer a room');

-- The host pass decides who hosts, not the anonymous identity behind it. A host
-- tab's identity can be replaced while its pass keeps working; 0037's heartbeat
-- and 0040's vote already rely on that. Binding the transfer to the old id made
-- this the one host privilege a replaced identity could never use, stranding
-- the room on a tab that could not hand it over.
create temp table replaced_ctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'roomCode') as room_code
from (select public.create_room(
  'TH00000000000002', 'th-old-identity', 'Replaced Identity Host',
  repeat('i', 40), repeat('j', 40)
) as created) c;

select public.join_room(
  (select room_code from replaced_ctx), 'th-next-host', 'Next Host', repeat('k', 40), 50
);

create temp table replaced_done on commit drop as
select (public.room_transfer_host(
  (select room_id from replaced_ctx), 'th-new-identity', repeat('j', 40),
  (select m.id from public.members m
    where m.room_id = (select room_id from replaced_ctx)
      and m.user_id = 'th-next-host'),
  repeat('l', 40)
) ->> 'role') as caller_role;

select is((select caller_role from replaced_done), 'guest',
  'a host whose anonymous identity was replaced can still transfer the room');

select lives_ok(
  format('select public.read_room_guest(%L::uuid, %L, %L)',
    (select room_id from replaced_ctx), 'th-new-identity', repeat('l', 40)),
  'the guest pass returned to the demoted host works under their current identity');

select is(
  (select role from public.members m
    where m.room_id = (select room_id from replaced_ctx)
      and m.user_id = 'th-next-host'),
  'host',
  'the chosen guest still becomes host after an identity replacement');

select * from finish();
rollback;
