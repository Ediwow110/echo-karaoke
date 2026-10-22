begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select is(
  has_function_privilege('anon', 'public.cleanup_ended_rooms(timestamp with time zone)', 'execute'),
  false,
  'anon cannot clean ended rooms');
select is(
  has_function_privilege('authenticated', 'public.cleanup_ended_rooms(timestamp with time zone)', 'execute'),
  false,
  'authenticated cannot clean ended rooms');
select is(
  has_function_privilege('service_role', 'public.cleanup_ended_rooms(timestamp with time zone)', 'execute'),
  true,
  'service_role can clean ended rooms');

insert into public.rooms (id, code, name, status, ended_at)
values
  ('11111111-1111-1111-1111-111111111111', '1000000000000001', 'Old room', 'ended', now() - interval '40 days'),
  ('22222222-2222-2222-2222-222222222222', '2000000000000002', 'Recent room', 'ended', now() - interval '2 days'),
  ('33333333-3333-3333-3333-333333333333', '3000000000000003', 'Live room', 'live', null);

insert into public.members (id, room_id, user_id, display_name, guest_token_hash, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '99999999-9999-9999-9999-999999999991', 'Old host', decode(repeat('00', 32), 'hex'), 'host'),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '99999999-9999-9999-9999-999999999992', 'Recent host', decode(repeat('00', 32), 'hex'), 'host');

insert into private.room_host_secrets (room_id, token_hash)
values ('11111111-1111-1111-1111-111111111111', decode(repeat('00', 32), 'hex'));

insert into public.queue_songs (id, room_id, member_id, video_id, title, position)
values (
  'bbbbbbbb-0000-0000-0000-000000000001',
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'dQw4w9WgXcQ',
  'Old song',
  1
);

insert into public.votes (room_id, queue_song_id, member_id)
values (
  '11111111-1111-1111-1111-111111111111',
  'bbbbbbbb-0000-0000-0000-000000000001',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

insert into public.room_events (room_id, member_id, event_type)
values (
  '11111111-1111-1111-1111-111111111111',
  'aaaaaaaa-0000-0000-0000-000000000001',
  'join'
);

create temp table cleanup_result on commit drop as
select public.cleanup_ended_rooms(now() - interval '30 days') as deleted;

select is((select deleted from cleanup_result), 1, 'one old ended room is deleted');
select is(
  (select count(*) from public.rooms where id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'the old room is gone');
select is(
  (select count(*) from public.rooms where id = '22222222-2222-2222-2222-222222222222'),
  1::bigint,
  'the recent ended room remains');
select is(
  (select count(*) from public.rooms where id = '33333333-3333-3333-3333-333333333333'),
  1::bigint,
  'the live room remains');
select is(
  (select count(*) from public.members where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::bigint,
  'old members cascade');
select is(
  (select count(*) from public.queue_songs where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0::bigint,
  'old queue songs cascade');
select is(
  (select count(*) from public.votes where room_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'old votes cascade');
select is(
  (select count(*) from public.room_events where room_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'old events cascade');
select is(
  (select count(*) from private.room_host_secrets where room_id = '11111111-1111-1111-1111-111111111111'),
  0::bigint,
  'the old host secret cascades');
select is(
  (select count(*) from public.members where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1::bigint,
  'the recent room member remains');

select throws_ok(
  $$ select public.cleanup_ended_rooms(now()) $$,
  '22023', 'VALIDATION_ERROR',
  'a cutoff newer than one day is rejected');
select throws_ok(
  $$ select public.cleanup_ended_rooms(null::timestamptz) $$,
  '22023', 'VALIDATION_ERROR',
  'a null cutoff is rejected');

do $$
declare
  i integer;
begin
  for i in 1..10 loop
    perform public.create_room(
      lpad(i::text, 16, '0'),
      '77777777-7777-7777-7777-777777777777'::text,
      'Cap Host',
      repeat('a', 32),
      repeat('b', 32),
      'Cap room ' || i,
      false,
      true
    );
  end loop;
end;
$$;

select throws_ok(
  $$ select public.create_room(
       '0000000000000011',
       '77777777-7777-7777-7777-777777777777',
       'Cap Host',
       repeat('a', 32),
       repeat('b', 32),
       'Cap room 11',
       false,
       true) $$,
  '22023', 'ROOM_CREATE_RATE_LIMITED',
  'the eleventh room in an hour is rejected');

select is(
  (select count(*) from public.members
   where user_id = '77777777-7777-7777-7777-777777777777' and role = 'host'),
  10::bigint,
  'ten rooms are created before the cap');

select * from finish();
rollback;
