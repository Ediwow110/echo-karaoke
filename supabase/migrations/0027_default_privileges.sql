-- Close the remaining default grants for objects a future migration creates.
-- Current tables and functions already have explicit grants; this prevents a
-- later public table or function from silently becoming browser accessible.

alter default privileges in schema public
  revoke select, insert, update on tables from public, anon, authenticated;
alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public
  revoke usage, select, update on sequences from public, anon, authenticated;
