begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select function_privs_are('public', 'vote_toggle', array['uuid', 'text','text','uuid'], 'anon', array[]::text[], 'anon cannot vote');
select function_privs_are('public', 'vote_toggle', array['uuid', 'text','text','uuid'], 'authenticated', array[]::text[], 'authenticated cannot vote');

create temp table vctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'guestToken') as host_guest_token,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'VWXYZ0123456789A',
    '11111111-1111-1111-1111-111111111111'::text,
    'Vote Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

select lives_ok(
  format('select public.join_room(%L, %L::text, %L, %L)', 'VWXYZ0123456789A', '22222222-2222-2222-2222-222222222222', 'Voter', repeat('m', 40)),
  'a voter joins');

select lives_ok(
  format('select public.join_room(%L, %L::text, %L, %L)', 'VWXYZ0123456789A', '33333333-3333-3333-3333-333333333333', 'Other Voter', repeat('n', 40)),
  'a second voter joins');

create temp table song on commit drop as
select (public.queue_add(
  (select room_id from vctx),
  '11111111-1111-1111-1111-111111111111'::text,
  (select host_guest_token from vctx),
  null::text,
  'dQw4w9WgXcQ',
  'Vote Target'
) ->> 'songId')::uuid as song_id;

select is(
  public.vote_toggle(
    (select room_id from vctx),
    '22222222-2222-2222-2222-222222222222'::text,
    repeat('m', 40),
    (select song_id from song)
  ) ->> 'voteCount',
  '1',
  'a first vote is counted');

select is(
  (select count(*)::int from public.votes where room_id = (select room_id from vctx)),
  1,
  'one vote row exists');

select is(
  public.vote_toggle(
    (select room_id from vctx),
    '22222222-2222-2222-2222-222222222222'::text,
    repeat('m', 40),
    (select song_id from song)
  ) ->> 'voteCount',
  '0',
  'voting again removes the vote');

select is(
  public.vote_toggle(
    (select room_id from vctx),
    '33333333-3333-3333-3333-333333333333'::text,
    repeat('n', 40),
    (select song_id from song)
  ) ->> 'voteCount',
  '1',
  'a second member adds their own vote');

select throws_ok(
  format('select public.vote_toggle(%L::uuid, %L::text, %L, %L::uuid)', (select room_id from vctx), '22222222-2222-2222-2222-222222222222', repeat('z', 40), (select song_id from song)),
  '28000', 'UNAUTHORIZED',
  'a wrong pass cannot vote');

select throws_ok(
  format('select public.vote_toggle(%L::uuid, %L::text, %L, %L::uuid)', (select room_id from vctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), '00000000-0000-0000-0000-000000000000'),
  '22023', 'VALIDATION_ERROR',
  'voting for an unknown song is rejected');

select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from vctx), '11111111-1111-1111-1111-111111111111', (select host_token from vctx), 'lock'),
  'host locks guest controls');

select throws_ok(
  format('select public.vote_toggle(%L::uuid, %L::text, %L, %L::uuid)', (select room_id from vctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), (select song_id from song)),
  '22023', 'GUEST_CONTROLS_LOCKED',
  'locked guests cannot vote');

select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from vctx), '11111111-1111-1111-1111-111111111111', (select host_token from vctx), 'unlock'),
  'host unlocks guest controls');

update public.queue_songs set status = 'played' where id = (select song_id from song);
select throws_ok(
  format('select public.vote_toggle(%L::uuid, %L::text, %L, %L::uuid)', (select room_id from vctx), '22222222-2222-2222-2222-222222222222', repeat('m', 40), (select song_id from song)),
  '22023', 'VALIDATION_ERROR',
  'a played song cannot collect new votes');
update public.queue_songs set status = 'queued' where id = (select song_id from song);

-- Votes disappear with the song.
select lives_ok(
  format('select public.queue_remove(%L::uuid, %L::text, null, %L, %L::uuid)', (select room_id from vctx), '11111111-1111-1111-1111-111111111111', (select host_token from vctx), (select song_id from song)),
  'the host removes the voted song');

select is(
  (select count(*)::int from public.votes where room_id = (select room_id from vctx)),
  0,
  'votes are removed with their song');

-- Room events never carry capability tokens.
select ok(
  not exists (
    select 1 from public.room_events e
    where e.room_id = (select room_id from vctx)
      and e.payload::text ~ '(guest|host)Token'
  ),
  'room events contain no capability tokens');

select * from finish();
rollback;