begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select function_privs_are('public', 'playback_command', array['uuid','uuid','text','text','text'], 'anon', array[]::text[], 'anon cannot drive playback');
select function_privs_are('public', 'playback_command', array['uuid','uuid','text','text','text'], 'authenticated', array[]::text[], 'authenticated cannot drive playback');
select function_privs_are('public', 'playback_report', array['uuid','uuid','text','integer'], 'authenticated', array[]::text[], 'authenticated cannot report playback position');

create temp table pctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'guestToken') as guest_token,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'PQRSTVWXYZ012345',
    '11111111-1111-1111-1111-111111111111'::uuid,
    'Playback Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

-- A real guest member, so guest lock and guest permissions are exercised.
select lives_ok(
  format('select public.join_room(%L, %L::uuid, %L, %L)', 'PQRSTVWXYZ012345', '22222222-2222-2222-2222-222222222222', 'Playback Singer', repeat('m', 40)),
  'a guest joins the room');

-- Seed two songs through the queue command as the host.
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::uuid, null, %L, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'dQw4w9WgXcQ', 'First'),
  'host adds the first song');
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::uuid, null, %L, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'abc123XYZ_-', 'Second'),
  'host adds the second song');

select is(
  public.playback_command(
    (select room_id from pctx),
    '22222222-2222-2222-2222-222222222222'::uuid,
    repeat('m', 40),
    null::text,
    'play'
  ) -> 'playback' ->> 'isPlaying',
  'true',
  'a guest can start playback');

select is(
  public.playback_command(
    (select room_id from pctx),
    '22222222-2222-2222-2222-222222222222'::uuid,
    repeat('m', 40),
    null::text,
    'play'
  ) -> 'playback' ->> 'currentVideoId',
  'dQw4w9WgXcQ',
  'the first queued song becomes current');

select is(
  public.playback_command(
    (select room_id from pctx),
    '22222222-2222-2222-2222-222222222222'::uuid,
    repeat('m', 40),
    null::text,
    'pause'
  ) -> 'playback' ->> 'isPlaying',
  'false',
  'a guest can pause playback');

select is(
  public.playback_command(
    (select room_id from pctx),
    '22222222-2222-2222-2222-222222222222'::uuid,
    repeat('m', 40),
    null::text,
    'next'
  ) -> 'playback' ->> 'currentVideoId',
  'abc123XYZ_-',
  'skipping advances to the next song');

select is(
  (select status from public.queue_songs where room_id = (select room_id from pctx) and video_id = 'dQw4w9WgXcQ'),
  'played',
  'the skipped song is marked played');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::uuid, %L, null, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40), 'play'),
  '28000', 'UNAUTHORIZED',
  'a wrong guest pass cannot drive playback');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::uuid, %L, null, %L)', (select room_id from pctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'rewind'),
  '22023', 'VALIDATION_ERROR',
  'an unknown playback action is rejected');

-- Guest lock blocks guest playback but not the host.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::uuid, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'lock'),
  'host locks guest controls');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::uuid, %L, null, %L)', (select room_id from pctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'pause'),
  '22023', 'GUEST_CONTROLS_LOCKED',
  'locked guests cannot pause');

select lives_ok(
  format('select public.playback_command(%L::uuid, %L::uuid, null, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'pause'),
  'the host can still control playback while locked');

-- Host position reporting and empty queue behaviour.
select is(
  public.playback_report(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::uuid,
    (select host_token from pctx),
    42
  ) ->> 'positionSeconds',
  '42',
  'the host reports the playback position');

select throws_ok(
  format('select public.playback_report(%L::uuid, %L::uuid, %L, 10)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40)),
  '28000', 'UNAUTHORIZED',
  'a wrong host pass cannot report a position');

-- Ending the room stops playback commands.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::uuid, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'end'),
  'host ends the room');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::uuid, null, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'play'),
  '22023', 'ROOM_ENDED',
  'an ended room rejects playback commands');

select * from finish();
rollback;