-- 0043: the expiry sweep belongs to the runtime surface too.
--
-- 0042 granted cleanup_expired_rooms to service_role only. The app connects as
-- echo_service, and the grant-parity suite -- which is vacuous on the local
-- stack because that role exists only on Neon -- failed the branch. Grant the
-- function to the runtime role when it exists, the same way 0034, 0039, and
-- 0040 do.

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

  execute 'grant execute on function public.cleanup_expired_rooms(interval) to echo_service';

  raise notice 'runtime role echo_service can run the expiry sweep';
end;
$$;
