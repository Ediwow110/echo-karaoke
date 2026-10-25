-- The app connects as echo_service, not service_role. Migrations that grant only
-- to service_role leave the runtime role unable to execute them, and every other
-- test still passes because pgTAP runs as the owner. This pins the class shut:
-- no function may be reachable by service_role and unreachable by the app.
begin;
select plan(2);

select is(
  (select case
     when not exists (select 1 from pg_roles where rolname = 'echo_service') then 0::bigint
     else (
       select count(*)
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and has_function_privilege('service_role', p.oid, 'execute')
         and not has_function_privilege('echo_service', p.oid, 'execute')
     )
   end),
  0::bigint,
  'every public function service_role can execute is also executable by echo_service'
);

select is(
  (select case
     when not exists (select 1 from pg_roles where rolname = 'echo_service') then 0::bigint
     else (
       select count(*)
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and has_table_privilege('service_role', c.oid, 'SELECT')
         and not has_table_privilege('echo_service', c.oid, 'SELECT')
     )
   end),
  0::bigint,
  'every public table service_role can read is also readable by echo_service'
);

select * from finish();
rollback;
