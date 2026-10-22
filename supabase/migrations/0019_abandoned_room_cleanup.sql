-- Delete a room once every member has stopped heartbeating.
-- The app sends a slow heartbeat while its tab is hidden, so a background
-- host tab is not treated as empty.

create extension if not exists pg_cron;

create index if not exists members_room_id_last_seen_at_idx
  on public.members (room_id, last_seen_at);

create index if not exists rooms_created_at_abandoned_idx
  on public.rooms (created_at);

create or replace function public.cleanup_abandoned_rooms(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_before is null then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_before > clock_timestamp() - interval '5 minutes' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  delete from public.rooms r
  where r.created_at <= p_before
    and not exists (
      select 1
      from public.members m
      where m.room_id = r.id
        and m.last_seen_at > p_before
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.cleanup_abandoned_rooms(timestamptz) from public, anon, authenticated;
grant execute on function public.cleanup_abandoned_rooms(timestamptz) to service_role;

select cron.schedule(
  'cleanup-abandoned-rooms',
  '*/5 * * * *',
  $$ select public.cleanup_abandoned_rooms(now() - interval '30 minutes') $$
);
