begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select is(
  has_function_privilege('anon', 'public.cleanup_abandoned_rooms(timestamp with time zone)', 'execute'),
  false,
  'anon cannot clean abandoned rooms');
select is(
  has_function_privilege('authenticated', 'public.cleanup_abandoned_rooms(timestamp with time zone)', 'execute'),
  false,
  'authenticated cannot clean abandoned rooms');
select is(
  has_function_privilege('service_role', 'public.cleanup_abandoned_rooms(timestamp with time zone)', 'execute'),
  true,
  'service_role can clean abandoned rooms');

select is(
  (select count(*) from cron.job where jobname = 'cleanup-abandoned-rooms'),
  1::bigint,
  'the abandoned-room sweep is scheduled');

insert into public.rooms (id, code, name, status, created_at, ended_at)
values
  ('44444444-4444-4444-4444-444444444444', '4000000000000004', 'Empty live room', 'live', '2000-01-01T00:00:00Z', null),
  ('55555555-5555-5555-5555-555555555555', '5000000000000005', 'Abandoned live room', 'live', '2000-01-01T00:00:00Z', null),
  ('66666666-6666-6666-6666-666666666666', '6000000000000006', 'Active live room', 'live', '2000-01-01T00:00:00Z', null),
  ('77777777-7777-7777-7777-777777777777', '7000000000000007', 'Recent live room', 'live', '2000-01-02T00:10:00Z', null),
  ('88888888-8888-8888-8888-888888888888', '8000000000000008', 'Abandoned ended room', 'ended', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z');

insert into public.members (id, room_id, user_id, display_name, guest_token_hash, role, last_seen_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000101', '55555555-5555-5555-5555-555555555555',
   '99999999-9999-9999-9999-999999999101', 'Gone host', decode(repeat('00', 32), 'hex'), 'host', '2000-01-01T00:10:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000102', '66666666-6666-6666-6666-666666666666',
   '99999999-9999-9999-9999-999999999102', 'Active host', decode(repeat('00', 32), 'hex'), 'host', '2000-01-02T00:10:00Z'),
  ('aaaaaaaa-0000-0000-0000-000000000103', '88888888-8888-8888-8888-888888888888',
   '99999999-9999-9999-9999-999999999103', 'Ended host', decode(repeat('00', 32), 'hex'), 'host', '2000-01-01T00:10:00Z');

insert into private.room_host_secrets (room_id, token_hash)
values ('55555555-5555-5555-5555-555555555555', decode(repeat('00', 32), 'hex'));

insert into public.queue_songs (id, room_id, member_id, video_id, title, position)
values (
  'bbbbbbbb-0000-0000-0000-000000000101',
  '55555555-5555-5555-5555-555555555555',
  'aaaaaaaa-0000-0000-0000-000000000101',
  'dQw4w9WgXcQ',
  'Abandoned song',
  1
);

insert into public.votes (room_id, queue_song_id, member_id)
values (
  '55555555-5555-5555-5555-555555555555',
  'bbbbbbbb-0000-0000-0000-000000000101',
  'aaaaaaaa-0000-0000-0000-000000000101'
);

insert into public.room_events (room_id, member_id, event_type)
values (
  '55555555-5555-5555-5555-555555555555',
  'aaaaaaaa-0000-0000-0000-000000000101',
  'join'
);

create temp table abandoned_result on commit drop as
select public.cleanup_abandoned_rooms('2000-01-02T00:00:00Z'::timestamptz) as deleted;

select is((select deleted from abandoned_result), 3, 'three abandoned rooms are deleted');
select is(
  (select count(*) from public.rooms where id = '44444444-4444-4444-4444-444444444444'),
  0::bigint,
  'an empty live room is removed');
select is(
  (select count(*) from public.rooms where id = '55555555-5555-5555-5555-555555555555'),
  0::bigint,
  'a live room with a stale host is removed');
select is(
  (select count(*) from public.rooms where id = '88888888-8888-8888-8888-888888888888'),
  0::bigint,
  'an ended room with a stale host is removed');
select is(
  (select count(*) from public.rooms where id = '66666666-6666-6666-6666-666666666666'),
  1::bigint,
  'a live room with a recent heartbeat remains');
select is(
  (select count(*) from public.rooms where id = '77777777-7777-7777-7777-777777777777'),
  1::bigint,
  'a recently created room remains');
select is(
  (select count(*) from public.members where id = 'aaaaaaaa-0000-0000-0000-000000000101'),
  0::bigint,
  'abandoned members cascade');
select is(
  (select count(*) from public.queue_songs where id = 'bbbbbbbb-0000-0000-0000-000000000101'),
  0::bigint,
  'abandoned queue songs cascade');
select is(
  (select count(*) from public.votes where room_id = '55555555-5555-5555-5555-555555555555'),
  0::bigint,
  'abandoned votes cascade');
select is(
  (select count(*) from public.room_events where room_id = '55555555-5555-5555-5555-555555555555'),
  0::bigint,
  'abandoned events cascade');
select is(
  (select count(*) from private.room_host_secrets where room_id = '55555555-5555-5555-5555-555555555555'),
  0::bigint,
  'an abandoned host secret cascades');
select is(
  (select count(*) from public.members where id = 'aaaaaaaa-0000-0000-0000-000000000102'),
  1::bigint,
  'the active member remains');

select throws_ok(
  $$ select public.cleanup_abandoned_rooms(now()) $$,
  '22023', 'VALIDATION_ERROR',
  'a near-now cutoff is rejected');
select throws_ok(
  $$ select public.cleanup_abandoned_rooms(null::timestamptz) $$,
  '22023', 'VALIDATION_ERROR',
  'a null cutoff is rejected');

select * from finish();
rollback;
