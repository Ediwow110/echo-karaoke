begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Browser roles stay outside the queue API.
select function_privs_are('public', 'queue_add', array['uuid', 'text','text','text','text','text','text','text','integer'], 'anon', array[]::text[], 'anon cannot add songs');
select function_privs_are('public', 'queue_add', array['uuid', 'text','text','text','text','text','text','text','integer'], 'authenticated', array[]::text[], 'authenticated cannot add songs');
select function_privs_are('public', 'queue_remove', array['uuid', 'text','text','text','uuid'], 'anon', array[]::text[], 'anon cannot remove songs');
select function_privs_are('public', 'queue_reorder', array['uuid', 'text','text','text','uuid','text'], 'authenticated', array[]::text[], 'authenticated cannot reorder songs');

create temp table qctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'memberId')::uuid as host_member_id,
  (created ->> 'guestToken') as guest_token,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'MNPQRSVWXYZ01234',
    '11111111-1111-1111-1111-111111111111'::text,
    'Queue Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

select is(
  public.queue_add(
    (select room_id from qctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select guest_token from qctx),
    null::text,
    'dQw4w9WgXcQ', 'First Song', 'Channel', null, 210
  ) ->> 'position',
  '1',
  'the first added song takes position one');

select throws_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select guest_token from qctx), 'dQw4w9WgXcQ', 'Duplicate'),
  '22023', 'DUPLICATE_SONG',
  'an active song cannot be queued twice');

select is(
  public.queue_add(
    (select room_id from qctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select guest_token from qctx),
    null::text,
    'abc123XYZ_-', 'Second Song', 'Channel', null, 200
  ) ->> 'position',
  '2',
  'the next song takes position two');

select is(
  (select count(*)::int from public.queue_songs where room_id = (select room_id from qctx)),
  2,
  'two songs are queued');

select throws_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select guest_token from qctx), 'bad', 'Title'),
  '22023', 'VALIDATION_ERROR',
  'a malformed video id is rejected');

select throws_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', repeat('z', 40), 'dQw4w9WgXcQ', 'Title'),
  '28000', 'UNAUTHORIZED',
  'a wrong guest pass cannot add songs');

-- Rate limit: five per minute per member.
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select guest_token from qctx), 'rateLimit01', 'Rate one'),
  'third add allowed');
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select guest_token from qctx), 'rateLimit02', 'Rate two'),
  'fourth add allowed');
select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select guest_token from qctx), 'rateLimit03', 'Rate three'),
  'fifth add allowed');
select throws_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select guest_token from qctx), 'rateLimit04', 'Rate four'),
  '22023', 'RATE_LIMITED',
  'the sixth add in a minute is rate limited');

-- A second member can still add.
select lives_ok(
  format('select public.join_room(%L, %L::text, %L, %L)', 'MNPQRSVWXYZ01234', '22222222-2222-2222-2222-222222222222', 'Second Singer', repeat('m', 40)),
  'a second guest joins');

select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'otherSong99', 'Other song'),
  'the second guest adds their own song');

-- Ownership: removal is host-only, even for the guest's own song.
select throws_ok(
  format('select public.queue_remove(%L::uuid, %L::text, %L, null, (select id from public.queue_songs where room_id = %L::uuid and video_id = %L))', (select room_id from qctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), (select room_id from qctx), 'dQw4w9WgXcQ'),
  '42501', 'FORBIDDEN',
  'a guest cannot remove another member song');

select throws_ok(
  format('select public.queue_remove(%L::uuid, %L::text, %L, null, (select id from public.queue_songs where room_id = %L::uuid and video_id = %L))', (select room_id from qctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), (select room_id from qctx), 'otherSong99'),
  '42501', 'FORBIDDEN',
  'a guest cannot remove their own song either');

select throws_ok(
  format('select public.queue_reorder(%L::uuid, %L::text, %L, null, (select id from public.queue_songs where room_id = %L::uuid and video_id = %L), %L)', (select room_id from qctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), (select room_id from qctx), 'otherSong99', 'down'),
  '42501', 'FORBIDDEN',
  'a guest cannot reorder the queue');

-- The host can moderate any song.
select lives_ok(
  format('select public.queue_remove(%L::uuid, %L::text, null, %L, (select id from public.queue_songs where room_id = %L::uuid and video_id = %L))', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select host_token from qctx), (select room_id from qctx), 'dQw4w9WgXcQ'),
  'the host removes any song');

-- Guest lock blocks guest additions but not host additions.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select host_token from qctx), 'lock'),
  'host locks guest controls');

select throws_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'lockedSong1', 'Blocked'),
  '22023', 'GUEST_CONTROLS_LOCKED',
  'a locked room rejects guest additions');

select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, null, %L, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select host_token from qctx), 'hostSong123', 'Host pick'),
  'the host can still add while guests are locked');

select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select host_token from qctx), 'unlock'),
  'host unlocks guest controls');

-- Reordering keeps positions unique.
select lives_ok(
  format('select public.queue_reorder(%L::uuid, %L::text, null, %L, (select id from public.queue_songs where room_id = %L::uuid order by position limit 1), %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select host_token from qctx), (select room_id from qctx), 'down'),
  'the host can move a song down');

select is(
  (select count(*)::int from (
    select position from public.queue_songs where room_id = (select room_id from qctx)
    group by position having count(*) > 1
  ) duplicates),
  0,
  'queue positions stay unique after a reorder');

-- Ending the room closes the queue.
select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select host_token from qctx), 'end'),
  'host ends the room');

select throws_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), 'endedSong12', 'Late'),
  '22023', 'ROOM_ENDED',
  'an ended room rejects new songs');

select * from finish();
rollback;