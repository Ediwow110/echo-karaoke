-- The karaoke strip is a twice-daily lookup, not a ten-minute search. Allow
-- the shared search cache to retain it for up to a day while keeping the
-- function's grants unchanged.

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
  if p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 86400 then
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

revoke all on function public.youtube_search_cache_put(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.youtube_search_cache_put(text, jsonb, integer) to service_role;
