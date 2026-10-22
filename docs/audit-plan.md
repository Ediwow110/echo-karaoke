# Production-Readiness Audit — Task Tracker

Repository: G:\Vscode\online-karaoke
Auditor: OpenCode (senior architect / security / staff FE / BE / DB / QA / DevOps / UX)
Status: IN PROGRESS
Base commit: 025b4ec (branch master, pushed to https://github.com/Ediwow110/echo-karaoke)

## Passes
| Pass | Scope | Status |
|---|---|---|
| Pass 1 | Map repo, docs, config, dependencies | done |
| Pass 1 | Architecture & business logic trace | done |
| Pass 1 | AuthN / AuthZ | done |
| Pass 1 | Database / migrations / constraints | done |
| Pass 1 | API / validation / security | done |
| Pass 1 | Frontend / UX / a11y / performance | done |
| Pass 1 | Testing / CI / production readiness | done |
| Pass 2 | Adversarial second pass (prove first pass wrong) | done |
| Pass 3 | Cross-validation of Critical/High findings | done |
| Final | Write final report | done |

The six Pass 1 domains ran as independent read only auditors, one per domain, so that
no two reviewers shared an assumption. Pass 2 took every finding back and tried to
refute it. Two findings were proven against the running system, one was measured in a
browser, and every Medium finding was re-checked by the reviewer independently of the
auditor, and none of them turned out to be overreach. Pass 3 re-checked the two High
findings against the code path, and both had been confirmed by a second auditor
already.

The report is written as a text file outside the repository, because the repository is
public and a report that names a live weakness is a disclosure. Committing it is a
decision for the owner. This tracker holds the ledger and is local only, behind the
pushed commit `d055f9d`.

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

### ARCH-1: the approved device classification is not implemented, and the home screen branches in JavaScript
Pass 1 severity: Medium. Auditor confidence: High. Confirmed independently by three
reviewers, the reviewer also measuring the deployed preview.
`src/app/HomePage.tsx:39` uses `useMediaQuery('(min-width: 1024px)')` and branches into
two separate trees at `:116` and `:238`, while
`docs/superpowers/specs/2026-10-22-device-aware-home-and-live-suggestions.md:20-26`
requires the shorter edge under 640 pixels to mean phone, with the classification
expressed in the stylesheet through order utilities, one markup tree, and no resize
listener. Two things break beyond the boundary itself: the two trees are different
DOM, so the markup order does change for a screen reader, which the spec forbids at
`:110`; and there are two scan actions in the source, `:168` inside the narrow join
form and `:243` as the wide tree's mobile action, where the spec asks for one at
`:38-40`.
Fix: one markup tree with order utilities and a container query that can express the
shorter edge, or at minimum change the query to
`(min-width: 640px) and (min-height: 640px)` and make both trees emit the same order.

### ARCH-2: the suggestion strip can never show the twelve songs the spec claims and verifies
Pass 1 severity: Low. Auditor confidence: High. The same drift as API-11.
`supabase/functions/youtube-popular/index.ts:20` asks for twelve,
`supabase/functions/_shared/youtube.ts:85` caps the mapping at ten, and
`src/features/queue/PopularSongs.tsx:84` renders eight. The spec's own verification
step, "the strip shows twelve songs", can therefore never pass.

### ARCH-3: one song carries two different queue numbers on the same screen
Pass 1 severity: Low. Auditor confidence: High.
`src/features/queue/SongSearchPanel.tsx:191` prints the raw database position, while
`:82-85` and `:266-268` compute a one-based index over the sorted queue, and
`src/features/queue/QueueRows.tsx:160` and `:107` number the up-next list from a
different slice again. With one song playing, the list says 01 and the search result
for the same song says 2, and the confirmation says 2.

### ARCH-4: dead code, and the client room-code generator has already drifted from the server
Pass 1 severity: Info. Auditor confidence: High.
`src/features/rooms/roomCode.ts:28-30` generates room codes on the client although the
server owns that, and the client version rejects bytes at or above 224 while the server
uses `byte % 32`, so the two disagree for one byte value in four. Only the unit test
references the client generator, and that test asserts the client copy, so a future
change to the server alphabet would leave the suite green and the client wrong.
Also unused: `readJoinCodeFromPath` and `readRoomIdFromPath`
(`src/features/rooms/roomUrl.ts:10`, `:20`), `readQueue`
(`src/features/queue/queueApi.ts:75-78`), `clearRoomTokens`
(`src/features/rooms/tokenStore.ts:66`), and `src/ui/Panel.tsx`, which is exported from
the barrel and imported nowhere. The vote and suggest endpoints are named in
`src/lib/edgeApi.ts` but no screen calls them, so the voting feature in the console
redesign spec and the autocomplete have no reachable screen.

### ARCH-5: the heartbeat runs at the full poll rate, so the throttle only applies to a hidden tab
Pass 1 severity: Info. Auditor confidence: High.
`src/features/rooms/useRoomData.ts:95-99` sends a touch before every read, four seconds
apart, and the thirty second cadence at `:67` applies only to the hidden path. A room
of thirty guests plus a host costs about 900 Edge invocations a minute, half of them
heartbeats the database would have skipped anyway
(`supabase/migrations/0001_room_core.sql:555-558`).

### ARCH-6: the specs on disk describe a different product, palette and sync model
Pass 1 severity: Info. Auditor confidence: High.
`docs/superpowers/specs/2026-10-22-encore-console-redesign.md:78-96` specifies
graphite `#0A0B0E`, cobalt `#4E82FF` and Manrope, while `src/styles.css:68-96`
implements graphite `#100d18`, a violet signal and Inter, and `public/fonts/` has no
Manrope. That spec names two images that no longer exist and three primitives that
are gone. `docs/superpowers/specs/2026-10-18-online-karaoke-design.md:37-50` still
describes Realtime and Presence as the sync mechanism while `README.md:32` states
Realtime is not used and the code polls. A reader is handed a false contract, which
is what produced ARCH-1.

### QA-1: the Playwright suite never runs in CI, so the client to Edge seam is untested
Pass 1 severity: Medium. Auditor confidence: High.
`.github/workflows/ci.yml:16-88` has three jobs and none runs `npm run test:e2e`,
although `docs/superpowers/plans/2026-10-18-online-karaoke-implementation.md:192`
promised browser tests in CI. The unit tests replace the whole Edge API with a fake
that accepts any call (`tests/unit/guestRoomPage.test.tsx:41-59`), and the
integration suite drives the functions over raw HTTP without the React client
(`tests/integration/edgeRoomAuth.test.ts:31-58`). A break in the seam between them,
for example the guest remote stopping sending the guest pass, is invisible to CI.
`playwright.config.ts` has no `webServer`, so the suite cannot start on a clean runner
even if the step were added.

### QA-2: the database job hit the image pull rate limit on the very first run
Pass 1 severity: Medium. Auditor confidence: High.
The log of run 39779181642 shows `toomanyrequests: Rate exceeded` and retries for
nine of the ten Supabase images from `public.ecr.aws`, and the stack only came up 92
seconds after the step began. GitHub runners share address ranges and pull
anonymously, so a throttled registry turns a correct commit red for a reason that has
nothing to do with the code. No step caches the images; only npm is cached.

### QA-3: the Edge integration suite skips itself and still reports success
Pass 1 severity: Low. Auditor confidence: High.
`tests/integration/edgeRoomAuth.test.ts:6-8` decides whether to run from two
environment variables and wraps every block in `describe.skipIf(!runsLocally)`. Run
with the variables absent it prints 17 skipped tests and exits 0. If the extraction in
`.github/workflows/ci.yml:56-57` ever yields an empty value, the step goes green and
the only job that exercises the thirteen Edge Functions against a real Postgres stops
doing so, with nothing reporting it.

### QA-4: the test suites spend 23 of the 30 local anonymous sign-ins an hour
Pass 1 severity: Medium. Auditor confidence: Medium.
`supabase/config.toml:204` sets `anonymous_users = 30`. The integration suite alone
calls `anonymousSession()` 23 times and the Playwright suite adds roughly one per
browser context, about 14 per run. A second run inside the same hour, or an
integration run followed by a Playwright run, exceeds the budget and the client reports
"Could not start a guest session". The same limit is the venue network limit in
production.

### QA-5: the production artifact is a bundle nothing deploys, and it is not gated
Pass 1 severity: Low. Auditor confidence: High.
`.github/workflows/ci.yml:59-88` gives `production-artifact` no `needs:`, so it runs
beside the `verify` job rather than after it, and nothing in `vercel.json` or the
workflow consumes the uploaded `dist`. The headers live in `vercel.json` and are
applied at the Vercel edge, not in the bundle, so the README sentence that suggested
the artifact needed no further headers was wrong. Corrected during the audit.

### QA-6: the thirteen Edge Functions are never type-checked
Pass 1 severity: Low. Auditor confidence: High.
`tsconfig.json:19` includes only `src`, `tests` and the config files, so `tsc` never
sees `supabase/functions/`, Deno strips types without checking them, and
`supabase functions deploy` does not type-check either. A wrong field name inside a
function deploys, leaves the job green, and appears only when that path runs.

### QA-7: the documented procedure left the Edge allowlist with one origin
Pass 1 severity: Medium. Auditor confidence: Medium.
**This was a defect in the runbook written during this audit**, and it is fixed. The
procedure set the Edge secret with a single production origin while telling the
operator to give the preview environment the preview origin as a Vercel build
variable. The two are read in different places: the Edge secret is what the functions
enforce and the build variable is what the deploy guard checks. A preview whose
origin was missing from the Edge secret passes `npm run verify:preview`, loads the
app shell, and fails every function call with a CORS error. The procedure now sets
both origins in one comma separated list, gives the preview a stable alias so the
origin does not change on every deploy, and says which value goes where.

### QA-8: several unit tests assert source text, and one can be defeated by a quote
Pass 1 severity: Low. Auditor confidence: High.
`tests/unit/appShell.test.tsx:33-36` asserts the entry point contains
`await import('./lib/supabase')` and that no single quoted static import of it
exists. Rewriting the import with double quotes keeps the test green while the
Supabase client is statically bundled into the first download, which is the exact
regression the test exists to prevent. `tests/unit/styles.test.ts:5` and
`tests/unit/consoleDesign.test.ts:5` grep the stylesheet text, so they break on a
renamed custom property and stay green when the stylesheet is never loaded.

### QA-9: the host stage and party screens have no test at all
Pass 1 severity: Low. Auditor confidence: High.
`src/app/HostStagePage.tsx:55-83` and `src/app/HostPartyPage.tsx:50-82` implement the
keyboard map, the transport, the ten second seek, the volume and fullscreen, and
neither has a test file. The Playwright suite never opens `/host/stage` or
`/host/party`, while `README.md:12` claims the stage view has all of it.

### QA-10: the claim that one player stays mounted across host route changes is asserted nowhere
Pass 1 severity: Info. Auditor confidence: High.
`README.md:33` states the player stays mounted while the host moves between the host
routes. The only browser test that touches the player
(`tests/e2e/room-flow.spec.ts:185-206`) asserts the iframe changes when the host
moves to a **different room**. No test navigates between host routes of the same room
and compares the iframe identity, so a re-keyed player that restarts the song on the
television would pass CI.

### QA-11: the integration and Playwright suites depend on the live YouTube oEmbed endpoint
Pass 1 severity: Low. Auditor confidence: Medium.
`supabase/functions/_shared/youtube.ts:29-40` resolves metadata from
`https://www.youtube.com/oembed`, and
`tests/integration/edgeRoomAuth.test.ts:317-326` expects a 201 with a server resolved
title while `tests/e2e/room-flow.spec.ts:134` expects the literal YouTube title for
one video. When the network cannot reach YouTube, both suites fail even though the
product code is correct, and the Playwright assertion is bound to wording YouTube can
change without any code change.

### QA-12: the workflow does not run on every push
Pass 1 severity: Info. Auditor confidence: High.
`.github/workflows/ci.yml:3-5` limits the push trigger to `master` and `feature/**`,
while the runbook said the remote is added "so the CI workflow runs on every push". A
push to any other branch name starts no workflow, and the commit still looks verified
because a workflow with that name exists on the repository. **Corrected during the
audit.**

## Findings ledger (id | severity | confidence | title)
Forty seven distinct findings from forty nine ids. Two pairs were found independently by
two auditors each: API-1 with DB-1, and FE-1 with ARCH-1. "Proven" means the finding
was reproduced against the running system, not only read. "Measured" means the
behaviour was observed in a browser or against the running database. "Verified" means
the reviewer re-checked the evidence independently of the auditor.

| id | severity | confidence | title | evidence |
|---|---|---|---|---|
| AUTH-1 | High | High | the host heartbeat is bound to the Auth user id, so a live room is deleted after an Auth session replacement | Proven |
| API-1, DB-1 | High | High | the shared daily song-lookup pool is charged before the work succeeds, so one guest locks song adding deployment-wide until the next Pacific midnight | Proven |
| FE-1, ARCH-1 | Medium | High | the home screen classifies devices with a 1024 pixel width query, not the approved shorter-edge rule, and it branches in JavaScript into two different DOM trees | Measured |
| FE-2 | Medium | High | the guest Search tab ships touch targets under 44 pixels and the end to end suite never measures that tab | Measured |
| FE-3 | Medium | High | no focus move or announcement happens on a route change | Verified |
| FE-4 | Medium | Medium | the guest remote promises automatic advance while the host screen is closed | Verified |
| API-2 | Medium | High | the search budgets are spent before the shared pool and before the upstream call | Verified |
| API-3 | Medium | High | the dev tunnel leaves a dead host in `.env` and never restores it | Verified |
| API-4 | Medium | Medium | the deploy guard never checks that the browser key is the anon or publishable key | Fixed |
| QA-1 | Medium | High | the Playwright suite never runs in CI, so the client to Edge seam is untested | Verified |
| QA-2 | Medium | High | the database job hit the image pull rate limit on the very first run | Verified in the run log |
| QA-4 | Medium | Medium | the suites spend 23 of the 30 local anonymous sign-ins an hour | Verified by count |
| QA-7 | Medium | Medium | the documented procedure left the Edge allowlist with one origin | Fixed |
| AUTH-2 | Low | High | the heartbeat never checks the room state, so an ended room can be kept alive | Read |
| AUTH-3 | Low | High | the vote path is the only member write without a rate limit | Read |
| FE-5 | Low | High | three smooth scrolls ignore the reduced-motion preference | Read |
| FE-6 | Low | High | the text inputs cancel the 2 pixel focus ring the spec requires | Read |
| FE-7 | Low | High | the stage slot forces a layout read and a re-render on every scroll event | Read |
| FE-8 | Low | Medium | the guest progress position compares the server clock with the phone clock | Read |
| API-5 | Low | High | the server does not strip control characters from a display name | Read |
| API-6 | Low | Medium | the request body limit is applied after the body is fully buffered | Read |
| API-8 | Low | Medium | an empty upstream search response is written to the shared ten-minute cache | Read |
| API-9 | Low | High | the preview verifier matches the CSP by substring | Read |
| API-10 | Low | Medium | a retry after a timeout is shown as a failure for a song that was added | Read |
| ARCH-2 | Low | High | the suggestion strip can never show the twelve songs the spec claims and verifies | Read |
| ARCH-3 | Low | High | one song carries two different queue numbers on the same screen | Read |
| QA-3 | Low | High | the Edge integration suite skips itself and still reports success | Read |
| QA-5 | Low | High | the production artifact is a bundle nothing deploys, and it is not gated | Read |
| QA-6 | Low | High | the thirteen Edge Functions are never type-checked | Read |
| QA-8 | Low | High | several unit tests assert source text, and one can be defeated by a quote | Read |
| QA-9 | Low | High | the host stage and party screens have no test at all | Read |
| QA-11 | Low | Medium | the suites depend on the live YouTube oEmbed endpoint | Read |
| DB-2 | Low | High | the roster online window equals the background-tab heartbeat cadence | Read |
| DB-3 | Low | High | no pgTAP assertion covers the heartbeat the sweep depends on | Read |
| AUTH-4 | Info | High | the room creation cap is keyed on a resettable identity | Read |
| FE-9 | Info | Medium | the host console can render a completely blank page | Read |
| API-7 | Info | High | the suggest function is deployed, reachable, unused, and its cache never evicts | Read |
| API-11 | Info | High | the chart asks for twelve entries and the mapper keeps ten | Read |
| API-12 | Info | Medium | the deploy guard does not cover the YouTube budget variables | Read |
| ARCH-4 | Info | High | dead code, and the client room-code generator has already drifted from the server | Read |
| ARCH-5 | Info | High | the heartbeat runs at the full poll rate | Read |
| ARCH-6 | Info | High | the specs on disk describe a different product, palette and sync model | Read |
| QA-10 | Info | High | the claim that one player stays mounted across host route changes is asserted nowhere | Read |
| QA-12 | Info | High | the workflow does not run on every push | Fixed |
| DB-4 | Info | High | the duplicate-video guard and the unique constraints are never asserted directly | Read |
| DB-5 | Info | High | the platform default privileges still grant write-adjacent rights on new public tables and sequences | Read |
| DB-6 | Info | High | the queue reader and the ended-room retention function are unreachable, so the documented retention never runs | Read |

## The order to fix them in

1. **API-1 and DB-1.** One guest can end song adding for the whole deployment. Move the
   cheap duplicate and lock checks ahead of the pool, give the pool a per-room tier,
   and lower the per-caller window.
2. **AUTH-1.** A live room with an active host is deleted by the sweep after an Auth
   session replacement, and no test would catch it. Let the heartbeat carry the host
   capability, and close the DB-3 gap with the same change.
3. **API-4.** Fixed during the audit, because the next step past this point is pasting
   a Supabase key into Vercel.
4. **FE-2 and QA-1.** The touch target floor and the missing browser gate. The first is
   a promise the app makes to a guest on a phone, and the second is why the first was
   never noticed.
5. **FE-1 and ARCH-1.** One markup tree with the approved rule, which also repairs the
   markup order promise and the duplicate scan action.
6. **FE-4.** The guest is told a thing that is not true while the room is stalled.
7. Everything Low and Info, in the order the ledger lists them.

## Notes
- The audit is read only. No production code is changed while it runs.
- The report is written outside the tracked tree first, because the repository is
  public and a report that names a live weakness is a disclosure. Committing the
  report is a separate decision for the owner.

## Neon boundary audit (2026-10-23)

The ledger above describes the Supabase boundary. It is kept for history. The Neon
migration replaced the Edge Functions with one same-origin Vercel Function, replaced
Supabase Auth with Better Auth, and split the database credentials into `service_role`
and `echo_auth`. The current report is
`docs/audit/2026-10-22-neon-boundary-audit.md`.

| ID | Severity | Finding | Status |
|---|---|---|---|
| N-1 | High | JWKS was fetched from the request origin, so a spoofed Host could supply the keys | Fixed |
| N-2 | Medium | A JWT without `exp` was accepted | Fixed |
| N-3 | High | The default function export was treated as a Node `(req, res)` handler and never answered | Fixed |
| N-4 | High | The catch-all function matched only one path segment, so `/api/auth/token` would 404 | Fixed |
| N-5 | Medium | `config.runtime = 'nodejs24'` is not a valid Vercel value | Fixed |
| N-6 | Medium | TypeScript 7 could not be emitted by the Vercel function builder | Fixed |
| N-7 | Medium | service_role had no explicit revoke on the auth tables | Fixed |
| N-8 | Low | The client token and sign-in requests had no deadline | Fixed |
| N-9 | Low | An unknown key id waited out the ten-minute JWKS cache | Fixed |
| N-10 | Info | `clearAnonymousSession` was dead API | Removed |

Gates on 2026-10-23: 226 unit tests, 225 database assertions on Neon, 3 operation
integration tests, `npm run build`, `vercel build`, and a local hosted-style flow
(sign-in 200, token 200, create-room 201). No production deployment and no push were
performed. The remaining work is the approval-gated Vercel environment, the CI
secrets, and the four open items in the report.
