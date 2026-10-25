begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

insert into public.karaoke_catalog (video_id, title, channel_title, channel_id, thumbnail_url, published_at)
values
  ('aaaaaaaaaaa', 'Halo - Beyonce (Karaoke)', 'Musisi Karaoke', 'UC_musisi', null, '2025-01-02T00:00:00Z'),
  ('bbbbbbbbbbb', 'Risk It All - Bruno Mars (Karaoke)', 'Sing King', 'UC_sing', null, '2025-01-03T00:00:00Z'),
  ('ccccccccccc', 'Iris - Goo Goo Dolls (Karaoke)', 'KaraokeTV', 'UC_tv', null, '2025-01-01T00:00:00Z');

select is(
  (public.karaoke_catalog_page('', '', 0, 30) -> 'total')::int,
  3,
  'unfiltered page counts every row');
select is(
  jsonb_array_length(public.karaoke_catalog_page('', '', 0, 2) -> 'items'),
  2,
  'limit is honoured');
select is(
  public.karaoke_catalog_page('', '', 0, 2) -> 'items' -> 0 ->> 'videoId',
  'bbbbbbbbbbb',
  'newest published first');
select is(
  (public.karaoke_catalog_page('halo', '', 0, 30) -> 'total')::int,
  1,
  'query matches title case-insensitively');
select is(
  (public.karaoke_catalog_page('', 'UC_sing', 0, 30) -> 'total')::int,
  1,
  'channel filter matches exactly');
select is(
  jsonb_array_length(public.karaoke_catalog_page('', '', 0, 500) -> 'items'),
  3,
  'limit is clamped without error');
select is(
  (public.karaoke_catalog_upsert('UC_musisi',
    '[{"videoId":"aaaaaaaaaaa","title":"Halo - Beyonce (Karaoke)","channelTitle":"Musisi Karaoke","thumbnailUrl":"https://i.ytimg.com/x.jpg","publishedAt":"2025-01-02T00:00:00Z"}]')),
  1,
  'upsert writes one row');
select is(
  (select item ->> 'thumbnailUrl'
   from jsonb_array_elements(public.karaoke_catalog_page('', '', 0, 30) -> 'items') item
   where item ->> 'videoId' = 'aaaaaaaaaaa'),
  'https://i.ytimg.com/x.jpg',
  'upsert refreshes existing metadata');

select function_privs_are('public', 'karaoke_catalog_page',
  array['text', 'text', 'integer', 'integer'], 'anon', array[]::text[],
  'anon cannot page the catalog');
select function_privs_are('public', 'karaoke_catalog_page',
  array['text', 'text', 'integer', 'integer'], 'authenticated', array[]::text[],
  'authenticated cannot page the catalog');
select is(has_function_privilege('service_role',
  'public.karaoke_catalog_page(text, text, integer, integer)', 'execute'),
  true, 'service_role can page the catalog');

select * from finish();
rollback;
