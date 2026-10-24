-- A failed upstream search did not spend YouTube quota, so the daily counters
-- charged before the call must be able to give the slot back. The refund is
-- limited to the current Pacific window and never creates a negative count.

create or replace function public.refund_daily_rate_limit(
  p_subject text,
  p_bucket text,
  p_time_zone text default 'America/Los_Angeles',
  p_now timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_window_start timestamptz;
  v_count integer;
begin
  if p_subject is null or char_length(p_subject) not between 1 and 160 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_bucket is null or char_length(p_bucket) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_time_zone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = p_time_zone
  ) then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_window_start := (
    date_trunc('day', v_now at time zone p_time_zone) at time zone p_time_zone
  );

  update public.rate_limits r
  set count = greatest(r.count - 1, 0)
  where r.subject = p_subject
    and r.bucket = p_bucket
    and r.window_start = v_window_start
  returning r.count into v_count;

  return jsonb_build_object('count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.refund_daily_rate_limit(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refund_daily_rate_limit(text, text, text, timestamptz)
  to service_role;
