begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select function_privs_are(
  'public', 'queue_add_preflight',
  array['uuid', 'text', 'text', 'text', 'text'],
  'anon', array[]::text[], 'anon cannot preflight a queue add');
select function_privs_are(
  'public', 'queue_add_preflight',
  array['uuid', 'text', 'text', 'text', 'text'],
  'authenticated', array[]::text[], 'authenticated cannot preflight a queue add');
select is(
  has_function_privilege(
    'service_role',
    'public.queue_add_preflight(uuid, text, text, text, text)',
    'execute'),
  true,
  'service_role can preflight a queue add');

select function_privs_are(
  'public', 'peek_daily_rate_limit',
  array['text', 'text', 'integer', 'text', 'timestamptz'],
  'anon', array[]::text[], 'anon cannot peek at a daily limit');
select function_privs_are(
  'public', 'peek_daily_rate_limit',
  array['text', 'text', 'integer', 'text', 'timestamptz'],
  'authenticated', array[]::text[], 'authenticated cannot peek at a daily limit');
select function_privs_are(
  'public', 'refund_daily_rate_limit',
  array['text', 'text', 'text', 'timestamptz'],
  'anon', array[]::text[], 'anon cannot refund a daily limit');
select function_privs_are(
  'public', 'refund_daily_rate_limit',
  array['text', 'text', 'text', 'timestamptz'],
  'authenticated', array[]::text[], 'authenticated cannot refund a daily limit');

create temp table qctx on commit drop as
select
  (created ->> 'roomId')::uuid as room_id,
  (created ->> 'hostToken') as host_token
from (
  select public.create_room(
    'MNPQRSVWXYZ01234',
    'quota-host',
    'Quota Host',
    repeat('g', 40),
    repeat('h', 40)
  ) as created
) s;

create temp table guest on commit drop as
select (joined ->> 'guestToken') as guest_token
from (
  select public.join_room(
    'MNPQRSVWXYZ01234',
    'quota-guest',
    'Quota Guest',
    repeat('j', 40)
  ) as joined
) s;

select is(
  public.queue_add_preflight(
    (select room_id from qctx),
    'quota-guest',
    (select guest_token from guest),
    null::text,
    'dQw4w9WgXcQ'
  ) ->> 'allowed',
  'true',
  'a valid guest preflight passes');

select lives_ok(
  format('select public.queue_add(%L::uuid, %L::text, %L, null, %L, %L)', (select room_id from qctx), 'quota-guest', (select guest_token from guest), 'dQw4w9WgXcQ', 'Preflight Song'),
  'the song is added');

select throws_ok(
  format('select public.queue_add_preflight(%L::uuid, %L::text, %L, null, %L)', (select room_id from qctx), 'quota-guest', (select guest_token from guest), 'dQw4w9WgXcQ'),
  '22023', 'DUPLICATE_SONG',
  'the preflight rejects a duplicate before an outbound lookup');

select lives_ok(
  format('select public.host_command(%L::uuid, %L::text, %L, %L)', (select room_id from qctx), '11111111-1111-1111-1111-111111111111', (select host_token from qctx), 'lock'),
  'the host locks guest requests');

select throws_ok(
  format('select public.queue_add_preflight(%L::uuid, %L::text, %L, null, %L)', (select room_id from qctx), 'quota-guest', (select guest_token from guest), 'abc123XYZ_-'),
  '22023', 'GUEST_CONTROLS_LOCKED',
  'the preflight rejects a locked-room guest');

select is(
  public.queue_add_preflight(
    (select room_id from qctx),
    'quota-host',
    null::text,
    (select host_token from qctx),
    'abc123XYZ_-'
  ) ->> 'allowed',
  'true',
  'the host still passes the preflight while guests are locked');

select is(
  public.peek_daily_rate_limit('peek-subject', 'peek-bucket', 2) ->> 'allowed',
  'true',
  'an empty daily counter is available');
select is(
  public.peek_daily_rate_limit('peek-subject', 'peek-bucket', 2) ->> 'count',
  '0',
  'peeking an empty daily counter reports zero');
select is(
  public.consume_daily_rate_limit('peek-subject', 'peek-bucket', 2) ->> 'allowed',
  'true',
  'the first daily use is allowed');
select is(
  public.consume_daily_rate_limit('peek-subject', 'peek-bucket', 2) ->> 'allowed',
  'true',
  'the second daily use is allowed');
select is(
  public.peek_daily_rate_limit('peek-subject', 'peek-bucket', 2) ->> 'allowed',
  'false',
  'a full daily counter is reported as blocked');
select is(
  public.peek_daily_rate_limit('peek-subject', 'peek-bucket', 2) ->> 'count',
  '2',
  'the peek does not increment the counter');
select is(
  public.refund_daily_rate_limit('peek-subject', 'peek-bucket') ->> 'count',
  '1',
  'a failed search refunds one slot');
select is(
  public.peek_daily_rate_limit('peek-subject', 'peek-bucket', 2) ->> 'count',
  '1',
  'the refund is visible to the next search');

select * from finish();
rollback;
