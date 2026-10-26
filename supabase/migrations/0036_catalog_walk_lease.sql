-- 0036: one songbook walk at a time.
--
-- The catalog is global: one refresh serves every room. Two hosts pressing
-- Refresh in the same minute each walk the same four channels, about sixteen
-- quota units apiece, so roughly 32 of the forty daily units go on work that was
-- already under way. The daily counter cannot catch this — it is an atomic upsert
-- that refuses the caller past the cap correctly — and the six-hour per-channel
-- throttle cannot either, because it only exempts a channel whose walk finished
-- and stamped a cursor. What is missing is a claim on the walk itself.

create table if not exists public.karaoke_catalog_lease (
  id smallint primary key default 1
    constraint karaoke_catalog_lease_singleton check (id = 1),
  holder text not null
    constraint karaoke_catalog_lease_holder_length check (char_length(holder) between 1 and 80),
  taken_at timestamptz not null default now()
);

-- Claims the walk. The holder is a per-request token, so a walk that resumes
-- across requests can renew its own lease without letting anyone else in.
create or replace function public.karaoke_catalog_lease_take(
  p_holder text,
  p_ttl interval default interval '4 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holder text;
  v_taken timestamptz;
  v_rows integer;
begin
  if p_holder is null or char_length(p_holder) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_ttl is null or p_ttl < interval '0 seconds' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  -- clock_timestamp, not now(): staleness is a question about the real moment the
  -- lease was asked about, and a long transaction must not freeze the answer.
  insert into public.karaoke_catalog_lease (id, holder, taken_at)
  values (1, p_holder, clock_timestamp())
  on conflict (id) do update
    set holder = excluded.holder,
        taken_at = excluded.taken_at
    where karaoke_catalog_lease.holder = p_holder
       or karaoke_catalog_lease.taken_at < clock_timestamp() - p_ttl
  returning holder, taken_at into v_holder, v_taken;

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    select l.holder, l.taken_at into v_holder, v_taken
    from public.karaoke_catalog_lease l
    where l.id = 1;

    return jsonb_build_object(
      'acquired', false,
      'holder', v_holder,
      'takenAt', v_taken,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (
        (v_taken + p_ttl) - clock_timestamp())))::integer)
    );
  end if;

  return jsonb_build_object(
    'acquired', true,
    'holder', v_holder,
    'takenAt', v_taken
  );
end;
$$;

-- Frees the walk. Only the holder may release, so a slow walk that lost its lease
-- to the ttl cannot delete whoever took it next.
create or replace function public.karaoke_catalog_lease_release(
  p_holder text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_holder is null or char_length(p_holder) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.karaoke_catalog_lease
  where id = 1 and holder = p_holder;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on public.karaoke_catalog_lease from public, anon, authenticated;
revoke all on function public.karaoke_catalog_lease_take(text, interval) from public, anon, authenticated;
revoke all on function public.karaoke_catalog_lease_release(text) from public, anon, authenticated;
grant execute on function public.karaoke_catalog_lease_take(text, interval) to service_role;
grant execute on function public.karaoke_catalog_lease_release(text) to service_role;

-- echo_service is the role the deployed function connects as and it exists only on
-- Neon. Without these grants every refresh answers 500 with SQLSTATE 42501 while
-- pgTAP stays green, which is the failure 0034 recorded once already.
do $$
declare
  has_runtime_role boolean;
begin
  select exists (select 1 from pg_roles where rolname = 'echo_service')
    into has_runtime_role;

  if not has_runtime_role then
    raise notice 'echo_service is not present in this database; skipping runtime grants';
    return;
  end if;

  execute 'grant execute on function public.karaoke_catalog_lease_take(text, interval) to echo_service';
  execute 'grant execute on function public.karaoke_catalog_lease_release(text) to echo_service';

  raise notice 'runtime role echo_service granted the catalog lease surface';
end;
$$;
