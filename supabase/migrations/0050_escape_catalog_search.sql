-- A catalog search term is data, not a LIKE pattern. Unescaped, '%' matches
-- every row (the catalog holds thousands), 'Hal_' matches 'Halo', and a lone
-- trailing backslash makes LIKE raise, so the search box could scan the whole
-- table or answer 500. Escape the pattern's own metacharacters and say so.
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
           or lower(c.title) like '%' || replace(replace(replace(
                lower(btrim(p_query)),
                E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' escape E'\\')
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

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'echo_service') then
    execute 'grant execute on function public.karaoke_catalog_page(text, text, integer, integer) to echo_service';
  end if;
end;
$$;
