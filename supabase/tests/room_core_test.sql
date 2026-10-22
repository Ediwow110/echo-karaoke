begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Browser roles have no table privileges.
select table_privs_are('public', 'rooms', 'anon', array[]::text[], 'anon has no privileges on rooms');
select table_privs_are('public', 'rooms', 'authenticated', array[]::text[], 'authenticated has no privileges on rooms');
select table_privs_are('public', 'members', 'anon', array[]::text[], 'anon has no privileges on members');
select table_privs_are('public', 'members', 'authenticated', array[]::text[], 'authenticated has no privileges on members');
select table_privs_are('public', 'queue_songs', 'anon', array[]::text[], 'anon has no privileges on queue_songs');
select table_privs_are('public', 'queue_songs', 'authenticated', array[]::text[], 'authenticated has no privileges on queue_songs');
select table_privs_are('public', 'votes', 'anon', array[]::text[], 'anon has no privileges on votes');
select table_privs_are('public', 'votes', 'authenticated', array[]::text[], 'authenticated has no privileges on votes');
select table_privs_are('public', 'room_events', 'anon', array[]::text[], 'anon has no privileges on room_events');
select table_privs_are('public', 'room_events', 'authenticated', array[]::text[], 'authenticated has no privileges on room_events');

-- Row level security is on for every karaoke table.
select ok((select relrowsecurity from pg_class where oid = 'public.rooms'::regclass), 'rooms has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.members'::regclass), 'members has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.queue_songs'::regclass), 'queue_songs has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.votes'::regclass), 'votes has RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.room_events'::regclass), 'room_events has RLS');
select ok((select relrowsecurity from pg_class where oid = 'private.room_host_secrets'::regclass), 'host secrets has RLS');

-- The private schema and internal helpers stay closed to browser roles.
select ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use the private schema');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated cannot use the private schema');

select function_privs_are('public', 'create_room', array['text', 'text', 'text', 'text', 'text', 'text', 'boolean', 'boolean'], 'anon', array[]::text[], 'anon cannot execute create_room');
select function_privs_are('public', 'join_room', array['text', 'text', 'text', 'text'], 'anon', array[]::text[], 'anon cannot execute join_room');
select function_privs_are('public', 'read_room_guest', array['uuid', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot execute read_room_guest');
select function_privs_are('public', 'read_room_host', array['uuid', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot execute read_room_host');
select function_privs_are('public', 'host_command', array['uuid', 'text', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot execute host_command');
select function_privs_are('private', 'require_guest', array['uuid', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot execute require_guest');

-- The identity provider issues a string user id, not a uuid.
select has_column('public', 'members', 'user_id', 'the member user id column exists');
select is(
  (select format_type(a.atttypid, a.atttypmod)
   from pg_attribute a
   join pg_class c on c.oid = a.attrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'members' and a.attname = 'user_id'),
  'text',
  'the member user id is text');
select is(
  (select pg_get_function_identity_arguments(p.oid) like '%p_user_id text%'
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_room'),
  true,
  'create_room accepts a text user id');
select is(
  (select pg_get_function_identity_arguments(p.oid) like '%p_user_id text%'
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'require_guest'),
  true,
  'require_guest accepts a text user id');

-- Room constraints keep codes and ended state honest.
select throws_ok(
  $$ insert into public.rooms (code) values ('short') $$,
  '23514', null,
  'rooms reject codes that are not 16 Crockford Base32 characters');

select throws_ok(
  $$ insert into public.rooms (code, status) values ('ABCDEFGHJKMNPQRS', 'ended') $$,
  '23514', null,
  'rooms require ended_at when status is ended');

-- Create one room as the host and keep every value strongly typed.
create temp table ctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'memberId')::uuid as member_id,
  (created ->> 'guestToken') as guest_token,
  (created ->> 'hostToken') as host_token,
  created
from (
  select public.create_room(
    'ABCDEFGHJKMNPQRS',
    '11111111-1111-1111-1111-111111111111'::text,
    'Host One',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

select ok((select created ? 'roomId' from ctx), 'create_room returns a room id');
select ok((select created ? 'guestToken' from ctx), 'create_room returns the guest token once');
select ok((select created ? 'hostToken' from ctx), 'create_room returns the host token once');
select is((select created ->> 'role' from ctx), 'host', 'room creator is the host member');
select is((select created ->> 'roomName' from ctx), 'Karaoke room', 'create_room returns the default room name');

select ok(
  (select guest_token_hash <> convert_to(repeat('g', 40), 'UTF8')
   from public.members where id = (select member_id from ctx)),
  'members store only the guest token digest');

select ok(
  (select token_hash <> convert_to(repeat('h', 40), 'UTF8')
   from private.room_host_secrets where room_id = (select room_id from ctx)),
  'host secrets store only the host token digest');

-- Opening the invite on the host browser must not turn the host into a guest.
select throws_ok(
  format('select public.join_room(%L, %L::text, %L, %L)', 'ABCDEFGHJKMNPQRS', '11111111-1111-1111-1111-111111111111', 'Renamed Host', repeat('q', 40)),
  '22023', 'HOST_ALREADY_IN_ROOM',
  'the host cannot join their own room as a guest');

select is(
  (select display_name from public.members where id = (select member_id from ctx)),
  'Host One',
  'a rejected host join leaves the host name unchanged');

select lives_ok(
  format('select public.read_room_host(%L::uuid, %L::text, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('h', 40)),
  'a rejected host join leaves the host pass valid');

select is(
  public.read_room_guest(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select guest_token from ctx)
  ) ->> 'status',
  'live',
  'a valid guest token reads live room state');

select ok(
  public.read_room_guest(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select guest_token from ctx)
  ) ? 'roster',
  'guest read includes the roster projection');

select is(
  public.read_room_guest(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select guest_token from ctx)
  ) -> 'room' ->> 'guestPlaybackLocked',
  'true',
  'guest playback starts host-only');

select is(
  public.read_room_guest(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select guest_token from ctx)
  ) -> 'room' ->> 'guestControlLocked',
  'false',
  'guest requests start open');

select is(
  public.read_room_host(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from ctx)
  ) ->> 'status',
  'live',
  'a valid host token reads host room state');

select throws_ok(
  format('select public.read_room_guest(%L::uuid, %L::text, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40)),
  '28000', 'UNAUTHORIZED',
  'a wrong guest token is rejected');

select throws_ok(
  format('select public.read_room_guest(%L::uuid, %L::text, %L)', (select room_id from ctx), '22222222-2222-2222-2222-222222222222', repeat('g', 40)),
  '28000', 'UNAUTHORIZED',
  'a guest token from another Auth user is rejected');

select throws_ok(
  format('select public.read_room_host(%L::uuid, %L::text, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40)),
  '28000', 'UNAUTHORIZED',
  'a wrong host token is rejected');

select throws_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40), 'lock'),
  '28000', 'UNAUTHORIZED',
  'host commands reject a wrong host token');

select throws_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('h', 40), 'nonsense'),
  '22023', 'VALIDATION_ERROR',
  'an unknown host action is rejected');

-- A second room proves cross-room tokens do not travel.
create temp table ctx2 on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'guestToken') as guest_token,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'ZYXWVTSRQPNMKJHG',
    '33333333-3333-3333-3333-333333333333'::text,
    'Host Two',
    repeat('p', 40),
    repeat('q', 40),
    'Second Stage',
    true,
    false
  ) as created
) s;

select throws_ok(
  format('select public.read_room_guest(%L::uuid, %L::text, %L)', (select room_id from ctx2), '11111111-1111-1111-1111-111111111111', repeat('g', 40)),
  '28000', 'UNAUTHORIZED',
  'a guest token cannot read a different room');

select throws_ok(
  format('select public.read_room_host(%L::uuid, %L::text, %L)', (select room_id from ctx), '33333333-3333-3333-3333-333333333333', repeat('q', 40)),
  '28000', 'UNAUTHORIZED',
  'a host token cannot read a different room');

select throws_ok(
  format('select public.join_room(%L, %L::text, %L, %L)', 'AAAAAAAABBBBBBBB', '44444444-4444-4444-4444-444444444444', 'Guest', repeat('m', 40)),
  '22023', 'ROOM_NOT_FOUND',
  'joining an unknown code reports ROOM_NOT_FOUND');

select is(
  public.join_room('ZYXWVTSRQPNMKJHG', '44444444-4444-4444-4444-444444444444'::text, 'Guest Two', repeat('m', 40)) ->> 'role',
  'guest',
  'joining a live room creates a guest member');

select throws_ok(
  format('select public.touch_member(%L::uuid, %L::text, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40)),
  '28000', 'UNAUTHORIZED',
  'heartbeat requires the correct guest token');

-- Guest lock blocks guests but not the host.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('h', 40), 'lock'),
  'host can lock guest requests');

select is(
  public.host_command(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from ctx),
    'unlock'
  ) ->> 'guestControlLocked',
  'false',
  'host can unlock guest requests');

select is(
  public.host_command(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from ctx),
    'unlock_playback'
  ) ->> 'guestPlaybackLocked',
  'false',
  'host can allow guest playback');

select is(
  public.host_command(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from ctx),
    'lock_playback'
  ) ->> 'guestPlaybackLocked',
  'true',
  'host can return playback to host-only');

select is(
  public.read_room_host(
    (select room_id from ctx2),
    '33333333-3333-3333-3333-333333333333'::text,
    (select host_token from ctx2)
  ) -> 'room' ->> 'name',
  'Second Stage',
  'create_room stores the chosen room name');

select is(
  public.host_access_check(
    (select room_id from ctx2),
    '33333333-3333-3333-3333-333333333333'::text,
    (select host_token from ctx2)
  ) ->> 'status',
  'live',
  'host preflight accepts a valid host pass');

-- Ending a room is terminal for data access except the ended status.
select is(
  public.host_command(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from ctx),
    'end'
  ) ->> 'status',
  'ended',
  'host can end the room');

select is(
  public.read_room_guest(
    (select room_id from ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select guest_token from ctx)
  ) ->> 'status',
  'ended',
  'an ended room returns only its ended status to a valid guest token');

select ok(
  not (
    public.read_room_guest(
      (select room_id from ctx),
      '11111111-1111-1111-1111-111111111111'::text,
      (select guest_token from ctx)
    ) ? 'queue'
  ),
  'an ended room withholds queue data');

select throws_ok(
  format('select public.join_room(%L, %L::text, %L, %L)', 'ABCDEFGHJKMNPQRS', '55555555-5555-5555-5555-555555555555', 'Late Guest', repeat('n', 40)),
  '22023', 'ROOM_ENDED',
  'joining an ended room reports ROOM_ENDED');

select throws_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from ctx), '11111111-1111-1111-1111-111111111111', repeat('h', 40), 'lock'),
  '22023', 'ROOM_ENDED',
  'host commands other than end are rejected after the room ends');

select * from finish();
rollback;
