# Production-Readiness Audit — Task Tracker

Repository: G:\Vscode\online-karaoke
Auditor: OpenCode (senior architect / security / staff FE / BE / DB / QA / DevOps / UX)
Status: IN PROGRESS
Base commit: 025b4ec (branch master, pushed to https://github.com/Ediwow110/echo-karaoke)

## Passes
| Pass | Scope | Status |
|---|---|---|
| Pass 1 | Map repo, docs, config, dependencies | done |
| Pass 1 | Architecture & business logic trace | running |
| Pass 1 | AuthN / AuthZ | running |
| Pass 1 | Database / migrations / constraints | running |
| Pass 1 | API / validation / security | running |
| Pass 1 | Frontend / UX / a11y / performance | running |
| Pass 1 | Testing / CI / production readiness | running |
| Pass 2 | Adversarial second pass (prove first pass wrong) | pending |
| Pass 3 | Cross-validation of Critical/High findings | pending |
| Final | Write final report | pending |

The six Pass 1 domains run as independent read only auditors, one per domain, so that
no two reviewers share an assumption. Pass 2 takes every finding back and tries to
refute it, and Pass 3 re-checks only the Critical and High findings against the code
path, because a reviewer can cite a correct line next to a wrong severity.

## Pass 1, the repository map
Tracked files, 275 in total, on one branch with no history beyond the ECHO rewrite.

| Area | Files | Lines | What it holds |
|---|---|---|---|
| `src/` | 71 | 8298 | The React client: `app/` screens and routing, `features/` rooms, queue, playback, library, `lib/` Supabase client and Edge transport, `ui/` primitives |
| `supabase/functions/` | 16 | 1281 | Thirteen Deno Edge Functions plus `_shared/room.ts`, the shared auth, CORS and error layer |
| `supabase/migrations/` | 19 | 2841 | The schema and the authorized operations, 0001 through 0019 |
| `supabase/tests/` | 7 | 1077 | The pgTAP suites |
| `tests/` | 42 | 3530 | Thirty nine Vitest files for logic and components, two Playwright specs for the real flows |
| `scripts/` | 5 | 309 | The deploy guard, the preview verifier, the dev tunnel |
| `public/` | 16 | | The fonts, the images, the favicon, `robots.txt`, `llms.txt` |
| `docs/` | 10 | | The specs and the plans under `docs/superpowers/`, the hosted setup runbook, this tracker |
| `.github/` | 3 | | The CI workflow, the issue and pull request templates |

Runtime dependencies: `@phosphor-icons/react`, `@supabase/supabase-js`, `jsqr`, `qrcode`,
`react`, `react-dom`, `react-router-dom`. Seven in total, and none of them is a server
framework, a date library, a state manager, a validation library, or a test runner in
the production path.

Build tooling: Vite 8, Tailwind 4, TypeScript 7, Vitest 5, Playwright 1.64, the
Supabase CLI 2.121.0 pinned in the CI workflow.

## Evidence collected before the audit
- Local gates green on the base commit: build pass, unit 193/193, database 210/210, Edge
  integration 17/17, Playwright 9/9, `npm audit --audit-level=high` 0 findings.
- The full CI path was reproduced locally before it ever ran on GitHub: `supabase db reset`
  applied migrations 0001 to 0019 and the seed from scratch, `supabase test db` passed
  210/210, the `supabase status -o env` extraction used by the workflow returned the
  API URL and the anon key, and the Edge integration suite passed 17/17 against the
  Edge Functions running in the container that `supabase start` brings up.
- First GitHub CI run 39779181642: `verify` succeeded, `production-artifact` skipped
  because the repository variables are not set yet, `database` still running.
- A Vercel preview deployment passes `npm run verify:preview`, and a browser check of
  that deployment reports zero console errors and zero warnings.

## Pass 1 findings, not yet validated
The Pass 1 auditors report here. Nothing in this section is a conclusion until Pass 2
has tried to refute it and Pass 3 has re-checked the Critical and High findings.

### AUTH-1: the host heartbeat is bound to the Auth user id while the host token is not
Pass 1 severity: Medium. Auditor confidence: High.
Proven against the local stack, not just read:
```
touch-member with the original session : 200
touch-member after the session swap    : 401 UNAUTHORIZED
host-room-read after the session swap  : 200, the host is still in control
```
`supabase/functions/touch-member/index.ts:22` accepts only the guest pass, and
`private.require_guest` matches on room, user id and digest together
(`supabase/migrations/0001_room_core.sql:168-172`). The client mints a new anonymous
user whenever the stored session is rejected (`src/lib/supabase.ts:61-64`), and the
host pass is not user bound (`0001_room_core.sql:198-202`), so the host keeps full
control while its member row stops being refreshed. The sweep in
`supabase/migrations/0019_abandoned_room_cleanup.sql:29-36` then deletes the live room
thirty minutes later and cascades the queue, the votes, the events and the host secret.
**Severity raised to High by the auditor's own severity rubric:** this is data loss of a
live room with an active host, and the trigger is a long session, because the local
Auth configuration expires the access token after one hour.
Proposed fix: accept the host pass in `touch-member` and resolve the host member
through `private.require_host`, which is not bound to a user id, so the heartbeat
survives an Auth session replacement.

### AUTH-2: the heartbeat never checks the room state
Pass 1 severity: Low. Auditor confidence: High.
`public.touch_member` (`0001_room_core.sql:540-562`) has no `private.require_live`,
unlike every other mutation, so a deliberate heartbeat loop keeps an ended room alive
past the retention window. The honest client stops polling an ended room
(`src/features/rooms/useRoomData.ts:85-87`), so only a deliberate loop triggers it.

### AUTH-3: the vote path is the only member write without a rate limit
Pass 1 severity: Low. Auditor confidence: High.
`supabase/functions/vote-command/index.ts:1-47` carries no limiter, and
`0001_room_core.sql:97-111` and `0015_vote_reorder_locks.sql:58` append a
`room_events` row on every toggle, so a vote loop grows that table without bound.

### AUTH-4: the room creation cap is keyed on a resettable identity
Pass 1 severity: Info. Auditor confidence: High.
`0018_retention_and_creation_limits.sql:78` keys the ten rooms per hour on the
anonymous user id, which the client can mint again at will, so the real ceiling is the
hosted anonymous sign-in limit times ten. The abandoned sweep bounds the effect.

### FE-1: the home screen classifies devices with a 1024 pixel min-width query, not the approved shorter-edge rule
Pass 1 severity: Medium. Auditor confidence: High. Independently confirmed by the
auditor and by the reviewer, which also measured the deployed preview.
`src/app/HomePage.tsx:39` uses `useMediaQuery('(min-width: 1024px)')`, and
`src/lib/useMediaQuery.ts:19-25` re-renders the whole home page when the query
changes. The approved rule in
`docs/superpowers/specs/2026-10-22-device-aware-home-and-live-suggestions.md:20-22` is
that the shorter edge under 640 pixels means phone. Two classes of viewport diverge:
- The rule says phone, the code says wide: width 1024 or more and height under 640,
  for example 1024 by 600 or 1366 by 600. A short wide window gets the host console.
- The rule says wide, the code says phone: width from 640 to 1023 and height 640 or
  more, for example a portrait tablet at 768 by 1024. That guest is given the
  phone-first join form, and rotating the tablet to landscape replaces the form they
  were filling with the host creation form, because the classification flips on the
  resize listener.
Fix: express the approved rule in the query, `'(max-width: 639px), (max-height: 639px)'`,
or move the classification into the stylesheet with order utilities, as the spec
itself asks, so no JavaScript state and no resize listener take part.

### FE-2: the guest remote Search tab ships touch targets under 44 pixels, and the end to end assertion never measures that tab
Pass 1 severity: Medium. Auditor confidence: High for the code, Medium for the pixel
heights, because they were derived from the Tailwind scale rather than measured.
`src/ui/Button.tsx:23-27` scales `sm` to 36 pixels, `md` to 40 pixels and `lg` to 48
pixels. On the guest Search tab the primary "Add to queue" button is `size="md"`
(`src/features/queue/PasteSongForm.tsx:96-106`), each result "Add" button is
`size="sm"` (`src/features/queue/SongSearchPanel.tsx:194-208`), the clear-search
button is `size-8` (`src/features/queue/SongSearchPanel.tsx:118-125`), and the three
"Try" chips are `px-3 py-1.5` (`src/features/queue/SongSearchPanel.tsx:236-245`). The
approved floor is 44 by 44 pixels
(`docs/superpowers/specs/2026-10-22-encore-console-redesign.md:339`).
The reason the suite stays green is the coverage gap: `tests/e2e/room-flow.spec.ts:226`
measures the guest **Queue** tab, where every control is `min-h-11`, and the Search tab
the test visits at line 219 is never measured.
Fix: raise those controls to 44 pixels or more, and measure the Search tab and the
scan page in the end to end suite as well.

### FE-3: no focus move or announcement happens on a route change
Pass 1 severity: Medium. Auditor confidence: High.
There is no focus management effect in the router or in any screen. The only `.focus(`
calls are in the confirm dialog and in the two host pages that focus the search field
after a deliberate press. The guest tab switch replaces the whole content region with
`<main key="search">` against `<main key="queue">`
(`src/app/GuestRoomPage.tsx:320` and `:359`), and the create and join navigations
remove the focused control. A screen reader user activates "Create room" and the
browser drops focus to the body with nothing announced.

### FE-4: the guest remote promises automatic advance while the host screen is closed
Pass 1 severity: Medium. Auditor confidence: Medium.
`src/app/GuestRoomPage.tsx:420-430` renders "Automatic advance is on" and names the
next song whenever a song is playing, with no check on whether the host is still
present. The flag is already in the payload: `RosterEntry.online`
(`src/features/rooms/useRoomData.ts:18-21`), which the server defines as a heartbeat
within 30 seconds (`supabase/migrations/0001_room_core.sql:251`). The guest page
already reads the host out of the roster at `src/app/GuestRoomPage.tsx:65` but keeps
only the display name. The host screen pauses the room when it goes away
(`src/app/HostRoomPage.tsx:54-80`), so the next song never starts and the guest is
told it will.
Fix: branch the panel on the host's online flag and say plainly that the host screen
is closed.

### FE-5: three smooth scrolls ignore the reduced-motion preference
Pass 1 severity: Low. Auditor confidence: High.
`src/app/HostDiscoverPage.tsx:45`, `src/app/HostQueuePage.tsx:35` and `:158` call
`scrollIntoView({ behavior: 'smooth' })`. The stylesheet guard at
`src/styles.css:344-354` sets `scroll-behavior: auto !important`, which governs only
the scrolling the user or the agent initiates, so the JavaScript option wins.
`src/features/queue/queueAnchor.ts:15` has the same pattern.

### FE-6: the text inputs cancel the 2 pixel focus ring the spec requires
Pass 1 severity: Low. Auditor confidence: High.
`src/styles.css:198-201` defines a global `:focus-visible` ring, and
`src/ui/Field.tsx:46`, `src/features/queue/SongSearchPanel.tsx:115`,
`src/features/queue/PasteSongForm.tsx:93` and
`src/features/library/SongCollectionView.tsx:141` remove it with
`focus:outline-none focus-visible:outline-none`. The only focus cue left on an input
is a one pixel border colour change. The unit test at
`tests/unit/consoleDesign.test.ts:59-61` greps the stylesheet, so it cannot see the
utilities that remove the ring.

### FE-7: the stage slot forces a layout read and a re-render on every scroll event
Pass 1 severity: Low. Auditor confidence: High.
`src/features/playback/HostPlayer.tsx:337-345` calls `getBoundingClientRect` and
stores a freshly allocated object in state on every capture-phase scroll event, and
that state feeds the inline style of the fixed player layer, so the whole overlay
re-renders on every scroll tick.

### FE-8: the guest progress position compares the server clock with the phone clock
Pass 1 severity: Low. Auditor confidence: Medium.
`src/features/playback/playbackClock.ts:17-22` adds the elapsed time since the
database timestamp `updatedAt` to the base position, using the guest device clock. A
phone whose clock is wrong renders a position that is minutes away from the real one,
clamped to the duration at `src/features/queue/NowPlayingCard.tsx:38`.

### FE-9: the host console can render a completely blank page
Pass 1 severity: Info. Auditor confidence: Medium.
`src/app/HostRoomPage.tsx:306-308` returns null when the room is missing, while every
other terminal state returns a full page with a message and a way out. The auditor
could not prove a path that produces that shape today.

### API-1: the shared song-metadata pool is spent before the cheap checks, so refused adds still drain it
Pass 1 severity: High. Auditor confidence: High. **Proven against the local stack**, not
just read.
```
before: shared global pool = 8   songs in the queue = 0
requests: 201, 409 DUPLICATE_SONG x9
after : shared global pool = 18  songs in the queue = 1
pool units consumed: 10          songs actually added: 1
```
`supabase/functions/queue-command/index.ts:94` consumes the global daily pool, and the
lookup is at `:99` and the insert at `:108`, so the pool is charged before the guest
lock, the five-per-minute cap and the duplicate guard, which all live inside
`queue_add` (`supabase/migrations/0012_lock_hardening.sql:49`, `:70`, `:82-91`). The
pool is one shared bucket for every guest and every room
(`supabase/functions/queue-command/index.ts:17`, the limit is 1000 per Pacific day).
One guest session spends ten units a minute and empties it in about a hundred minutes,
after which every room in the deployment gets `429 LOOKUP_RATE_LIMITED` and no song can
be added anywhere, by link or by search result, until the next Pacific midnight.
`queue_add` is the only insert path into `queue_songs`, so there is no way around it.
The narrower member limit at `:89` is consumed first on purpose, to stop a burst, but
it bounds one guest, not the pool.

### API-2: the search budgets are spent before the shared budget and before the upstream call
Pass 1 severity: Medium. Auditor confidence: High.
`supabase/functions/youtube-search/index.ts:98` and `:107` spend the guest daily limit
and the room daily limit, and only `:124` checks the shared global pool, and only
`:141` calls the upstream. Once the shared pool is empty every further search still
advances the two narrower counters, so a guest ends up locked out for the whole
Pacific day after thirty searches that returned nothing.

### API-3: the dev tunnel leaves a dead host in `.env` and never restores it
Pass 1 severity: Medium. Auditor confidence: High.
`scripts/dev-tunnel.ps1:75-82` rewrites `.env` with the ephemeral tunnel host, and the
`finally` block at `:92-97` stops the tunnel without restoring the file. The working
tree proves it: `.env` holds a `trycloudflare.com` host that no longer resolves, so the
next `npm run dev` calls a dead host for every function call, and a local
`npm run build` fails the deploy guard for a reason that has nothing to do with the
real problem.

### API-4: the deploy guard never checks that the browser key is the anon or publishable key
Pass 1 severity: Medium. Auditor confidence: Medium.
`scripts/check-deploy-env.mjs:37-39` only asserts that `VITE_SUPABASE_ANON_KEY` is not
empty, and `vercel.json:4` runs that guard before every build, so it is the only
automated gate between the dashboard and the public bundle. The Supabase dashboard
shows the service role key beside the publishable key, and pasting the wrong one
builds successfully and ships a service role JWT to every visitor, with unrestricted
read and write on every table.
Fix: decode the legacy key and fail the build when the `role` claim is not `anon`, and
accept the `sb_publishable_` form explicitly.

### API-5: the server does not strip control characters from a display name
Pass 1 severity: Low. Auditor confidence: High.
`supabase/functions/_shared/room.ts:199-208` trims and collapses whitespace only,
while the client strips control characters (`src/features/rooms/displayName.ts:2`). A
direct caller can store a name with control and bidi characters, which is then shown
in the roster and in the queue attribution. It is spoofing, not injection, because
React escapes the text.

### API-6: the request body limit is applied after the body is fully buffered
Pass 1 severity: Low. Auditor confidence: Medium.
`supabase/functions/_shared/room.ts:249-253` reads the whole body with `req.text()`
before it checks the 4096 character cap, so the cap does not bound the memory one
request can make the isolate allocate.

### API-7: `youtube-suggest` is deployed, reachable, unused, and its cache never evicts
Pass 1 severity: Low. Auditor confidence: High.
`supabase/functions/youtube-suggest/index.ts:19` keeps a module level map whose entries
are only added or overwritten, never removed, and no file under `src/` calls the
function. A guest can call it directly at 60 requests a minute, and every distinct
query adds a permanent entry to a long-lived isolate.

### API-8: an empty upstream search response is written to the shared ten-minute cache
Pass 1 severity: Low. Auditor confidence: Medium.
`supabase/functions/youtube-search/index.ts:162-163` caches whatever the mapper
returns, and `supabase/functions/_shared/youtube.ts:100-108` returns an empty list for
a payload shape it does not recognise, so one odd upstream response is cached globally
for ten minutes and every guest sees "No matches this time."

### API-9: the preview verifier matches the CSP by substring
Pass 1 severity: Low. Auditor confidence: High.
`scripts/check-preview.mjs:55-65` uses `value.includes(expected)`, `:86` accepts any
`max-age=` for HSTS including `max-age=0`, and the directive list never inspects
`script-src` or `object-src`. A deployment serving `script-src *` and `connect-src *`
passes the verifier.

### API-10: a retry after a timeout is shown to the guest as a failure for a song that was added
Pass 1 severity: Low. Auditor confidence: Medium.
`src/lib/edgeApi.ts:95-105` sends no idempotency key and no timeout, so a request that
reached the server but whose reply was lost is retried, the database refuses the retry
with `409 DUPLICATE_SONG` (`supabase/migrations/0010_active_queue_unique.sql:32-34`),
and the client shows the guest a red "That song is already in the queue" instead of
recognising the song it already queued.

### API-11: the chart asks for twelve entries and the mapper keeps ten
Pass 1 severity: Info. Auditor confidence: High.
`supabase/functions/youtube-popular/index.ts:44-46` requests twelve,
`supabase/functions/_shared/youtube.ts:85` caps at ten, so two fetched and billed
entries are discarded.

### API-12: the deploy guard does not cover the YouTube budget variables
Pass 1 severity: Info. Auditor confidence: Medium.
`scripts/check-deploy-env.mjs` validates none of the budget variables, and
`supabase/functions/youtube-search/index.ts:26-29` accepts any value of 1 or more. A
search budget of 200 against a bucket of 100 calls a day exhausts YouTube for the whole
day, and `youtube-search/index.ts:151-153` reports that as a generic unavailable
search, so the cause is invisible.

## Findings ledger (id | severity | confidence | title)
(appended as verified in Pass 2 and Pass 3)

## Notes
- The audit is read only. No production code is changed while it runs.
- The report is written outside the tracked tree first, because the repository is
  public and a report that names a live weakness is a disclosure. Committing the
  report is a separate decision for the owner.
