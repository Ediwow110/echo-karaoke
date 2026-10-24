begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select function_privs_are(
  'public', 'host_remove_member',
  array['uuid', 'text', 'text', 'uuid'],
  'anon', array[]::text[], 'anon cannot remove a member');
select function_privs_are(
  'public', 'host_remove_member',
  array['uuid', 'text', 'text', 'uuid'],
  'authenticated', array[]::text[], 'authenticated cannot remove a member');
select is(
  has_function_privilege(
    'service_role',
    'public.host_remove_member(uuid, text, text, uuid)',
    'execute'),
  true,
  'service_role can remove a member');

create temp table mctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'memberId')::uuid as host_member_id,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'MNPQRSVWXYZ01235',
    'membership-host',
    'Membership Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

create temp table guest on commit drop as
select
  (joined ->> 'memberId')::uuid as member_id,
  (joined ->> 'guestToken') as guest_token
from (
  select public.join_room(
    'MNPQRSVWXYZ01235',
    'membership-guest',
    'Guest One',
    repeat('m', 40)
  ) as joined
) s;

select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from mctx), 'membership-guest', (select guest_token from guest), 'abc123XYZ_-', 'Guest Song'),
  'the guest adds a song');

select lives_ok(
  format('select public.playback_command(%L::uuid, %L::text, null, %L, %L)', (select room_id from mctx), 'membership-host', (select host_token from mctx), 'play'),
  'the guest song starts playing');
select lives_ok(
  format('select public.playback_command(%L::uuid, %L::text, null, %L, %L)', (select room_id from mctx), 'membership-host', (select host_token from mctx), 'pause'),
  'the host pauses the guest song');

select throws_ok(
  format('select public.host_remove_member(%L::uuid, %L::text, %L, %L::uuid)', (select room_id from mctx), 'membership-host', (select host_token from mctx), (select host_member_id from mctx)),
  '22023', 'VALIDATION_ERROR',
  'the host cannot remove the host');

select is(
  public.host_remove_member(
    (select room_id from mctx),
    'membership-host',
    (select host_token from mctx),
    (select member_id from guest)
  ) ->> 'removed',
  'true',
  'the host removes a guest');

select is(
  (select count(*)::int from public.members where room_id = (select room_id from mctx) and role = 'guest'),
  0,
  'the removed guest leaves no member row');
select is(
  (select count(*)::int from public.queue_songs where room_id = (select room_id from mctx)),
  0,
  'the removed guest queue cascades');
select is(
  (select playback_state ->> 'currentSongId' from public.rooms where id = (select room_id from mctx)),
  null::text,
  'removing the current singer clears the stale playback pointer');
select is(
  (select playback_state ->> 'isPlaying' from public.rooms where id = (select room_id from mctx)),
  'false',
  'removing a singer does not unpause the room');

select throws_ok(
  format('select public.queue_add_preflight(%L::uuid, %L::text, %L, null, %L)', (select room_id from mctx), 'membership-guest', (select guest_token from guest), 'dQw4w9WgXcQ'),
  '28000', 'UNAUTHORIZED',
  'the removed guest cannot use the old pass');

select * from finish();
rollback;
