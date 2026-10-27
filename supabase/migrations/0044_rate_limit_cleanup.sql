-- 0044: the rate-limit ledger is pruned on a schedule.
--
-- Daily budget rows have no sweep of their own, and the sliding limiter only
-- prunes when a request happens to roll its one-in-a-hundred dice. Rows for
-- deleted rooms and idle subjects therefore persisted indefinitely. Thirty days
-- is the longest window consume_rate_limit accepts, so nothing older can still
-- be read.

create or replace function public.cleanup_rate_limits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits
  where window_start < clock_timestamp() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_rate_limits() to service_role;

do $$
declare
  has_runtime_role boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'echo_service')
    into has_runtime_role;

  if not has_runtime_role then
    raise notice 'echo_service is not present in this database; skipping runtime grant';
    return;
  end if;

  execute 'grant execute on function public.cleanup_rate_limits() to echo_service';

  raise notice 'runtime role echo_service can run the ledger sweep';
end;
$$;

select cron.schedule(
  'cleanup-rate-limits',
  '15 3 * * *',
  $$ select public.cleanup_rate_limits() $$
);
