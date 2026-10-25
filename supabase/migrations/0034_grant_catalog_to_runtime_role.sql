-- The app connects as echo_service, not service_role. Migrations 0031-0033 were
-- written after the 2026-10-25 credential rotation, which copied service_role's
-- then-current surface onto echo_service, so every function added since exists for
-- a role the app no longer uses. The songbook answered every host with SQLSTATE
-- 42501 while pgTAP stayed green, because pgTAP runs as the owner.
--
-- echo_service is a deployment credential, not a schema object: it exists on Neon
-- and not on the local Supabase stack. Grant only when the role is present so this
-- migration stays applyable everywhere, and let the grant-parity test report the
-- gap rather than the migration failing.

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

  execute 'grant select, insert, update, delete on table
    public.karaoke_catalog, public.karaoke_catalog_cursor to echo_service';

  execute 'grant execute on function public.karaoke_catalog_page(text, text, integer, integer) to echo_service';
  execute 'grant execute on function public.karaoke_catalog_upsert(text, jsonb) to echo_service';
  execute 'grant execute on function public.karaoke_catalog_cursor_save(text, text, text, boolean) to echo_service';
  execute 'grant execute on function public.karaoke_catalog_cursors() to echo_service';
  execute 'grant execute on function public.karaoke_catalog_retire_stale() to echo_service';
  execute 'grant execute on function public.playback_next_if_current(uuid, text, text, uuid) to echo_service';

  raise notice 'runtime role echo_service granted the songbook and auto-advance surface';
end;
$$;
