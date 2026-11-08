-- Per-schema default privileges can only add to the global defaults; the
-- PostgreSQL docs use this exact statement as the example that cannot revoke
-- the built-in PUBLIC EXECUTE on functions:
--   alter default privileges in schema public revoke execute on functions from public;
-- Use the global form for the role that owns future migrations so a new
-- function cannot become browser-executable by default.

do $$
begin
  execute format(
    'alter default privileges for role %I revoke execute on functions from public, anon, authenticated',
    current_user
  );
  execute format(
    'alter default privileges for role %I revoke select, insert, update on tables from public, anon, authenticated',
    current_user
  );
  execute format(
    'alter default privileges for role %I revoke usage, select, update on sequences from public, anon, authenticated',
    current_user
  );
end;
$$;
