begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select function_privs_are(
  'public', 'playback_next_if_current', array['uuid','text','text','uuid'],
  'anon', array[]::text[], 'anon cannot trigger automatic playback');
select function_privs_are(
  'public', 'playback_next_if_current', array['uuid','text','text','uuid'],
  'authenticated', array[]::text[], 'authenticated cannot trigger automatic playback');
select ok(
  has_function_privilege('service_role',
    'public.playback_next_if_current(uuid,text,text,uuid)', 'execute'),
  'only the service boundary can call the automatic playback RPC');

create temp table advance_ctx on commit drop as
select (created ->> 'roomId')::uuid as room_id,
       (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'PQRSTVWXYZ012345', '11111111-1111-1111-1111-111111111111'::text,
    'Auto Advance Room', repeat('g',40), repeat('h',40)
  ) as created
) s;

select lives_ok(format(
  'select public.queue_add(%L::uuid, %L::text, null, %L, %L, %L)',
  (select room_id from advance_ctx),
  '11111111-1111-1111-1111-111111111111',
  (select host_token from advance_ctx), 'dQw4w9WgXcQ', 'First'
), 'first song queued');
select lives_ok(format(
  'select public.queue_add(%L::uuid, %L::text, null, %L, %L, %L)',
  (select room_id from advance_ctx),
  '11111111-1111-1111-1111-111111111111',
  (select host_token from advance_ctx), 'abc123XYZ_-', 'Second'
), 'second song queued');

select lives_ok(format(
  'select public.playback_command(%L::uuid, %L::text, null, %L, %L)',
  (select room_id from advance_ctx),
  '11111111-1111-1111-1111-111111111111',
  (select host_token from advance_ctx), 'play'
), 'host starts queue');

create temp table original_song on commit drop as
select (r.playback_state ->> 'currentSongId')::uuid as song_id
from public.rooms r where r.id = (select room_id from advance_ctx);

select is(
  public.playback_next_if_current(
    (select room_id from advance_ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from advance_ctx),
    (select song_id from original_song)
  ) ->> 'advanced',
  'true', 'first end event advances');

select is(
  public.playback_next_if_current(
    (select room_id from advance_ctx),
    '11111111-1111-1111-1111-111111111111'::text,
    (select host_token from advance_ctx),
    (select song_id from original_song)
  ) ->> 'advanced',
  'false', 'duplicate end event is a harmless no-op');

select is(
  (select r.playback_state ->> 'currentVideoId'
   from public.rooms r where r.id = (select room_id from advance_ctx)),
  'abc123XYZ_-', 'duplicate end does not skip the next song');

select * from finish();
rollback;
