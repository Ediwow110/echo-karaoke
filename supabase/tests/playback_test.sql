begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select function_privs_are('public', 'playback_command', array['uuid', 'text','text','text','text'], 'anon', array[]::text[], 'anon cannot drive playback');
select function_privs_are('public', 'playback_command', array['uuid', 'text','text','text','text'], 'authenticated', array[]::text[], 'authenticated cannot drive playback');
select function_privs_are('public', 'playback_report', array['uuid', 'text','text','integer','integer','uuid'], 'authenticated', array[]::text[], 'authenticated cannot report playback position');
select function_privs_are('public', 'host_access_check', array['uuid', 'text','text'], 'anon', array[]::text[], 'anon cannot preflight a host');
select function_privs_are('public', 'host_access_check', array['uuid', 'text','text'], 'authenticated', array[]::text[], 'authenticated cannot preflight a host');

create temp table pctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'guestToken') as guest_token,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'PQRSTVWXYZ012345',
    '11111111-1111-1111-1111-111111111111'::text,
    'Playback Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

-- A real guest member, so guest lock and guest permissions are exercised.
select lives_ok(
  format('select public.join_room(%L, %L::text, %L, %L)', 'PQRSTVWXYZ012345', '22222222-2222-2222-2222-222222222222', 'Playback Singer', repeat('m', 40)),
  'a guest joins the room');

-- Seed two songs through the queue command as the host.
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, null, %L, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'dQw4w9WgXcQ', 'First'),
  'host adds the first song');
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, null, %L, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'abc123XYZ_-', 'Second'),
  'host adds the second song');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::text, %L, null, %L)', (select room_id from pctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'play'),
  '22023', 'GUEST_CONTROLS_LOCKED',
  'guest playback starts host-only');

select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'unlock_playback'),
  'the host allows guest playback');

select is(
  public.playback_command(
    (select room_id from pctx),
    '22222222-2222-2222-2222-222222222222'::text,
    repeat('m', 40),
    null::text,
    'play'
  ) -> 'playback' ->> 'isPlaying',
  'true',
  'a guest can start playback when allowed');

select is(
  public.playback_command(
    (select room_id from pctx),
    '22222222-2222-2222-2222-222222222222'::text,
    repeat('m', 40),
    null::text,
    'play'
  ) -> 'playback' ->> 'currentVideoId',
  'dQw4w9WgXcQ',
  'the first queued song becomes current');

-- Request locking does not take guest playback away.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'lock'),
  'host locks guest requests');

select is(
  public.playback_command(
    (select room_id from pctx),
    '22222222-2222-2222-2222-222222222222'::text,
    repeat('m', 40),
    null::text,
    'pause'
  ) -> 'playback' ->> 'isPlaying',
  'false',
  'guest playback remains independent of request locking');

select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'unlock'),
  'host unlocks guest requests');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::text, %L, null, %L)', (select room_id from pctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'next'),
  '42501', 'FORBIDDEN',
  'skipping stays host-only even when guest playback is allowed');

select is(
  public.playback_command(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    null::text,
    (select host_token from pctx),
    'next'
  ) -> 'playback' ->> 'currentVideoId',
  'abc123XYZ_-',
  'the host skip advances to the next song');

select is(
  (select status from public.queue_songs where room_id = (select room_id from pctx) and video_id = 'dQw4w9WgXcQ'),
  'played',
  'the skipped song is marked played');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::text, %L, null, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40), 'play'),
  '28000', 'UNAUTHORIZED',
  'a wrong guest pass cannot drive playback');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::text, %L, null, %L)', (select room_id from pctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'rewind'),
  '22023', 'VALIDATION_ERROR',
  'an unknown playback action is rejected');

-- Playback lock blocks guest playback but not the host.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'lock_playback'),
  'host returns playback to host-only');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::text, %L, null, %L)', (select room_id from pctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'pause'),
  '22023', 'GUEST_CONTROLS_LOCKED',
  'locked guests cannot pause');

select lives_ok(
  format('select public.playback_command(%L::uuid, %L::text, null, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'pause'),
  'the host can still control playback while locked');

-- Host position reporting and empty queue behaviour.
select is(
  public.playback_report(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from pctx),
    42,
    210,
    (select id from public.queue_songs where room_id = (select room_id from pctx) and status = 'playing' limit 1)
  ) ->> 'positionSeconds',
  '42',
  'the host reports the playback position');

select is(
  public.playback_report(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from pctx),
    999,
    210,
    '00000000-0000-0000-0000-000000000000'::uuid
  ) ->> 'positionSeconds',
  '42',
  'a late report from another song is ignored');

select is(
  public.playback_report(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from pctx),
    43,
    210,
    (select id from public.queue_songs where room_id = (select room_id from pctx) and status = 'playing' limit 1)
  ) ->> 'durationSeconds',
  '210',
  'the host reports the real video duration');

select is(
  public.read_room_host(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from pctx)
  ) -> 'playback' ->> 'durationSeconds',
  '210',
  'the host read includes the reported duration');

select throws_ok(
  format('select public.playback_report(%L::uuid, %L::text, %L, 10)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40)),
  '28000', 'UNAUTHORIZED',
  'a wrong host pass cannot report a position');

-- The current song must be skipped rather than removed under playback.
select throws_ok(
  format('select public.queue_remove(%L::uuid, %L::text, null, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), (select id from public.queue_songs where room_id = (select room_id from pctx) and status = 'playing' limit 1)),
  '22023', 'SONG_PLAYING',
  'the current song cannot be removed from the queue');

-- An up-next song can still be removed.
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, null, %L, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'newVideoID0', 'Third'),
  'host adds an up-next song');
select is(
  public.queue_remove(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    null::text,
    (select host_token from pctx),
    (select id from public.queue_songs where room_id = (select room_id from pctx) and status = 'queued' limit 1)
  ) ->> 'removed',
  'true',
  'an up-next song can still be removed');

-- Clearing the queue also stops playback and removes the current pointer.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'clear_queue'),
  'host clears the queue');
select is(
  (select count(*)::int from public.queue_songs where room_id = (select room_id from pctx)),
  0,
  'clearing the queue removes every song');
select is(
  public.read_room_host(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from pctx)
  ) -> 'playback' ->> 'currentSongId',
  null::text,
  'clearing the queue clears the current song');
select is(
  public.read_room_host(
    (select room_id from pctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from pctx)
  ) -> 'playback' ->> 'isPlaying',
  'false',
  'clearing the queue stops playback');

-- Ending the room stops playback commands.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'end'),
  'host ends the room');

select throws_ok(
  format('select public.playback_command(%L::uuid, %L::text, null, %L, %L)', (select room_id from pctx), '11111111-1111-1111-1111-111111111111', (select host_token from pctx), 'play'),
  '22023', 'ROOM_ENDED',
  'an ended room rejects playback commands');

select * from finish();
rollback;