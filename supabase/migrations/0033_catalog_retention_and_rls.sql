-- Forward-only Neon/PostgreSQL hardening for the EXISTING karaoke catalog.
-- Non-authorized YouTube metadata must be revalidated or deleted within
-- 30 calendar days. Keep a 28-day application window for a safety margin.
-- An external daily cleanup schedule is still required when the site is idle.

alter table public.karaoke_catalog enable row level security;
alter table public.karaoke_catalog_cursor enable row level security;

revoke all on table public.karaoke_catalog, public.karaoke_catalog_cursor
  from public, anon, authenticated, echo_auth;
grant select, insert, update, delete on table
  public.karaoke_catalog, public.karaoke_catalog_cursor to service_role;

create index if not exists karaoke_catalog_synced_idx
  on public.karaoke_catalog(synced_at);
create index if not exists karaoke_catalog_cursor_synced_idx
  on public.karaoke_catalog_cursor(last_synced_at);

-- Never show YouTube metadata beyond its fresh, validated window.
create or replace function public.karaoke_catalog_page(
  p_query text, p_channel text, p_offset integer, p_limit integer
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select c.video_id, c.title, c.channel_title, c.channel_id,
           c.thumbnail_url, c.published_at, c.synced_at
    from public.karaoke_catalog c
    where c.synced_at > now() - interval '28 days'
      and (coalesce(btrim(p_query), '') = ''
           or lower(c.title) like '%' || lower(btrim(p_query)) || '%')
      and (coalesce(btrim(p_channel), '') = ''
           or c.channel_id = btrim(p_channel))
  ), page as (
    select * from filtered
    order by published_at desc nulls last, video_id
    offset least(greatest(coalesce(p_offset, 0), 0), 5000)
    limit least(greatest(coalesce(p_limit, 30), 1), 50)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce(
      (select jsonb_agg(jsonb_build_object(
        'videoId', page.video_id,
        'title', page.title,
        'channelTitle', page.channel_title,
        'channelId', page.channel_id,
        'thumbnailUrl', page.thumbnail_url,
        'publishedAt', page.published_at,
        'syncedAt', page.synced_at
      ) order by page.published_at desc nulls last, page.video_id)
       from page),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.karaoke_catalog_page(text,text,integer,integer)
  from public, anon, authenticated, echo_auth;
grant execute on function public.karaoke_catalog_page(text,text,integer,integer)
  to service_role;

-- Called after host authorization during channel refresh. Also expose it to
-- a separately authorized daily retention job; browsing itself stays read-only.
create or replace function public.karaoke_catalog_retire_stale()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_songs integer := 0;
  v_cursors integer := 0;
begin
  delete from public.karaoke_catalog
  where synced_at <= now() - interval '28 days';
  get diagnostics v_songs = row_count;

  delete from public.karaoke_catalog_cursor
  where last_synced_at is null
     or last_synced_at <= now() - interval '28 days';
  get diagnostics v_cursors = row_count;

  return jsonb_build_object(
    'retiredSongs', v_songs, 'retiredCursors', v_cursors
  );
end;
$$;

revoke all on function public.karaoke_catalog_retire_stale()
  from public, anon, authenticated, echo_auth;
grant execute on function public.karaoke_catalog_retire_stale()
  to service_role;
