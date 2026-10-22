-- Platform compatibility.
--
-- The migrations below revoke table access from the browser roles and grant the
-- authorized operations to the service role. Supabase creates those roles and
-- the extensions schema on the platform. A plain Postgres does not, so create
-- them here when they are missing. On Supabase every statement below is a
-- no-op, so the same chain runs on both.
--
-- The browser roles hold no table privileges and cannot execute any of the
-- authorized operations. The service role exists so the Edge Functions can run
-- them; it bypasses row level security the way the Supabase service role does.

create schema if not exists extensions;

do
$$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

-- The extensions schema holds pgcrypto and, for the test suites, pgtap. On
-- Supabase it is already on the default search path, so the extension functions
-- resolve unqualified there. A plain Postgres does not include it, so the
-- functions would not resolve. Every call inside the schema is schema
-- qualified, and the authorized operations pin an empty search path, so adding
-- the schema to the default is safe.
do
$$
begin
  execute format('alter database %I set search_path = "$user", public, extensions', current_database());
end
$$;
