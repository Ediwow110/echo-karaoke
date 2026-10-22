begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

select table_privs_are('public', 'rate_limits', 'anon', array[]::text[], 'anon has no privileges on rate_limits');
select table_privs_are('public', 'rate_limits', 'authenticated', array[]::text[], 'authenticated has no privileges on rate_limits');
select table_privs_are('public', 'youtube_search_cache', 'anon', array[]::text[], 'anon has no privileges on youtube_search_cache');
select table_privs_are('public', 'youtube_search_cache', 'authenticated', array[]::text[], 'authenticated has no privileges on youtube_search_cache');

select function_privs_are('public', 'consume_rate_limit', array['text', 'text', 'integer', 'integer'], 'anon', array[]::text[], 'anon cannot consume rate limits');
select function_privs_are('public', 'consume_rate_limit', array['text', 'text', 'integer', 'integer'], 'authenticated', array[]::text[], 'authenticated cannot consume rate limits');
select function_privs_are('public', 'youtube_search_cache_get', array['text'], 'anon', array[]::text[], 'anon cannot read the search cache');
select function_privs_are('public', 'youtube_search_cache_put', array['text', 'jsonb', 'integer'], 'authenticated', array[]::text[], 'authenticated cannot write the search cache');
select function_privs_are('public', 'consume_daily_rate_limit', array['text', 'text', 'integer', 'text', 'timestamptz'], 'anon', array[]::text[], 'anon cannot consume daily limits');
select function_privs_are('public', 'consume_daily_rate_limit', array['text', 'text', 'integer', 'text', 'timestamptz'], 'authenticated', array[]::text[], 'authenticated cannot consume daily limits');

select is(
  public.consume_rate_limit('user-a', 'search', 2, 60) ->> 'allowed',
  'true',
  'the first request is allowed');
select is(
  public.consume_rate_limit('user-a', 'search', 2, 60) ->> 'allowed',
  'true',
  'the second request is allowed');

create temp table limiter_result on commit drop as
select public.consume_rate_limit('user-a', 'search', 2, 60) as result;

select is(
  (select result ->> 'allowed' from limiter_result),
  'false',
  'the request over the limit is denied');
select is(
  (select result ->> 'count' from limiter_result),
  '3',
  'the limiter counts every request');

select is(
  public.consume_rate_limit('user-b', 'short', 1, 1) ->> 'allowed',
  'true',
  'the short window starts allowed');
select is(
  public.consume_rate_limit('user-b', 'short', 1, 1) ->> 'allowed',
  'false',
  'the short window then denies');
select pg_sleep(1.1);
select is(
  public.consume_rate_limit('user-b', 'short', 1, 1) ->> 'allowed',
  'true',
  'an expired window resets the count');

select is(
  public.youtube_search_cache_get('missing query'),
  null::jsonb,
  'a missing cache entry returns null');

select lives_ok(
  $$ select public.youtube_search_cache_put('abba', '{"results":[{"videoId":"x"}]}'::jsonb, 1) $$,
  'the cache stores a result');

select is(
  public.youtube_search_cache_get('abba'),
  '{"results":[{"videoId":"x"}]}'::jsonb,
  'a fresh cache entry is returned');

select pg_sleep(1.1);

select is(
  public.youtube_search_cache_get('abba'),
  null::jsonb,
  'an expired cache entry is ignored');

select throws_ok(
  $$ select public.consume_rate_limit(null::text, 'b', 1, 60) $$,
  '22023', 'VALIDATION_ERROR',
  'a limiter requires a subject');
select throws_ok(
  $$ select public.consume_rate_limit('u', 'b', 0, 60) $$,
  '22023', 'VALIDATION_ERROR',
  'a limiter requires a positive limit');
select throws_ok(
  $$ select public.consume_rate_limit('u', 'b', 1, 0) $$,
  '22023', 'VALIDATION_ERROR',
  'a limiter requires a positive window');
select throws_ok(
  $$ select public.youtube_search_cache_get('') $$,
  '22023', 'VALIDATION_ERROR',
  'an empty cache key is rejected');
select throws_ok(
  $$ select public.youtube_search_cache_put('q', null::jsonb, 60) $$,
  '22023', 'VALIDATION_ERROR',
  'a null cache payload is rejected');
select throws_ok(
  $$ select public.youtube_search_cache_put('q', '{}'::jsonb, 0) $$,
  '22023', 'VALIDATION_ERROR',
  'an invalid cache TTL is rejected');

create temp table daily_first on commit drop as
select public.consume_daily_rate_limit(
  'daily-user', 'daily', 1, 'America/Los_Angeles', '2026-10-22 06:59:00+00'
) as result;

select is(
  (select result ->> 'allowed' from daily_first),
  'true',
  'a Pacific-day budget allows the first request');
create temp table daily_same_day on commit drop as
select public.consume_daily_rate_limit(
  'daily-user', 'daily', 1, 'America/Los_Angeles', '2026-10-22 06:59:30+00'
) as result;
select is(
  (select result ->> 'allowed' from daily_same_day),
  'false',
  'the same Pacific day is still capped');
create temp table daily_next_day on commit drop as
select public.consume_daily_rate_limit(
  'daily-user', 'daily', 1, 'America/Los_Angeles', '2026-10-22 07:01:00+00'
) as result;
select is(
  (select result ->> 'allowed' from daily_next_day),
  'true',
  'the budget resets at Pacific midnight');
create temp table daily_next_day_again on commit drop as
select public.consume_daily_rate_limit(
  'daily-user', 'daily', 1, 'America/Los_Angeles', '2026-10-22 08:00:00+00'
) as result;
select is(
  (select result ->> 'allowed' from daily_next_day_again),
  'false',
  'the new Pacific day is capped after its first request');
select throws_ok(
  $$ select public.consume_daily_rate_limit('u', 'daily', 1, 'Not/AZone', '2026-10-22 07:01:00+00') $$,
  '22023', 'VALIDATION_ERROR',
  'an invalid time zone is rejected');

select * from finish();
rollback;
