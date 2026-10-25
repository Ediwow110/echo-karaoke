-- A browsable karaoke catalog. Rows are display metadata only: every song still
-- plays from YouTube, and browsing never spends search quota.

create table if not exists public.karaoke_catalog (
  video_id text primary key,
  title text not null,
  channel_title text not null,
  channel_id text not null,
  thumbnail_url text,
  published_at timestamptz,
  synced_at timestamptz not null default now(),
  constraint karaoke_catalog_video_id_shape check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  constraint karaoke_catalog_title_length check (char_length(title) between 1 and 500)
);

create index if not exists karaoke_catalog_title_lower_idx on public.karaoke_catalog (lower(title));
create index if not exists karaoke_catalog_channel_idx on public.karaoke_catalog (channel_id);

create table if not exists public.karaoke_catalog_cursor (
  channel_id text primary key,
  uploads_playlist_id text not null,
  next_page_token text,
  exhausted_at timestamptz,
  last_synced_at timestamptz
);

revoke all on public.karaoke_catalog from public, anon, authenticated;
revoke all on public.karaoke_catalog_cursor from public, anon, authenticated;
grant select, insert, update on public.karaoke_catalog to service_role;
grant select, insert, update on public.karaoke_catalog_cursor to service_role;

create or replace function public.karaoke_catalog_page(
  p_query text,
  p_channel text,
  p_offset integer,
  p_limit integer
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with filtered as (
    select c.video_id, c.title, c.channel_title, c.channel_id, c.thumbnail_url, c.published_at
    from public.karaoke_catalog c
    where (coalesce(btrim(p_query), '') = ''
           or lower(c.title) like '%' || lower(btrim(p_query)) || '%')
      and (coalesce(btrim(p_channel), '') = '' or c.channel_id = btrim(p_channel))
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
         'publishedAt', page.published_at) order by page.published_at desc nulls last, page.video_id)
       from page),
      '[]'::jsonb)
  );
$$;

create or replace function public.karaoke_catalog_upsert(p_channel_id text, p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_channel_id is null or char_length(p_channel_id) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  insert into public.karaoke_catalog
    (video_id, title, channel_title, channel_id, thumbnail_url, published_at, synced_at)
  select item ->> 'videoId',
         item ->> 'title',
         coalesce(nullif(item ->> 'channelTitle', ''), 'YouTube'),
         p_channel_id,
         nullif(item ->> 'thumbnailUrl', ''),
         nullif(item ->> 'publishedAt', '')::timestamptz,
         now()
  from jsonb_array_elements(p_items) item
  where item ->> 'videoId' ~ '^[A-Za-z0-9_-]{11}$'
    and char_length(coalesce(item ->> 'title', '')) between 1 and 500
  on conflict (video_id) do update
    set title = excluded.title,
        channel_title = excluded.channel_title,
        thumbnail_url = excluded.thumbnail_url,
        published_at = excluded.published_at,
        synced_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.karaoke_catalog_cursor_save(
  p_channel_id text,
  p_uploads_playlist_id text,
  p_page_token text,
  p_exhausted boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_channel_id is null or char_length(p_channel_id) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;
  if p_uploads_playlist_id is null or char_length(p_uploads_playlist_id) not between 1 and 80 then
    raise exception 'VALIDATION_ERROR' using errcode = '22023';
  end if;

  insert into public.karaoke_catalog_cursor
    (channel_id, uploads_playlist_id, next_page_token, exhausted_at, last_synced_at)
  values (p_channel_id, p_uploads_playlist_id,
          case when p_exhausted then null else p_page_token end,
          case when p_exhausted then now() end,
          now())
  on conflict (channel_id) do update
    set uploads_playlist_id = excluded.uploads_playlist_id,
        next_page_token = excluded.next_page_token,
        exhausted_at = excluded.exhausted_at,
        last_synced_at = now();
end;
$$;

create or replace function public.karaoke_catalog_cursors()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'channelId', c.channel_id,
    'uploadsPlaylistId', c.uploads_playlist_id,
    'nextPageToken', c.next_page_token,
    'exhaustedAt', c.exhausted_at,
    'lastSyncedAt', c.last_synced_at) order by c.channel_id), '[]'::jsonb)
  from public.karaoke_catalog_cursor c;
$$;

revoke all on function public.karaoke_catalog_page(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.karaoke_catalog_page(text, text, integer, integer) to service_role;
revoke all on function public.karaoke_catalog_upsert(text, jsonb) from public, anon, authenticated;
grant execute on function public.karaoke_catalog_upsert(text, jsonb) to service_role;
revoke all on function public.karaoke_catalog_cursor_save(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.karaoke_catalog_cursor_save(text, text, text, boolean) to service_role;
revoke all on function public.karaoke_catalog_cursors() from public, anon, authenticated;
grant execute on function public.karaoke_catalog_cursors() to service_role;
