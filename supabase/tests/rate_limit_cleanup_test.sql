begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- Daily budget rows and idle subjects have no sweep of their own; the sliding
-- limiter only prunes when a request happens to roll the one-in-a-hundred dice.
-- The daily cron now owns the retention window.

insert into public.rate_limits (subject, bucket, window_start, count)
values
  ('cleanup-check:stale', 'vote', now() - interval '31 days', 5),
  ('cleanup-check:recent', 'vote', now() - interval '2 days', 3);

select ok(
  public.cleanup_rate_limits() >= 1,
  'the sweep removes rows past the retention window');

select is(
  (select count(*) from public.rate_limits where subject = 'cleanup-check:stale'),
  0::bigint,
  'a ledger row older than the window is gone');

select is(
  (select count(*) from public.rate_limits where subject = 'cleanup-check:recent'),
  1::bigint,
  'a recent ledger row stays');

select is(
  has_function_privilege('anon', 'public.cleanup_rate_limits()', 'execute'),
  false,
  'anon cannot run the ledger sweep');

select is(
  has_function_privilege('service_role', 'public.cleanup_rate_limits()', 'execute'),
  true,
  'the service role can run the ledger sweep');

select * from finish();
rollback;
