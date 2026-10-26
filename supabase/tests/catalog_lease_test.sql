begin;
create extension if not exists pgtap with schema extensions;

select no_plan();

-- The songbook walk is global: one refresh serves every room. Two hosts pressing
-- Refresh in the same minute each fetch the same four channels — about 16 units
-- apiece — so roughly 32 of the 40 daily units go on work that was already under
-- way. The six-hour per-channel throttle cannot help, because it only exempts a
-- walk that finished and stamped a cursor. These tests pin the lease that makes
-- it one walk at a time; the walk itself is server code.

select is(
  (public.karaoke_catalog_lease_take('walk-one') ->> 'acquired')::boolean,
  true,
  'the first caller takes the lease'
);

select is(
  (public.karaoke_catalog_lease_take('walk-two') ->> 'acquired')::boolean,
  false,
  'a second caller is refused while it is held'
);

select is(
  public.karaoke_catalog_lease_take('walk-two') ->> 'holder',
  'walk-one',
  'a refused take names the holder, so the client can say the songbook is already being refreshed'
);

select is(
  (public.karaoke_catalog_lease_take('walk-one') ->> 'acquired')::boolean,
  true,
  'the holder can take it again, which is how a walk resumed across requests renews its own lease'
);

select is(
  public.karaoke_catalog_lease_release('walk-two'),
  false,
  'a caller that does not hold the lease cannot release it'
);

select is(
  (select count(*) from public.karaoke_catalog_lease),
  1::bigint,
  'the lease is one row for the whole catalog, not one per room'
);

select throws_ok(
  $$insert into public.karaoke_catalog_lease (id, holder) values (2, 'walk-two')$$,
  '23514',
  null,
  'the singleton is enforced by a constraint, not by convention'
);

select is(
  public.karaoke_catalog_lease_release('walk-one'),
  true,
  'the holder releases the lease'
);

select is(
  (public.karaoke_catalog_lease_take('walk-two') ->> 'acquired')::boolean,
  true,
  'a released lease is free for the next caller'
);

-- A crashed process must not strand the songbook. The default ttl is four minutes,
-- far longer than the eight-second request budget, so a zero ttl here proves the
-- expiry is a real comparison against the clock rather than a stored column nobody
-- reads.
select is(
  (public.karaoke_catalog_lease_take('walk-stale', interval '0 seconds') ->> 'acquired')::boolean,
  true,
  'a caller claims the lease with a zero ttl'
);

select is(
  (public.karaoke_catalog_lease_take('walk-next', interval '0 seconds') ->> 'acquired')::boolean,
  true,
  'a lease past its ttl is stealable, so a dead walk cannot block refreshes for the day'
);

select is(
  has_table_privilege('anon', 'public.karaoke_catalog_lease', 'select'),
  false,
  'the lease table is not readable by anon'
);

select is(
  has_function_privilege('authenticated', 'public.karaoke_catalog_lease_take(text, interval)', 'execute'),
  false,
  'the lease is not executable by a browser role'
);

select * from finish();
rollback;
