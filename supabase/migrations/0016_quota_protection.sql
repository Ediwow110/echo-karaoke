-- Bound YouTube lookups so one guest cannot consume the API quota or turn the
-- metadata endpoint into an outbound-request amplifier. Service-role only.

create table public.rate_limits (
  subject text not null,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null,
  constraint rate_limits_count_check check (count >= 0),
  primary key (subject, bucket)
);

create index rate_limits_window_start_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
revoke all on table public.rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.rate_limits to service_role;

create table public.youtube_search_cache (
  query_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index youtube_search_cache_expires_at_idx on public.youtube_search_cache (expires_at);

alter table public.youtube_search_cache enable row level security;
revoke all on table public.youtube_search_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.youtube_search_cache to service_role;

create or replace function public.consume_rate_limit(
  p_subject text,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_actual_start timestamptz;
  v_count integer;
begin
  if p_subject is null or char_length(p_subject) not between 1 and 120 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_bucket is null or char_length(p_bucket) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000000 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 2592000 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    (floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds)::double precision
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

  if random() < 0.01 then
    delete from public.rate_limits
    where window_start < clock_timestamp() - interval '30 days';
  end if;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count', v_count,
    'limit', p_limit,
    'retryAfterSeconds', greatest(
      1,
      ceil(extract(epoch from (v_actual_start + make_interval(secs => p_window_seconds) - clock_timestamp())))::integer
    )
  );
end;
$$;

create or replace function public.youtube_search_cache_get(p_query text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  if p_query is null or char_length(p_query) not between 1 and 200 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  select c.payload into v_payload
  from public.youtube_search_cache c
  where c.query_key = p_query
    and c.expires_at > clock_timestamp();

  return v_payload;
end;
$$;

create or replace function public.youtube_search_cache_put(
  p_query text,
  p_payload jsonb,
  p_ttl_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_query is null or char_length(p_query) not between 1 and 200 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_payload is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 3600 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.youtube_search_cache
  where expires_at < clock_timestamp() - interval '1 hour';

  insert into public.youtube_search_cache (query_key, payload, expires_at)
  values (p_query, p_payload, clock_timestamp() + make_interval(secs => p_ttl_seconds))
  on conflict (query_key) do update
    set payload = excluded.payload,
        expires_at = excluded.expires_at,
        created_at = now();
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.youtube_search_cache_get(text) from public, anon, authenticated;
revoke all on function public.youtube_search_cache_put(text, jsonb, integer) from public, anon, authenticated;

grant execute on function public.consume_rate_limit(text, text, integer, integer) to service_role;
grant execute on function public.youtube_search_cache_get(text) to service_role;
grant execute on function public.youtube_search_cache_put(text, jsonb, integer) to service_role;
