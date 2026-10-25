# Karaoke Songbook — design

2026-10-25

## Goal

Give every room a browsable songbook of karaoke-with-lyrics videos beyond the eight
random picks in the Popular karaoke strip. "View more" on that strip opens a room-scoped
Songbook for the host and for guests, where they can filter thousands of tracks and add
any of them to the queue.

## What this is not

- We never upload, host, or re-encode video. Every song plays as the normal YouTube
  embed; the catalog stores only ids and display metadata.
- Browsing never calls YouTube. Search quota stays reserved for the search box, suggest,
  and the karaoke strip.

## Data (migration 0031)

`public.karaoke_catalog`

| column | type | notes |
|---|---|---|
| video_id | text primary key | YouTube id, the identity of the song |
| title | text not null | |
| channel_title | text not null | karaoke label, shown as the artist line |
| channel_id | text not null | source channel |
| thumbnail_url | text | |
| published_at | timestamptz | ordering |
| synced_at | timestamptz not null default now() | |

Index: `karaoke_catalog_title_lower_idx` on `lower(title)`. Secondary index on `channel_id`.

`public.karaoke_catalog_cursor`

| column | type | notes |
|---|---|---|
| channel_id | text primary key | |
| uploads_playlist_id | text not null | from `channels.list?part=contentDetails` |
| next_page_token | text | null means start from the top |
| exhausted_at | timestamptz | reset when a walk finishes |
| last_synced_at | timestamptz | throttle |

Read function `public.karaoke_catalog_page(p_query text, p_channel text, p_offset int, p_limit int)`
returns `jsonb` `{ total, items: [...] }`, matching the queue item shape where possible
(`videoId`, `title`, `channelTitle`, `thumbnailUrl`, `publishedAt`). `p_query` matches
`lower(title) like '%' || lower(trim(p_query)) || '%'`; `p_channel` is an exact match or
null. Clamp `p_limit` to 50 and `p_offset` to a sane ceiling. `SECURITY DEFINER`, empty
search path, `service_role` execute only.

## Sync

New operation `POST /api/catalog-sync`, callable only with the room **host** token — it
spends real quota, so guests cannot trigger it.

1. For each configured channel handle (Musisi Karaoke, Sing King, KaraokeTV, Vinyl KTV,
   Tito Jay Music KARAOKE) missing a cursor row, resolve it once with
   `channels.list?part=contentDetails&forHandle=<handle>` (1 unit) and store the uploads
   playlist id.
2. Buy units from the existing daily budget: `consume_daily_rate_limit('global',
   'karaoke-catalog-day', 40, …)`. Stop cleanly when it refuses.
3. For each channel, fetch up to 3 pages of `playlistItems.list` (`maxResults=50`,
   `pageToken` from the cursor, 1 unit per page). Upsert every row by `video_id`
   (`channel_title` and `title` refresh, `synced_at = now()`).
4. Persist the returned `nextPageToken`; when a walk returns no token, set
   `exhausted_at` and clear the token so the next day's sync starts over.
5. Throttle: return early if every channel synced within the last 6 hours. Abort the loop
   after 8 seconds of wall time so the function cannot time out mid-write.

Cost: a full run of 5 channels × 3 pages is 15 units from the 10,000-unit pool, so ~750
songs per run, and the catalog deepens each run until a channel's uploads run out.

Read operation `POST /api/catalog-page` with `{ query?, channel?, offset?, limit? }`,
authorized by the same room guest/host token check the YouTube operations already use, so
the catalog is browsable inside a room only.

## UI

- **Entry:** "View more" in the Popular karaoke strip header. Host → `/room/:id/host/songbook`;
  guest → `/room/:id/songbook`.
- **Host Songbook page:** sidebar entry "Songbook" beside Song library. Header with a
  search field (instant, debounced), channel chips (All + one per synced channel), and a
  count. Results are 30 per page with a "Load more" button. Each row: artwork, title,
  karaoke channel, published year, and an Add button that uses the existing queue command.
- **Guest Songbook screen:** same list and filter, 44px minimum controls, its own back
  link so the phone remote keeps its two tabs (Search, Queue).
- An added song behaves exactly like a search result add today: it enters the queue and
  the host auto-plays.

## Failure and empty states

| situation | behaviour |
|---|---|
| catalog empty or not yet synced | host sees "The songbook is warming up." with a Retry that triggers `catalog-sync`; guests see the same message without the button |
| no API key / budget spent | the cached rows still list; a quiet note says new songs pause until tomorrow |
| filter returns nothing | "No song matches «query»" plus a link to the search box (which can spend quota consciously) |
| sync fails mid-channel | earlier upserts stay; the cursor is unchanged so the next run retries that page |

## Testing

- pgTAP: `karaoke_catalog_page` paging, case-insensitive match, channel filter, clamping,
  and grants (service_role only).
- Unit: sync mapper (fake `fetch` returning playlistItems pages → rows, token advance,
  exhausted reset), budget stop, 8-second abort.
- Mocked e2e: strip → View more → songbook lists, filter narrows, Add issues one queue
  command; empty-catalog state renders.
- Manual after deploy: one real sync against the production key, then confirm a song added
  from the songbook plays on the host.

## Quota summary

| path | cost |
|---|---|
| browsing, filtering, paging | 0 |
| adding from the songbook | 0 search units (metadata resolves through oEmbed) |
| one sync run | ≤ 15 units from the 10,000 pool, hard-capped at 40/day |
| search box, suggest, strip | unchanged |

## Rollout

1. Migration 0031 plus pgTAP.
2. Sync operation and its unit tests.
3. Read operation.
4. Host page and sidebar entry; guest screen and strip entry.
5. Deploy, run one sync, verify a song added from the songbook plays.

## Open limits

- Depth is bounded by the five channels' uploads — thousands of tracks, not literally
  countless; adding channels is a config change.
- Duration is unknown until a song is queued (that endpoint does not return it); rows omit
  it rather than guess.
- The catalog is global, shared by every room; nothing in it is room-specific.
