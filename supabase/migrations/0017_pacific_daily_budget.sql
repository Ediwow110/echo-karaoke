-- YouTube quota resets on the Pacific calendar day, not UTC. This limiter
-- buckets daily budgets by a local date so the budget cannot reset twice in
-- one YouTube quota day or stay exhausted after the real reset.

create or replace function public.consume_daily_rate_limit(
  p_subject text,
  p_bucket text,
  p_limit integer,
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
  v_next_start timestamptz;
  v_actual_start timestamptz;
  v_count integer;
begin
  if p_subject is null or char_length(p_subject) not between 1 and 160 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_bucket is null or char_length(p_bucket) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000000 then
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
  v_next_start := (
    date_trunc('day', (v_now at time zone p_time_zone) + interval '1 day') at time zone p_time_zone
  );

  insert into public.rate_limits (subject, bucket, window_start, count)
  values (p_subject, p_bucket, v_window_start, 1)
  on conflict (subject, bucket) do update
    set count = case
          when public.rate_limits.window_start < v_window_start then 1
          else public.rate_limits.count + 1
        end,
        window_start = case
          when public.rate_limits.window_start < v_window_start then v_window_start
          else public.rate_limits.window_start
        end
  returning count, window_start into v_count, v_actual_start;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'retryAfterSeconds', greatest(
      1,
      ceil(extract(epoch from (v_next_start - v_now)))::integer
    )
  );
end;
$$;

revoke all on function public.consume_daily_rate_limit(text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.consume_daily_rate_limit(text, text, integer, text, timestamptz) to service_role;
