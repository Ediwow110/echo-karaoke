begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

insert into public.karaoke_catalog (video_id, title, channel_title, channel_id, thumbnail_url, published_at)
values
  ('aaaaaaaaaaa', 'Halo - Beyonce (Karaoke)', 'Musisi Karaoke', 'UC_musisi', null, '2025-01-02T00:00:00Z'),
  ('bbbbbbbbbbb', 'Risk It All - Bruno Mars (Karaoke)', 'Sing King', 'UC_sing', null, '2025-01-03T00:00:00Z'),
  ('ccccccccccc', 'Iris - Goo Goo Dolls (Karaoke)', 'KaraokeTV', 'UC_tv', null, '2025-01-01T00:00:00Z');

-- Enough filler to reach past the 5000-row offset clamp boundary, so the clamp
-- assertions below can actually fail when the clamp is removed. Ids are 11
-- alphanumeric characters and dates are distinct and older than the three
-- hand-written rows above, so newest-first ordering and the per-channel counts
-- stay exactly as they are.
insert into public.karaoke_catalog (video_id, title, channel_title, channel_id, published_at)
select 'g' || lpad(i::text, 10, '0'),
       'Generated Song ' || i,
       'Generated Karaoke',
       'UC_generated',
       timestamptz '2024-12-31T00:00:00Z' - (i || ' minutes')::interval
from generate_series(1, 5000) as i;

select is(
  (public.karaoke_catalog_page('', '', 0, 30) -> 'total')::int,
  5003,
  'unfiltered page counts every row');
select is(
  (public.karaoke_catalog_page('', '', 0, 2) -> 'total')::int,
  5003,
  'total counts every match, not just the page');
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

-- limit is clamped: 0 becomes 1, anything above 50 becomes 50.
select is(
  jsonb_array_length(public.karaoke_catalog_page('', '', 0, 0) -> 'items'),
  1,
  'limit is clamped up to 1');
select is(
  jsonb_array_length(public.karaoke_catalog_page('', '', 0, 500) -> 'items'),
  50,
  'limit is clamped down to 50');

-- offset is clamped: negative becomes 0, anything above 5000 becomes 5000.
-- 5003 fixture rows means an unclamped offset 5001 would skip the 5000th row
-- and return 2 rows instead of the 3 that offset 5000 returns.
select is(
  public.karaoke_catalog_page('', '', -1, 2) -> 'items' -> 0 ->> 'videoId',
  public.karaoke_catalog_page('', '', 0, 2) -> 'items' -> 0 ->> 'videoId',
  'negative offset clamps to 0');
select is(
  jsonb_array_length(public.karaoke_catalog_page('', '', 5001, 3) -> 'items'),
  3,
  'offset is clamped at 5000');

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

-- One malformed date from the provider must not cost the whole page. YouTube is
-- external, and a cast failure inside the statement would roll back every row in it.
select is(
  (public.karaoke_catalog_upsert('UC_musisi',
    ('[{"videoId":"bad00000001","title":"Future upload","channelTitle":"Musisi Karaoke","publishedAt":"tomorrow-ish"},'
    || '{"videoId":"bad00000002","title":"Good neighbour","channelTitle":"Musisi Karaoke","publishedAt":"2025-03-04T05:06:07Z"}]')::jsonb)),
  2,
  'an unparsable publishedAt drops that field, not the row or its neighbours');
select is(
  (select published_at from public.karaoke_catalog where video_id = 'bad00000001'),
  null,
  'the unparsable date is stored as absent rather than guessed');
select isnt(
  (select published_at from public.karaoke_catalog where video_id = 'bad00000002'),
  null,
  'a valid date in the same page still lands');

select * from finish();
rollback;
