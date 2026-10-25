# Karaoke Songbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every room a browsable, searchable catalog of karaoke-with-lyrics videos, opened from the Popular karaoke strip, where any song can be queued and played from YouTube.

**Architecture:** A Postgres catalog (`karaoke_catalog`) is filled by a host-triggered sync that reads karaoke channels' uploads playlists via `playlistItems.list` (1 quota unit per 50 songs). Browsing, filtering and paging are read-only database calls, so no YouTube quota is spent by visitors. Playback stays the existing YouTube embed.

**Tech Stack:** React 19 + Vite, react-router, Postgres 17 (Neon) with plpgsql functions, pgTAP, Vitest, Playwright (mocked `/api`).

**Spec:** `docs/superpowers/specs/2026-10-25-karaoke-songbook-design.md`

## Status (2026-10-25, second pass)

Tasks 1–6 are committed on `feature/songbook`, and the branch now carries the second batch below on
top of `8780c90`. It is **not pushed**; read the live gap with `git rev-list --count
origin/master..HEAD`. Pushing also carries the two local-only `master` commits (`9dc5396`,
`54b8478`) that were never shipped. Production Neon `main` is verified to be at 0030 with none of
the catalog or auto-advance functions, so **0031–0033 are still not applied**.

A second batch sat **uncommitted** in the working tree after Task 6 (55 modified files, 14
untracked, +1787/-231) and is now committed locally on this branch, starting at `4e4ac1b`. It is
beyond this plan; it hardened the surrounding features:

- `0032_playback_auto_advance_once.sql` + `playbackCommand` — an automatic advance passes
  `expectedSongId` and the database re-checks it under the room lock, so a replayed advance can
  never skip the following song.
- `0033_catalog_retention_and_rls.sql` + `server/operations/catalogRetention.ts` + the
  `vercel.json` cron — RLS on both catalog tables, a 28-day filter inside `karaoke_catalog_page`,
  and `karaoke_catalog_retire_stale()` on a daily `0 2 * * *` schedule.
- `youtube.ts` — search now falls back to fresh catalog entries when the key is absent or the
  budget is spent, and the upstream call asks for `videoEmbeddable=true&videoSyndicated=true`.
- `roomApi.ts` / `HomePage.tsx` — create/join responses are validated before their bearer tokens
  are stored, and an uncertain create warns instead of silently allowing a duplicate room.
- The app is branded **kara-echo** (`appName`, `index.html`, `README.md`, `public/llms.txt`) and
  `Referrer-Policy` moved to `strict-origin-when-cross-origin`.

Evidence on the current tree: `tsc` clean, unit 401/401, pgTAP 323/323 on the local container,
build passes, mocked e2e 15/15. The full 0001→0033 chain was also pushed to a disposable Neon
branch off production `main`, where pgTAP reported 323/323; that branch was deleted and
production `main` was confirmed unchanged afterwards.

**Live proof, and the bug it found (2026-10-25).** The loop was run end to end against a
disposable Neon branch off production `main`, with the real YouTube key, connecting as the
**runtime role**:

| Step | Result |
|---|---|
| `catalog-sync` | **409 songs** written from the four live channels; `unresolved: ["@karaoketv"]` |
| re-run inside 6h | `added 0, skipped 4` — the throttle, not a silent re-fetch |
| `catalog-page` | `total 409`, page of 5 — zero quota spent |
| filter `q=Nanghihinayang` | `total 1`, every title matches |
| channel chip `@vinylktv` | `total 105`, every row that channel |
| `queue-command add` | `status queued`, 201 |
| `playback-command play` | `currentSongId` = the queued song, `isPlaying true` |
| `next` with `expectedSongId` | first `advanced: true`, replay `advanced: false` — 0032's claim |

The first attempt returned **500 on every catalog call**, and no existing test could see it:
migrations 0031–0033 grant `execute` to `service_role`, but the app connects as `echo_service`,
whose surface was copied from `service_role` on 2026-10-25 — *before* those migrations existed.
pgTAP runs as the owner and grants are checked at call time, so 298 assertions stayed green while
the feature was unusable. Migration `0034_grant_catalog_to_runtime_role.sql` repairs it (guarded so
it still applies where `echo_service` does not exist, i.e. the local stack), and two gates now close
the class: `supabase/tests/role_grant_parity_test.sql` fails if any function or table reachable by
`service_role` is unreachable by `echo_service` (mutation-proven: revoking one grant turns it red),
and the integration suite — which *does* connect as the runtime role — now asserts the songbook
page answers 200.

That suite also exposed a stale assertion worth keeping: keyless `youtube-search` was expected to
report `available: false`, which passed on a fresh CI branch only because its catalog is empty. With
the songbook fallback in place the honest contract is both cases, so the test now seeds one catalog
row and asserts the cold answer *and* the `source: "songbook"` answer.

Task 7 is **not started** and has a prerequisite beyond the migration: `catalogRetentionCron`
refuses to run without `CRON_SECRET` (≥32 chars) and `npm run verify:deploy` demands it in
Production, but the Vercel Production environment **does not have it** — so the cron answers 503
and the build is rejected until the owner creates that secret. Commits, the push and the production
migration all need the owner's explicit approval.

Task 7's production step is unchanged in shape — create `CRON_SECRET`, apply 0031–0034 to
production `main`, push/deploy, seed once, prove on the live origin — and it is written out as an
ordered runbook in `docs/deployment/hosted-setup.md`, Step 9. The seeding risk is now quantified:
the catalog fills to roughly 400 rows per refresh from four channels for about 16 quota units, and it
only works as `echo_service` if 0034 ships with the rest.

One thing the task list missed: Tasks 4–5 shipped the warming-up message but never wired the
host-only Retry the spec requires, so nothing could call `catalog-sync`. That landed separately
in `0062146`.

**Channel handles, proven against a real key (2026-10-25).** The five `CATALOG_CHANNELS` entries
were never resolved before this tree shipped nothing. Resolved now, one `channels.list` unit each:

| Handle | Result |
|---|---|
| `@musisikaraoke` | resolves — uploads `UUJw1qyMF4m3ZIBWdhogkcsw` |
| `@singking` | resolves — uploads `UUiKvZMc7lApbIc9XCorhFfw` |
| `@vinylktv` | resolves — uploads `UUL8roECkxt33HMrH9hl01ww` |
| `@titojaymusic` | **did not exist.** Replaced by `@titojaymusicofficial`, uploads `UUyqXe9LxGxB8pRsbRMpIqSA` |
| `@karaoketv` | **did not exist** — `channels.list` returned zero items and `youtube.com/@karaoketv` is a 404 (control: a nonsense handle 404s too, `@musisikaraoke` 200s). **Removed by the owner on 2026-10-25**: the spec's "KaraokeTV" matched two different live channels (`@CARAokeTVOfficial`, `@KARAOKEZONETV`) and none of them was obviously intended, so the songbook ships on four verified channels rather than on a guess about whose videos a room sings from |

The spec named "KaraokeTV", and two live channels could be meant: `@CARAokeTVOfficial` ("CARAoke
TV") or `@KARAOKEZONETV` ("KARAOKE ZONE TV"). **This is the owner's choice, not a guess to make** —
it decides whose videos a room's songbook is built from. Until it is answered, `@karaoketv` is kept
in the list so the gap stays visible.

The silent-omission defect this exposed is fixed and stays fixed by the gate below, even though the
list is now clean: a handle that names no channel used to `continue` and the run still answered
`{ available: true, added, skipped }`, so a host could never tell a four-channel songbook from a
five-channel one. `catalog-sync` now returns `unresolved: []` and, when non-empty, says
"Songbook refresh could not find: …" — proven by mutation (removing the push fails exactly one test). Because the sync stores its cursor under the handle and `CATALOG_CHANNEL_LABELS`
filters by that same id, a drift gate (`tests/unit/catalogChannelContract.test.ts`) now pins the two
lists together; it was written after the two halves had already drifted apart once.

Also still owed from this class: a `channels.list` HTTP error (as opposed to a missing channel)
still `continue`s unreported, and a cursor whose channel later disappears is not re-checked.

## Global Constraints

- Playback is always the YouTube embed; never store or serve video. Catalog rows hold ids and display metadata only.
- Browsing, filtering and paging must cost **zero** YouTube quota.
- Sync is **host-token only**, capped at **12 units per run** (four channels × 3 pages — the spec's
  fifth channel had no live handle and the owner removed it on 2026-10-25) and **40 units/day** (`consume_daily_rate_limit('global','karaoke-catalog-day',40,…)`), no-ops if every channel synced within 6 hours, and aborts its loop after **8 seconds**.
- Every new SQL function: `security definer`, `set search_path = ''`, schema-qualified names, `revoke all … from public, anon, authenticated`, `grant execute … to service_role` **and to `echo_service`** — the app connects as `echo_service` since the 2026-10-25 credential rotation, and granting only `service_role` makes the feature 500 in production while every owner-run test stays green (see Status).
- Guest phone controls stay ≥44px and must not overflow at 200% text.
- The guest remote keeps exactly two bottom tabs (Search, Queue); the songbook is a screen with its own back link.
- Commits require the owner's explicit approval; batch the commit steps below when they give it. A push deploys production, so push only with approval.
- Do not change `youtube-search`, `youtube-suggest`, `youtube-popular` behaviour.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0031_karaoke_catalog.sql` | Tables, indexes, `karaoke_catalog_page`, `karaoke_catalog_upsert`, `karaoke_catalog_cursor_save`, `karaoke_catalog_cursors` |
| `supabase/tests/catalog_test.sql` | pgTAP: paging, filter, clamp, grants |
| `server/operations/catalogSync.ts` | Sync orchestration + pure helpers (`buildPlaylistUrl`, `mapPlaylistItems`, `readNextToken`) |
| `server/operations/catalogBrowse.ts` | `catalogPage` read operation |
| `server/operations/index.ts` | Register `catalog-sync`, `catalog-page` |
| `src/lib/edgeApi.ts` | Add both names to `EdgeFunctionName` |
| `src/features/catalog/catalogApi.ts` | Client `readCatalogPage`, `runCatalogSync`, `CatalogSong` type |
| `src/features/catalog/SongbookList.tsx` | Shared list: filter box, channel chips, load-more, Add button |
| `src/app/HostSongbookPage.tsx` | Host page wrapper (room context, queue add, refresh) |
| `src/app/GuestSongbook.tsx` | Guest screen (back to search) |
| `src/app/HostRoomPage.tsx` | Mount `HostSongbookPage` route |
| `src/app/GuestRoomPage.tsx` | Render the songbook screen at `/songbook` |
| `src/app/App.tsx` | Routes for host + guest songbook |
| `src/features/rooms/Sidebar.tsx` | "Songbook" nav item |
| `src/features/queue/PopularSongs.tsx` | "View more" link in the strip header |
| `tests/unit/catalogSync.test.ts` | Pure sync helpers + budget stop |
| `tests/unit/songbook.test.tsx` | Host page: filter, load more, add |
| `tests/e2e/ui-mock.spec.ts` | Strip → songbook → filter → add |

---

### Task 1: Catalog schema and read function

**Files:**
- Create: `supabase/migrations/0031_karaoke_catalog.sql`
- Test: `supabase/tests/catalog_test.sql`

**Interfaces:**
- Produces: `public.karaoke_catalog_page(p_query text, p_channel text, p_offset integer, p_limit integer) returns jsonb` → `{ "total": int, "items": [{ "videoId", "title", "channelTitle", "channelId", "thumbnailUrl", "publishedAt" }] }`
- Produces: `public.karaoke_catalog_upsert(p_channel_id text, p_items jsonb) returns integer`
- Produces: `public.karaoke_catalog_cursor_save(p_channel_id text, p_uploads_playlist_id text, p_page_token text, p_exhausted boolean) returns void`
- Produces: `public.karaoke_catalog_cursors() returns jsonb` → `[{ "channelId", "uploadsPlaylistId", "nextPageToken", "exhaustedAt", "lastSyncedAt" }]`

- [x] **Step 1: Write the failing pgTAP test**

Create `supabase/tests/catalog_test.sql`:

```sql
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
  public.karaoke_catalog_page('', '', 0, 30) -> 'items' -> 0 ->> 'thumbnailUrl',
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
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx supabase db push && npm run test:db`
Expected: FAIL — `function public.karaoke_catalog_page(text, text, integer, integer) does not exist`.

The local container is only a portable Postgres harness; production is Neon. CI re-runs this
same suite against a disposable Neon branch (`supabase test db --db-url "$NEON_DATABASE_URL"`),
and that run is the authoritative Neon proof.

- [x] **Step 3: Write the migration**

Create `supabase/migrations/0031_karaoke_catalog.sql`:

```sql
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
```

- [x] **Step 4: Run the suite and confirm it passes**

Run: `npx supabase db push && npm run test:db`
Expected: `catalog_test.sql ... ok`, all other files still pass. CI repeats this on a Neon branch.

- [x] **Step 5: Commit** (only with the owner's approval)

```bash
git add supabase/migrations/0031_karaoke_catalog.sql supabase/tests/catalog_test.sql
git commit -m "feat: add the karaoke catalog schema and paging function"
```

---

### Task 2: Sync helpers and orchestration

**Files:**
- Create: `server/operations/catalogSync.ts`
- Test: `tests/unit/catalogSync.test.ts`

**Interfaces:**
- Produces: `CATALOG_CHANNELS: string[]`
- Produces: `mapPlaylistItems(payload: unknown): CatalogRow[]` where `CatalogRow = { videoId: string; title: string; channelTitle: string | null; thumbnailUrl: string | null; publishedAt: string | null }`
- Produces: `readNextToken(payload: unknown): string | null`
- Produces: `catalogSync(request: Request, caller: Caller): Promise<Response>`

- [x] **Step 1: Write the failing unit test**

Create `tests/unit/catalogSync.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapPlaylistItems, readNextToken } from '../../server/operations/catalogSync';

const page = {
  nextPageToken: 'TOKEN2',
  items: [
    {
      snippet: {
        title: 'Halo &amp; Friends - Karaoke',
        channelTitle: 'Musisi Karaoke',
        publishedAt: '2025-01-02T00:00:00Z',
        thumbnails: { medium: { url: 'https://i.ytimg.com/medium.jpg' } },
      },
      contentDetails: { videoId: 'aaaaaaaaaaa' },
    },
    // Private or deleted videos come back without contentDetails.
    { snippet: { title: 'Ghost entry', channelTitle: 'X' } },
    // A malformed id must be dropped rather than written.
    { snippet: { title: 'Bad id' }, contentDetails: { videoId: 'short' } },
    { snippet: { title: '   ' }, contentDetails: { videoId: 'bbbbbbbbbbb' } },
  ],
};

describe('catalog sync helpers', () => {
  it('maps a playlist page and drops unusable entries', () => {
    expect(mapPlaylistItems(page)).toEqual([
      {
        videoId: 'aaaaaaaaaaa',
        title: 'Halo & Friends - Karaoke',
        channelTitle: 'Musisi Karaoke',
        thumbnailUrl: 'https://i.ytimg.com/medium.jpg',
        publishedAt: '2025-01-02T00:00:00Z',
      },
    ]);
  });

  it('returns the next page token only when it is a string', () => {
    expect(readNextToken(page)).toBe('TOKEN2');
    expect(readNextToken({ items: [] })).toBeNull();
    expect(readNextToken(null)).toBeNull();
    expect(readNextToken({ nextPageToken: 42 })).toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/catalogSync.test.ts`
Expected: FAIL — cannot resolve `mapPlaylistItems`.

- [x] **Step 3: Implement the module**

Create `server/operations/catalogSync.ts`:

```ts
import { HttpError, jsonResponse } from './errors.js';
import { readJsonObject } from './tokens.js';
import { requireRoomId, type Caller } from './room.js';
import { operationCall, serviceDatabase } from '../db/client.js';
import { requireHostAccess } from './catalogAccess.js';

export type CatalogRow = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
};

export const CATALOG_CHANNELS = [
  '@musisikaraoke',
  '@singking',
  '@karaoketv',
  '@vinylktv',
  '@titojaymusic',
];

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const MAX_PAGES_PER_CHANNEL = 3;
const PAGE_SIZE = 50;
const DAILY_UNIT_CAP = 40;
const THROTTLE_MS = 6 * 60 * 60 * 1000;
const TIME_BUDGET_MS = 8000;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function paragraph(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? decodeEntities(value.trim()).slice(0, limit)
    : null;
}

export function mapPlaylistItems(payload: unknown): CatalogRow[] {
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const rows: CatalogRow[] = [];
  for (const raw of items) {
    const item = raw as {
      snippet?: { title?: unknown; channelTitle?: unknown; publishedAt?: unknown; thumbnails?: Record<string, { url?: unknown }> };
      contentDetails?: { videoId?: unknown };
    };
    const videoId = item.contentDetails?.videoId;
    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) continue;
    const title = paragraph(item.snippet?.title, 500);
    if (title === null) continue;
    const thumbs = item.snippet?.thumbnails ?? {};
    const thumb = thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url;
    rows.push({
      videoId,
      title,
      channelTitle: paragraph(item.snippet?.channelTitle, 120),
      thumbnailUrl: typeof thumb === 'string' ? thumb : null,
      publishedAt: typeof item.snippet?.publishedAt === 'string' ? item.snippet.publishedAt : null,
    });
  }
  return rows;
}

export function readNextToken(payload: unknown): string | null {
  const token = (payload as { nextPageToken?: unknown } | null)?.nextPageToken;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

function playlistUrl(playlistId: string, pageToken: string | null, apiKey: string): string {
  const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
  url.searchParams.set('part', 'snippet,contentDetails');
  url.searchParams.set('maxResults', String(PAGE_SIZE));
  url.searchParams.set('playlistId', playlistId);
  if (pageToken !== null) url.searchParams.set('pageToken', pageToken);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

function channelUrl(handle: string, apiKey: string): string {
  const url = new URL('https://www.googleapis.com/youtube/v3/channels');
  url.searchParams.set('part', 'contentDetails');
  url.searchParams.set('forHandle', handle);
  url.searchParams.set('key', apiKey);
  return url.toString();
}

type Cursor = {
  channelId: string;
  uploadsPlaylistId: string;
  nextPageToken: string | null;
  exhaustedAt: string | null;
  lastSyncedAt: string | null;
};

async function queryAllowNull(name: string, params: unknown[]): Promise<unknown> {
  try {
    const call = operationCall(name, params);
    const rows = await serviceDatabase().query(call.text, call.params);
    return (rows[0] as { result?: unknown } | undefined)?.result ?? null;
  } catch {
    return null;
  }
}

async function loadCursors(): Promise<Cursor[]> {
  const call = operationCall('karaoke_catalog_cursors', []);
  const rows = await serviceDatabase().query(call.text, call.params);
  return ((rows[0] as { result?: Cursor[] } | undefined)?.result ?? []) as Cursor[];
}

async function saveCursor(
  channelId: string,
  playlistId: string,
  token: string | null,
  exhausted: boolean,
): Promise<void> {
  const call = operationCall('karaoke_catalog_cursor_save', [channelId, playlistId, token, exhausted]);
  await serviceDatabase().query(call.text, call.params);
}

async function upsertRows(channelId: string, rows: CatalogRow[]): Promise<void> {
  if (rows.length === 0) return;
  const call = operationCall('karaoke_catalog_upsert', [channelId, JSON.stringify(rows)]);
  await serviceDatabase().query(call.text, call.params);
}

export async function catalogSync(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  const hostToken = request.headers.get('x-room-host-token');
  if (hostToken === null || hostToken.length === 0) {
    throw new HttpError('FORBIDDEN', 403, 'Only the host can refresh the songbook');
  }
  // Reuse the room-bound check the other operations use.
  await requireHostAccess(caller, roomId, hostToken);

  const apiKey = process.env.YOUTUBE_API_KEY ?? '';
  if (apiKey.length === 0) {
    return jsonResponse({ available: false, added: 0, message: 'YouTube is not configured' });
  }

  const started = Date.now();
  const cursors = await loadCursors();
  const byChannel = new Map(cursors.map((row) => [row.channelId, row]));
  let added = 0;
  let skipped = 0;

  for (const handle of CATALOG_CHANNELS) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    let cursor = byChannel.get(handle);
    if (cursor !== undefined && cursor.lastSyncedAt !== null
      && Date.now() - Date.parse(cursor.lastSyncedAt) < THROTTLE_MS) {
      skipped += 1;
      continue;
    }

    let playlistId = cursor?.uploadsPlaylistId ?? null;
    if (playlistId === null) {
      const spent = await queryAllowNull('consume_daily_rate_limit', ['global', 'karaoke-catalog-day', DAILY_UNIT_CAP]);
      if ((spent as { allowed?: boolean } | null)?.allowed !== true) break;
      const response = await fetch(channelUrl(handle, apiKey), { signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const payload = await response.json();
      const items = (payload as { items?: { contentDetails?: { relatedPlaylists?: { uploads?: unknown } } }[] }).items ?? [];
      const uploads = items[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (typeof uploads !== 'string') continue;
      playlistId = uploads;
      await saveCursor(handle, playlistId, null, false);
    }

    let token = cursor?.nextPageToken ?? null;
    for (let page = 0; page < MAX_PAGES_PER_CHANNEL; page += 1) {
      if (Date.now() - started > TIME_BUDGET_MS) break;
      const spent = await queryAllowNull('consume_daily_rate_limit', ['global', 'karaoke-catalog-day', DAILY_UNIT_CAP]);
      if ((spent as { allowed?: boolean } | null)?.allowed !== true) {
        return jsonResponse({ available: true, added, skipped, message: 'Songbook refresh paused for today' });
      }
      const response = await fetch(playlistUrl(playlistId, token, apiKey), { signal: AbortSignal.timeout(5000) });
      if (!response.ok) break;
      const payload = await response.json();
      const rows = mapPlaylistItems(payload);
      await upsertRows(handle, rows);
      added += rows.length;
      const next = readNextToken(payload);
      await saveCursor(handle, playlistId, next, next === null);
      if (next === null) break;
      token = next;
    }
  }

  return jsonResponse({ available: true, added, skipped });
}
```

The catalog stores the channel **handle** (`@musisikaraoke`) as `channel_id`, so the read
function's `p_channel` filter and the client chips use handles; display names come from the
label map below.

- [x] **Step 4: Add the shared access guard**

Create `server/operations/catalogAccess.ts`, moving the existing `requireRoomAccess` body out of `youtube.ts` so both modules share one implementation:

```ts
import { HttpError, UNAUTHORIZED_MESSAGE } from './errors.js';
import { operationCall, serviceDatabase } from '../db/client.js';
import { optionalTokenHeader, type Caller } from './room.js';

async function check(name: string, params: unknown[]): Promise<{ status?: string } | null> {
  const call = operationCall(name, params);
  const rows = await serviceDatabase().query(call.text, call.params);
  return (rows[0] as { result?: { status?: string } } | undefined)?.result ?? null;
}

export async function requireHostAccess(caller: Caller, roomId: string, hostToken: string): Promise<void> {
  const access = await check('host_access_check', [roomId, caller.userId, hostToken]);
  if (access === null) throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
  if (access.status === 'ended') throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
}

export async function requireRoomAccess(request: Request, caller: Caller, roomId: string): Promise<string> {
  const guestToken = optionalTokenHeader(request, 'x-room-guest-token');
  const hostToken = optionalTokenHeader(request, 'x-room-host-token');
  if (guestToken !== null) {
    const access = await check('room_access_check', [roomId, caller.userId, guestToken]);
    if (access === null) throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
    if (access.status === 'ended') throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
    return guestToken;
  }
  if (hostToken !== null) {
    const access = await check('host_access_check', [roomId, caller.userId, hostToken]);
    if (access === null) throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
    if (access.status === 'ended') throw new HttpError('ROOM_ENDED', 409, 'This room has ended');
    return hostToken;
  }
  throw new HttpError('UNAUTHORIZED', 401, UNAUTHORIZED_MESSAGE);
}
```

Then in `server/operations/youtube.ts` replace the local `requireRoomAccess` with `import { requireRoomAccess } from './catalogAccess.js';` and delete the local copy. Import `catalogSync`'s guard from the same file rather than the dynamic import shown above:
`import { requireHostAccess } from './catalogAccess.js';` at the top of `catalogSync.ts`.

- [x] **Step 5: Run the unit test and the whole suite**

Run: `npx vitest run tests/unit/catalogSync.test.ts && npx tsc --noEmit && npm test`
Expected: 2 new tests pass, `tsc` clean, 50 files pass (plus the new file).

- [x] **Step 6: Commit** (only with the owner's approval)

```bash
git add server/operations/catalogSync.ts server/operations/catalogAccess.ts server/operations/youtube.ts tests/unit/catalogSync.test.ts
git commit -m "feat: sync karaoke channels into the catalog"
```

---

### Task 3: Read operation and registration

**Files:**
- Create: `server/operations/catalogBrowse.ts`
- Modify: `server/operations/index.ts` (OPERATIONS set + switch)
- Modify: `src/lib/edgeApi.ts:1-15` (`EdgeFunctionName`)

**Interfaces:**
- Consumes: `requireRoomAccess` from `./catalogAccess.js`; `karaoke_catalog_page`
- Produces: `catalogPage(request: Request, caller: Caller): Promise<Response>` → `{ total, items }`
- Produces: `'catalog-page'` and `'catalog-sync'` accepted by the router and typed on the client

- [x] **Step 1: Implement the read operation**

Create `server/operations/catalogBrowse.ts`:

```ts
import { operationCall, serviceDatabase } from '../db/client.js';
import { HttpError, jsonResponse, mapDatabaseError } from './errors.js';
import { readJsonObject } from './tokens.js';
import { requireRoomId, type Caller } from './room.js';
import { requireRoomAccess } from './catalogAccess.js';

export async function catalogPage(request: Request, caller: Caller): Promise<Response> {
  const body = await readJsonObject(request);
  const roomId = requireRoomId(body.roomId);
  await requireRoomAccess(request, caller, roomId);

  const query = typeof body.query === 'string' ? body.query.slice(0, 80) : '';
  const channel = typeof body.channel === 'string' ? body.channel.slice(0, 80) : '';
  const offset = Number.isInteger(body.offset) ? (body.offset as number) : 0;
  const limit = Number.isInteger(body.limit) ? (body.limit as number) : 30;

  try {
    const call = operationCall('karaoke_catalog_page', [query, channel, offset, limit]);
    const rows = await serviceDatabase().query(call.text, call.params);
    const result = (rows[0] as { result?: unknown } | undefined)?.result;
    if (result === undefined || result === null) {
      throw new HttpError('INTERNAL_ERROR', 500, 'The songbook returned no result');
    }
    return jsonResponse(result);
  } catch (error) {
    throw mapDatabaseError(error as { message?: string });
  }
}
```

- [x] **Step 2: Register both operations**

In `server/operations/index.ts`: add `import { catalogPage } from './catalogBrowse.js';` and `import { catalogSync } from './catalogSync.js';`, add `'catalog-page'` and `'catalog-sync'` to the `OPERATIONS` set, and add both cases to the switch:

```ts
      case 'catalog-page':
        return await catalogPage(request, caller);
      case 'catalog-sync':
        return await catalogSync(request, caller);
```

- [x] **Step 3: Type them on the client**

In `src/lib/edgeApi.ts`, extend the union:

```ts
  | 'youtube-popular'
  | 'catalog-page'
  | 'catalog-sync'
```

- [x] **Step 4: Prove the router accepts them**

Run: `npm run build`
Expected: `tsc --noEmit` clean and the Vite build succeeds.

- [x] **Step 5: Commit** (only with the owner's approval)

```bash
git add server/operations/catalogBrowse.ts server/operations/index.ts src/lib/edgeApi.ts
git commit -m "feat: expose the songbook read and sync operations"
```

---

### Task 4: Client API, shared list, and the host page

**Files:**
- Create: `src/features/catalog/catalogApi.ts`
- Create: `src/features/catalog/SongbookList.tsx`
- Create: `src/app/HostSongbookPage.tsx`
- Modify: `src/app/App.tsx` (host child route), `src/features/rooms/Sidebar.tsx` (nav item)
- Test: `tests/unit/songbook.test.tsx`

**Interfaces:**
- Produces: `type CatalogSong = { videoId: string; title: string; channelTitle: string | null; thumbnailUrl: string | null; publishedAt: string | null }`
- Produces: `readCatalogPage(api, roomId, params): Promise<{ total: number; items: CatalogSong[] }>`
- Produces: `<SongbookList api roomId onAdded />`

- [x] **Step 1: Write the failing test**

Create `tests/unit/songbook.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SongbookList from '../../src/features/catalog/SongbookList';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

function catalogPage() {
  const songs = Array.from({ length: 30 }, (_, index) => ({
    videoId: 'video' + String(index).padStart(6, '0'),
    title: (index === 0 ? 'Halo - Beyonce' : 'Song ' + index) + ' (Karaoke)',
    channelTitle: 'Musisi Karaoke',
    thumbnailUrl: null,
    publishedAt: '2025-01-02T00:00:00Z',
  }));
  return { total: 61, items: songs };
}

function makeApi() {
  const calls: Array<{ name: string; body: unknown }> = [];
  const api = {
    invoke: (async (name: string, body: unknown) => {
      calls.push({ name, body });
      if (name === 'catalog-page') {
        const offset = (body as { offset?: number }).offset ?? 0;
        const page = catalogPage();
        return { total: page.total, items: offset === 0 ? page.items : page.items.slice(0, 31 - 30) };
      }
      return { ok: true };
    }) as unknown as EdgeApi['invoke'],
  };
  return { api, calls };
}

afterEach(cleanup);

describe('songbook list', () => {
  it('filters, pages, and queues a song', async () => {
    const { api, calls } = makeApi();
    render(<SongbookList api={api} roomId={roomId} />);

    expect(await screen.findByText('Halo - Beyonce (Karaoke)')).toBeInTheDocument();
    expect(screen.getByText(/61 songs/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/search the songbook/i), { target: { value: 'halo' } });
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-page'
        && (call.body as { query?: string }).query === 'halo')).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-page'
        && (call.body as { offset?: number }).offset === 30)).toBe(true);
    });

    fireEvent.click(screen.getAllByRole('button', { name: /add halo/i })[0]);
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'queue-command')).toBe(true);
    });
  });
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/songbook.test.tsx`
Expected: FAIL — cannot resolve `SongbookList`.

- [x] **Step 3: Implement the client API**

Create `src/features/catalog/catalogApi.ts`:

```ts
import type { EdgeApi } from '../../lib/edgeApi';
import { loadGuestToken, loadHostToken } from '../rooms/tokenStore';
import { addSong } from '../queue/queueApi';

export type CatalogSong = {
  videoId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
};

export type CatalogPage = { total: number; items: CatalogSong[] };

export const CATALOG_CHANNEL_LABELS: { id: string; label: string }[] = [
  { id: '@musisikaraoke', label: 'Musisi Karaoke' },
  { id: '@singking', label: 'Sing King' },
  { id: '@karaoketv', label: 'KaraokeTV' },
  { id: '@vinylktv', label: 'Vinyl KTV' },
  { id: '@titojaymusic', label: 'Tito Jay' },
];

function tokensFor(roomId: string): { hostToken?: string; guestToken?: string } {
  const hostToken = loadHostToken(roomId);
  if (hostToken !== null) return { hostToken };
  const guestToken = loadGuestToken(roomId);
  return guestToken === null ? {} : { guestToken };
}

export async function readCatalogPage(
  api: EdgeApi,
  roomId: string,
  params: { query?: string; channel?: string; offset?: number; limit?: number } = {},
): Promise<CatalogPage> {
  return api.invoke<CatalogPage>('catalog-page', {
    roomId,
    query: params.query ?? '',
    channel: params.channel ?? '',
    offset: params.offset ?? 0,
    limit: params.limit ?? 30,
  }, tokensFor(roomId));
}

export async function queueCatalogSong(api: EdgeApi, roomId: string, videoId: string): Promise<void> {
  await addSong(api, roomId, videoId);
}
```

- [x] **Step 4: Implement the shared list**

Create `src/features/catalog/SongbookList.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import type { EdgeApi } from '../../lib/edgeApi';
import { queueCatalogSong, readCatalogPage, type CatalogSong } from './catalogApi';
import { SongArtwork } from '../../ui';

const PAGE_SIZE = 30;

export default function SongbookList({ api, roomId, onAdded }: {
  api: EdgeApi;
  roomId: string;
  onAdded?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [channel, setChannel] = useState('');
  const [items, setItems] = useState<CatalogSong[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextOffset: number, reset: boolean): Promise<void> => {
    setBusy(true);
    try {
      const page = await readCatalogPage(api, roomId, { query, channel, offset: nextOffset, limit: PAGE_SIZE });
      setTotal(page.total);
      setOffset(nextOffset);
      setItems((current) => (reset ? page.items : [...current, ...page.items]));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The songbook could not load.');
    } finally {
      setBusy(false);
    }
  }, [api, channel, query, roomId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(0, true); }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function add(song: CatalogSong): Promise<void> {
    setAdding(song.videoId);
    try {
      await queueCatalogSong(api, roomId, song.videoId);
      setAdded((current) => [...current, song.videoId]);
      onAdded?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That song could not be added.');
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Search the songbook</span>
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute left-3 text-ink-3" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or artist"
            className="min-h-11 w-full rounded-media border border-line bg-surface pl-9 pr-3 text-[0.8125rem] text-ink placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          />
        </label>
        <p className="text-[0.6875rem] text-ink-2">{total} songs</p>
      </div>

      {error === null ? null : <p role="alert" className="text-[0.75rem] text-danger">{error}</p>}

      {items.length === 0 && busy === false ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-6 text-center text-[0.8125rem] text-ink-2">
          The songbook is warming up. {total === 0 ? 'Ask the host to refresh it.' : 'No song matches that search.'}
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Songbook songs">
          {items.map((song) => {
            const isAdded = added.includes(song.videoId);
            return (
              <li key={song.videoId}>
                <div className="flex items-center gap-3 rounded-panel border border-line bg-surface p-2">
                  <SongArtwork src={song.thumbnailUrl} className="h-12 w-16 shrink-0" iconSize={16} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.8125rem] font-semibold text-ink">{song.title}</p>
                    <p className="truncate text-[0.6875rem] text-ink-2">{song.channelTitle ?? 'YouTube'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void add(song)}
                    disabled={isAdded || adding !== null}
                    aria-label={isAdded ? song.title + ' is already queued' : 'Add ' + song.title}
                    className="grid size-11 shrink-0 place-items-center rounded-full border border-line text-ink transition-[background-color,color,transform,scale] active:scale-95 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-45"
                  >
                    <PlusIcon size={15} weight="bold" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {items.length < total ? (
        <button
          type="button"
          onClick={() => void load(offset + PAGE_SIZE, false)}
          disabled={busy}
          className="min-h-11 rounded-media border border-line bg-surface text-[0.8125rem] font-semibold text-ink transition-colors hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
```

(The channel chips come in Task 5 together with the guest screen, so this task stays reviewable on its own.)

- [x] **Step 5: Run the test**

Run: `npx vitest run tests/unit/songbook.test.tsx`
Expected: PASS.

- [x] **Step 6: Add the host page and route**

Create `src/app/HostSongbookPage.tsx`:

```tsx
import SongbookList from '../features/catalog/SongbookList';
import { CATALOG_CHANNEL_LABELS } from '../features/catalog/catalogApi';
import { useRoomApi } from './RoomApiProvider';
import { useHostRoom } from './useHostRoom';

export default function HostSongbookPage() {
  const api = useRoomApi();
  const { roomId, refresh } = useHostRoom();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="eyebrow text-gold">Powered by YouTube</p>
        <h2 className="mt-1 font-display text-[1.6rem] font-bold tracking-[-0.02em] text-ink">Karaoke songbook</h2>
        <p className="mt-1 text-[0.8125rem] text-ink-2">With lyrics, ready to queue. Songs play from YouTube.</p>
      </div>
      <SongbookList api={api} roomId={roomId} channels={CATALOG_CHANNEL_LABELS} onAdded={() => { void refresh(); }} />
    </div>
  );
}
```

In `src/app/App.tsx`, inside the `/room/:roomId/host` route block add:

```tsx
            <Route path="songbook" element={<HostSongbookPage />} />
```

with the matching import.

In `src/features/rooms/Sidebar.tsx`, add to `NavItem`-driven lists a `{ key: 'songbook', label: 'Songbook', href: '/songbook', icon: MusicNotesIcon }` entry and map `key === 'songbook'` in `hrefFor` to `'/room/' + activeRoom.roomId + '/host/songbook'`; return `'songbook'` from `navFor` in `HostRoomPage.tsx` for paths ending `/host/songbook`.

- [x] **Step 7: Run the suites**

Run: `npx tsc --noEmit && npm test`
Expected: clean, all files pass.

- [x] **Step 8: Commit** (only with the owner's approval)

```bash
git add src/features/catalog src/app/HostSongbookPage.tsx src/app/App.tsx src/app/HostRoomPage.tsx src/features/rooms/Sidebar.tsx tests/unit/songbook.test.tsx
git commit -m "feat: add the host songbook page"
```

---

### Task 5: Guest screen, channel chips, strip entry

**Files:**
- Create: `src/app/GuestSongbook.tsx`
- Modify: `src/app/GuestRoomPage.tsx` (render at `/songbook`), `src/app/App.tsx` (guest route)
- Modify: `src/features/catalog/SongbookList.tsx` (channel chips)
- Modify: `src/features/queue/PopularSongs.tsx` (View more)
- Test: extend `tests/unit/songbook.test.tsx`

**Interfaces:**
- Consumes: `SongbookList`, `readCatalogPage`
- Produces: route `/room/:roomId/songbook` rendering `GuestSongbook`
- Produces: `PopularSongs` prop `moreHref?: string`

- [x] **Step 1: Extend the failing test for chips and the guest screen**

Append to `tests/unit/songbook.test.tsx`:

```tsx
  it('narrows by channel chip', async () => {
    const { api, calls } = makeApi();
    render(<SongbookList api={api} roomId={roomId} channels={[{ id: 'UC_sing', label: 'Sing King' }]} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sing King' }));
    await waitFor(() => {
      expect(calls.some((call) => call.name === 'catalog-page'
        && (call.body as { channel?: string }).channel === 'UC_sing')).toBe(true);
    });
  });
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/songbook.test.tsx`
Expected: FAIL — no `channels` prop / no chip.

- [x] **Step 3: Add channel chips**

In `SongbookList.tsx`, accept `channels?: { id: string; label: string }[]` and render, under the search row:

```tsx
      {channels === undefined || channels.length === 0 ? null : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setChannel('')}
            aria-pressed={channel === ''}
            className={['min-h-9 rounded-pill border px-3 text-[0.6875rem] font-semibold transition-colors',
              channel === '' ? 'border-signal/40 bg-signal-soft text-signal' : 'border-line bg-surface text-ink-2 hover:text-ink'].join(' ')}
          >
            All
          </button>
          {channels.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setChannel(entry.id)}
              aria-pressed={channel === entry.id}
              className={['min-h-9 rounded-pill border px-3 text-[0.6875rem] font-semibold transition-colors',
                channel === entry.id ? 'border-signal/40 bg-signal-soft text-signal' : 'border-line bg-surface text-ink-2 hover:text-ink'].join(' ')}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
```

- [x] **Step 4: Add the guest screen**

Create `src/app/GuestSongbook.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowLeft';
import SongbookList from '../features/catalog/SongbookList';
import { CATALOG_CHANNEL_LABELS } from '../features/catalog/catalogApi';
import { useRoomApi } from './RoomApiProvider';

export default function GuestSongbook({ roomId, onAdded }: {
  roomId: string;
  onAdded?: () => void;
}) {
  const api = useRoomApi();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Link
          to={'/room/' + roomId + '/search'}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-media px-2 text-[0.75rem] font-semibold text-ink-2 hover:text-ink"
        >
          <ArrowLeftIcon size={15} aria-hidden="true" />
          Search
        </Link>
      </div>
      <div>
        <p className="eyebrow text-gold">Powered by YouTube</p>
        <h2 className="mt-1 font-display text-[1.4rem] font-bold tracking-[-0.02em] text-ink">Karaoke songbook</h2>
      </div>
      <SongbookList api={api} roomId={roomId} channels={CATALOG_CHANNEL_LABELS} onAdded={onAdded} />
    </div>
  );
}
```

- [x] **Step 5: Route the guest screen and keep two tabs**

In `src/app/App.tsx` add:

```tsx
          <Route path="/room/:roomId/songbook" element={<GuestRoomRoute />} />
```

In `src/app/GuestRoomPage.tsx`, add near the existing tab derivation:

```tsx
  const songbook = location.pathname.endsWith('/songbook');
```

and render `<GuestSongbook roomId={roomId} onAdded={() => { void refresh(); }} />` in place of the search/queue body when `songbook` is true, keeping `BottomNav` mounted so both tabs stay reachable. `useGuestTab()` must keep returning `'search' | 'queue'` only.

- [x] **Step 6: Add "View more" to the strip**

In `src/features/queue/PopularSongs.tsx`, extend the props with `moreHref?: string` and change the header row:

```tsx
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow text-ink-2">Popular karaoke</p>
        {moreHref === undefined ? (
          <p className="text-[0.625rem] text-ink-3">With lyrics</p>
        ) : (
          <Link to={moreHref} className="inline-flex min-h-9 items-center text-[0.6875rem] font-semibold text-signal hover:underline">
            View more
          </Link>
        )}
      </div>
```

Pass `moreHref={'/room/' + roomId + '/host/songbook'}` from `HostDiscoverPage` and `moreHref={'/room/' + roomId + '/songbook'}` from the guest search screen.

- [x] **Step 7: Run the suites**

Run: `npx tsc --noEmit && npx vitest run tests/unit/songbook.test.tsx && npm test`
Expected: clean and green.

- [x] **Step 8: Commit** (only with the owner's approval)

```bash
git add src/app/GuestSongbook.tsx src/app/GuestRoomPage.tsx src/app/App.tsx src/features/catalog/SongbookList.tsx src/features/queue/PopularSongs.tsx src/app/HostDiscoverPage.tsx tests/unit/songbook.test.tsx
git commit -m "feat: open the songbook from the karaoke strip on both screens"
```

---

### Task 6: Mocked end-to-end proof

**Files:**
- Modify: `tests/e2e/ui-mock.spec.ts`

**Interfaces:**
- Consumes: mocked `catalog-page`, `queue-command`

- [x] **Step 1: Write the failing e2e test**

Add to `tests/e2e/ui-mock.spec.ts`, and extend `mockApi` with a `catalog-page` branch returning `{ total: 31, items: [...30 entries...] }`:

```ts
test('host opens the songbook from the karaoke strip and queues a song', async ({ page }) => {
  const commands: Array<{ action?: string }> = [];
  await mockApi(page, true, commands);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/room/' + ROOM + '/host', { waitUntil: 'networkidle' });

  await page.getByRole('link', { name: 'View more' }).click();
  await expect(page).toHaveURL(new RegExp('/host/songbook$'));
  await expect(page.getByRole('heading', { name: 'Karaoke songbook' })).toBeVisible();

  await page.getByLabel('Search the songbook').fill('halo');
  await expect(page.getByText('Halo - Beyonce (Karaoke)')).toBeVisible();

  await page.getByRole('button', { name: 'Add Halo - Beyonce (Karaoke)' }).click();
  await expect.poll(() => commands.filter((command) => command.action === 'add').length).toBe(1);
});
```

- [x] **Step 2: Run it and watch it fail**

Run: `npx playwright test --config playwright.ui.config.ts -g "opens the songbook"`
Expected: FAIL at the missing "View more" link.

- [x] **Step 3: Implement the mock branch**

In `mockApi`, before the generic fallback:

```ts
    else if (path.endsWith('/api/catalog-page')) {
      const items = Array.from({ length: 30 }, (_, index) => ({
        videoId: 'video' + String(index).padStart(6, '0'),
        title: index === 0 ? 'Halo - Beyonce (Karaoke)' : 'Song ' + index + ' (Karaoke)',
        channelTitle: 'Musisi Karaoke',
        thumbnailUrl: null,
        publishedAt: '2025-01-02T00:00:00Z',
      }));
      body = { total: 31, items: (route.request().postDataJSON() as { query?: string }).query === 'halo' ? items.slice(0, 1) : items };
    }
```

- [x] **Step 4: Run the whole mocked suite**

Run: `npx playwright test --config playwright.ui.config.ts`
Expected: 9 passed.

- [x] **Step 5: Commit** (only with the owner's approval)

```bash
git add tests/e2e/ui-mock.spec.ts
git commit -m "test: prove the songbook opens from the strip and queues a song"
```

---

### Task 7: Ship, seed, verify

**Files:** none (operational)

- [ ] **Step 1: Apply migration 0031 to production**

Apply `supabase/migrations/0031_karaoke_catalog.sql` to Neon `main` the same way 0025–0030 were applied (guarded script that reads the owner URL from `server/.env.neon`, refuses any host that is not `ep-long-leaf-*`, one transaction, inserts the tracker row).

- [ ] **Step 2: Deploy**

Push with the owner's approval (GitHub → Vercel deploy), then run `npm run verify:preview -- https://echo-karaoke-mocha.vercel.app`.

- [ ] **Step 3: Seed the catalog once**

From the host screen, open the songbook and press Retry (host-only `catalog-sync`). Confirm the response reports a non-zero `added` and that the page fills, or call it directly:

```bash
curl -s -X POST https://echo-karaoke-mocha.vercel.app/api/catalog-sync \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -H "x-room-host-token: $HOST_TOKEN" -H "origin: https://echo-karaoke-mocha.vercel.app" \
  -d '{"roomId":"<room>"}'
```

- [ ] **Step 4: Prove the loop**

Add a song from the songbook on the host screen, confirm it lands in the queue and starts playing on the host, and confirm the guest phone shows it.

- [ ] **Step 5: Record the outcome**

Note in `docs/superpowers/specs/2026-10-25-karaoke-songbook-design.md` how many rows the first sync produced and which channels resolved, so a later session knows the real depth.

---

## Self-review

**Spec coverage:** data tables, read function, sync (channels, cursor, budget, throttle, 8s abort), host page, guest screen, strip entry, chips, paging, empty/warming states, tests, rollout — each maps to a task above.

**Placeholder scan:** no TBD/TODO; every code step carries real code; the only "similar to" marker is explicitly forbidden.

**Type consistency:** `CatalogSong` / `CatalogPage` names are used identically in Tasks 4–6; `catalog-page` and `catalog-sync` operation names match the router, the client union, and the mocks; `karaoke_catalog_page` argument order matches the SQL and the operation.
