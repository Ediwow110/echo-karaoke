begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is(
  (select relrowsecurity from pg_class where oid = 'public.karaoke_catalog'::regclass),
  true, 'catalog data has row-level security enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.karaoke_catalog_cursor'::regclass),
  true, 'channel sync cursors have row-level security enabled'
);
select function_privs_are(
  'public', 'karaoke_catalog_retire_stale', array[]::text[],
  'anon', array[]::text[], 'anonymous cannot delete catalog metadata'
);
select function_privs_are(
  'public', 'karaoke_catalog_retire_stale', array[]::text[],
  'echo_auth', array[]::text[], 'auth-only role cannot delete catalog metadata'
);
select ok(has_function_privilege(
  'service_role', 'public.karaoke_catalog_retire_stale()', 'execute'),
  'service role can retire expired catalog metadata'
);

insert into public.karaoke_catalog
  (video_id, title, channel_title, channel_id, synced_at)
values
  ('oldoldold01', 'Old track', 'YouTube', 'UC_test', now() - interval '29 days'),
  ('freshfresh1', 'Fresh track', 'YouTube', 'UC_test', now() - interval '1 day');

insert into public.karaoke_catalog_cursor
  (channel_id, uploads_playlist_id, last_synced_at)
values ('UC_retired', 'UU_retired', now() - interval '29 days');

select is(
  (public.karaoke_catalog_page('', 'UC_test', 0, 30) -> 'total')::integer,
  1, 'expired videos are never served as current songbook data'
);
select is(
  public.karaoke_catalog_page('', 'UC_test', 0, 30) -> 'items' -> 0 ->> 'videoId',
  'freshfresh1', 'fresh videos remain browsable'
);

select lives_ok('select public.karaoke_catalog_retire_stale()',
  'retirement function can purge expired provider metadata');
select is((select count(*)::integer from public.karaoke_catalog
  where video_id = 'oldoldold01'), 0, 'expired metadata is deleted');
select is((select count(*)::integer from public.karaoke_catalog
  where video_id = 'freshfresh1'), 1, 'fresh metadata survives retirement');
select is((select count(*)::integer from public.karaoke_catalog_cursor
  where channel_id = 'UC_retired'), 0, 'expired sync cursors are deleted');

select * from finish();
rollback;
