# Hosted Setup Runbook

Date: 2026-10-24
Status: `https://echo-karaoke-mocha.vercel.app` was verified on the 2026-10-23 tree.
The current working tree is uncommitted and includes quota, membership, player, and
accessibility changes; do not treat the live alias as proof of this tree. Every hosted
value below is named, never printed.

This runbook takes ECHO from the repository to a deployed, verified site. On the
current tree, typecheck, the production build, 264 unit tests, and 6 UI Playwright
tests pass locally. The pgTAP suite (328 assertions) and the operation integration
suite (7 tests) pass on a disposable Neon branch. This document covers only what a
hosted account makes possible.

## What this procedure produces

- A Neon Postgres database with the full migration chain and the two login roles.
- A Better Auth service inside the same Vercel Function, with anonymous sessions and
  Ed25519 JWTs.
- One Vercel Function at `/api/*` that serves auth and the fourteen room operations.
- A production deployment whose browser bundle holds no database credential.
- A CI workflow that runs the database and operation suites on throwaway Neon branches.

## Architecture

```
browser (Vite app)
  |  same-origin fetch, Bearer JWT, room token headers
  v
Vercel Function  /api/auth/*     -> Better Auth (AUTH_DATABASE_URL)
                 /api/<operation> -> room operations (DATABASE_URL)
  |                                   |
  v                                   v
Neon Postgres                    Neon Postgres
auth tables only                 room schema only
echo_auth role                   service_role role
```

The browser never receives a database URL. The deploy guard refuses a build when any
`VITE_` variable holds a PostgreSQL connection string, and the preview verifier scans
the served HTML and main asset for one.

## Project references

| Resource | Value |
|---|---|
| Neon project | `echo-karaoke` (`plain-queen-50704361`) |
| Neon region | `aws-ap-southeast-1` |
| Neon default branch | `main` (`br-curly-pine-b3bzrw7u`) |
| Vercel project | `echo-karaoke` on `ediwow110s-projects` |
| Expected production origin | `https://echo-karaoke-mocha.vercel.app` |

The Vercel production domain is the project's default domain. Confirm it after the
first deployment and use the confirmed value everywhere this document writes
`https://echo-karaoke-mocha.vercel.app`.

## Credentials

Four connection strings exist, and they are not interchangeable.

| Name | Role | Path | Used by |
|---|---|---|---|
| `DATABASE_URL` | `service_role` | pooled | The Vercel Function for room operations |
| `AUTH_DATABASE_URL` | `echo_auth` | direct | Better Auth for identity tables |
| `NEON_DATABASE_URL` | `neondb_owner` | direct | Migrations, pgTAP, branch cleanup |
| `BETTER_AUTH_SECRET` | secret | n/a | Better Auth cookie and JWKS encryption |

`service_role` bypasses row level security and may execute the room operations. It has
no grant on the auth tables. `echo_auth` may read and write `user`, `session`,
`account`, `verification`, and `jwks`; it has no grant on the room schema and cannot
execute a room operation. The owner URL is never set on Vercel.

`server/.env.neon` holds the four local values and is ignored by git. Never copy it
into a build environment, a chat message, or a command whose output is logged.

## Step 1: Apply the database chain

The chain runs from `0000_platform_compatibility.sql` through
`0021_user_id_text.sql`. On Neon it has already been applied to `main`. To apply it to
another database:

```bash
npx supabase db push --db-url "$NEON_DATABASE_URL" --yes
```

The migrations create `anon`, `authenticated`, `service_role`, and `echo_auth` when a
plain Postgres lacks them, install `pgcrypto` and the pgTAP extension used by the test
files, and grant the authorized operations only to `service_role`.

Run the database suite against the same URL:

```bash
npx supabase test db --db-url "$NEON_DATABASE_URL"
```

Expected: `Result: PASS`, 8 files and 225 assertions. Docker must be running because
the Supabase CLI runs `pg_prove` in a container.

### Role logins

The migrations create `service_role` and `echo_auth` as `NOLOGIN`, because a password
must not live in a migration. On a fresh project, enable both logins once with the
owner connection:

```sql
alter role service_role login password '<service-role-password>';
alter role echo_auth login password '<auth-role-password>';
```

Then build the connection strings:

- `DATABASE_URL` uses the `service_role` login through the pooled host.
- `AUTH_DATABASE_URL` uses the `echo_auth` login through the direct host.
- `NEON_DATABASE_URL` keeps the owner login for migrations and CI only.

Passwords must be percent-encoded inside a URL. The owner login also remains the only
role that can run the migrations.

### Rotating `BETTER_AUTH_SECRET`

Better Auth encrypts the private JWKS key with this secret. Changing the secret while
the old encrypted rows remain makes every auth request fail with a decryption error.
Rotate in this order:

```sql
delete from public.jwks;
```

Then change the secret in Vercel and redeploy. Better Auth generates a new key pair on
the next auth request. Existing clients receive a fresh token from `/api/auth/token`;
the old public key is gone, so a token minted before the rotation stops verifying.
That is expected and is limited to the rotation window.

## Step 2: Understand the auth routes

Better Auth is mounted at `/api/auth/*` in the same function as the operations.

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/sign-in/anonymous` | POST | Create the anonymous identity and session cookie |
| `/api/auth/token` | GET | Return the Ed25519 JWT for the current session |
| `/api/auth/jwks` | GET | Publish the public key set used by the verifier |

The browser client tries `/api/auth/token` first, signs in anonymously only when no
session exists, retries the token, and refreshes it after ten minutes. The room
operations verify the JWT signature against the JWKS and require the anonymous claim.

`resolveBaseUrl` uses `BETTER_AUTH_URL` when set, otherwise the current Vercel
deployment host, otherwise the project production domain, otherwise
`http://127.0.0.1:3000`. `resolveTrustedOrigins` trusts that base URL, both Vercel
hosts, and every origin in `ALLOWED_ORIGINS`.

## Step 3: Run the full stack locally

The app needs the function, not just Vite. `vercel dev` serves both.

```bash
cp server/.env.neon .env.local
npx vercel dev
```

`.env.local` is ignored by git. Open `http://127.0.0.1:3000`, create a room, open the
guest link in a second browser, and add a song. The function and the database are both
local processes; only the database is hosted.

Search and the karaoke strip need a YouTube Data API key in the same file. Song entry uses
the Add buttons in search results, so configure this key to search for and add songs:

```
YOUTUBE_API_KEY=your_key_here
```

For the operation integration suite, no dev server is needed; the test starts an HTTP
server around the function handler itself:

```bash
set -a; . server/.env.neon; set +a
npm run test:integration
```

Expected: 2 tests pass, including the abandoned-room sweep.

## Step 4: Set the Vercel environment

Add these to the Production environment:

```bash
vercel env add DATABASE_URL production
vercel env add AUTH_DATABASE_URL production
vercel env add BETTER_AUTH_SECRET production
vercel env add BETTER_AUTH_URL production
vercel env add ALLOWED_ORIGINS production
vercel env add ROOM_MEMBER_LIMIT production
vercel env add ANON_SIGNIN_LIMIT_PER_HOUR production
vercel env add YOUTUBE_API_KEY production
vercel env add CRON_SECRET production
```

| Variable | Value |
|---|---|
| `DATABASE_URL` | The pooled `service_role` connection string |
| `AUTH_DATABASE_URL` | The direct `echo_auth` connection string |
| `BETTER_AUTH_SECRET` | A random secret of at least 32 characters |
| `BETTER_AUTH_URL` | `https://echo-karaoke-mocha.vercel.app` |
| `ALLOWED_ORIGINS` | `https://echo-karaoke-mocha.vercel.app` |
| `ROOM_MEMBER_LIMIT` | `50` (allowed 2–500); host plus guests |
| `ANON_SIGNIN_LIMIT_PER_HOUR` | `120` (allowed 1–1000); per hashed network address |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key for song search and karaoke picks. Without it these features report "not configured"; search falls back to fresh songbook catalog entries |
| `YOUTUBE_DAILY_SEARCH_BUDGET` | `90` upstream user search calls per day across all rooms |
| `YOUTUBE_DAILY_POPULAR_BUDGET` | `6` upstream karaoke-strip search calls per day (12-hour cache; must fit the same 100-call bucket as search) |
| `YOUTUBE_DAILY_METADATA_BUDGET` | `5000` quota-free oEmbed lookups per Pacific day across the deployment |
| `YOUTUBE_ROOM_METADATA_BUDGET` | `500` quota-free oEmbed lookups per Pacific day per room |
| `CRON_SECRET` | A random secret of at least 32 characters. Vercel Cron sends it as `Authorization: Bearer …` to `/api/cron/catalog-retention`; required in Production, and `npm run verify:deploy` fails without it |
| `PREVIEW_DATABASE_URL` | Preview-only service URL pointing at a disposable Neon branch |
| `PREVIEW_AUTH_DATABASE_URL` | Preview-only auth URL pointing at the same branch |

`ALLOWED_ORIGINS` is read by the deploy guard and becomes a trusted auth origin. It is
not a CORS allowlist any more: the function is same-origin, so no CORS headers are
needed.

The two abuse limits are optional and have those defaults. The room cap counts only
members active in the last 30 seconds and is enforced atomically in `join_room` under
a room row lock; an inactive guest frees a slot, and the host can remove a guest. The
sign-in limit is checked before Better Auth, uses the first `x-forwarded-for` address,
and stores only an HMAC-SHA-256 of it. If the limiter store is unavailable, sign-in
fails closed with a 503. Raise `ANON_SIGNIN_LIMIT_PER_HOUR` for a venue network that
expects more than 120 new guests in an hour.

YouTube's current quota model is split. `search.list` has its own bucket of 100 calls
per day at one unit per call. Both user searches and the karaoke strip use it: the
defaults are 90 user searches plus 6 strip refreshes, and the deploy guard rejects a
pair that exceeds 100. User searches are cached for ten minutes; the strip asks for
embeddable karaoke videos with lyrics, drops medleys and compilations, caches a pool
of up to twenty for twelve hours, and serves each screen a random eight-song
selection. Per-user, per-room, and global limits sit in front of
the upstream call. oEmbed metadata is quota-free, but the add path still has a
per-member minute limit, a 500/day room budget, and a 5,000/day deployment budget.
The add path now runs a SQL preflight before spending either budget, and search falls
back to manual link entry when it is resting.

Preview deployments must not reuse the Production database URLs. Point Preview at a
Neon branch or a separate preview database, protect the deployment, and keep the
auth secret compatible with the inherited branch. A different preview secret requires
deleting the inherited `public.jwks` rows first. The function selects
`PREVIEW_DATABASE_URL` and `PREVIEW_AUTH_DATABASE_URL` whenever
`VERCEL_ENV=preview`; the deploy guard refuses a Preview build without both. Do **not**
set `BETTER_AUTH_URL` for Preview; the current deployment host is derived from
`VERCEL_URL` and trusted automatically. A Preview without `YOUTUBE_API_KEY` reports
search as not configured and shows the manual-link fallback.

The guard runs before every build. It rejects a missing or short
`BETTER_AUTH_SECRET`, missing PostgreSQL URLs for both roles, a missing or malformed
`ALLOWED_ORIGINS`, an out-of-range quota budget, a wildcard origin, an origin with a
path or trailing slash, and any `VITE_*` PostgreSQL URL.

### Region

`vercel.json` pins the function to `sin1`, the region of the Neon project. Keep the
two together; a function in another region adds a cross-region round trip to every
database call.

### Vercel Authentication

Turn Vercel Authentication off for the project, or guests will be redirected to a
Vercel sign-in page before they can join a room. An SSO-protected deployment also
fails `npm run verify:preview` with a message naming that cause.

## Step 5: Deploy and verify

The production deployment was approved and performed on 2026-10-23:

```bash
vercel deploy --prod
npm run verify:preview -- https://echo-karaoke-mocha.vercel.app
```

The verifier checks:

- the security headers and the CSP, including `connect-src 'self'`;
- that the HTML and the main asset contain no `postgresql://` string;
- the SPA fallback for a deep room route;
- immutable caching on the hashed asset;
- `/api/auth/jwks` returns a non-empty key set;
- a POST to an unknown `/api/*` route returns JSON `404`, not the app shell.

Then verify one real flow by hand: create a room, open the guest link on a phone, add a
song, and press play. The integration suite proves the same path against Neon, but it
does not prove the deployed cookies or the phone camera.

Deployment evidence from 2026-10-23:

- `verify:preview` passed against the production alias.
- A production sign-in returned 200 and set a session cookie.
- `/api/auth/token` returned 200 with a 739-character JWT.
- `/api/create-room` returned 201 with a 16-character room code, a 43-character host
  token, and role `host`.
- A Playwright flow created a room on desktop, joined it from a 390px guest viewport,
  saw the room name and queue, and appeared in the host roster.
- After a second anonymous session replaced the first, `touch-member` with the host
  pass returned 200, `host-room-read` returned 200, and the host ended the room.
- With temporary limits of 6 sign-ins per hour and 2 members, six sign-ins were
  allowed and the seventh returned 429 with `RATE_LIMITED` and `Retry-After`; a second
  guest was rejected with 409 `ROOM_FULL` and the existing guest rejoined with 200.
- The limits were restored to 120 and 50, the deployment repeated, and sign-in,
  create-room, join-room, and end-room returned 200, 201, 200, and 200.

## Step 6: CI

The workflow is `.github/workflows/ci.yml`. It needs one repository variable and five
repository secrets:

```bash
gh variable set NEON_PROJECT_ID --body "plain-queen-50704361"
gh secret set NEON_API_KEY --body "<neon api key>"
gh secret set NEON_DATABASE_URL --body "<owner direct url>"
gh secret set NEON_SERVICE_DATABASE_URL --body "<service_role direct url>"
gh secret set NEON_AUTH_DATABASE_URL --body "<echo_auth direct url>"
gh secret set BETTER_AUTH_SECRET --body "<ci-only secret>"
```

The Neon API key is created in the Neon console under account settings. It is only
allowed to create and delete branches in this project; do not reuse an organization
key.

The jobs:

1. `verify` runs typecheck, the unit suite, the build, and `npm audit`.
2. `database` creates a Neon branch through the API, applies the migration chain,
   runs the pgTAP assertions, and deletes the branch even on failure.
3. `integration` creates a second branch, applies the chain, deletes the inherited
   `public.jwks` rows so Better Auth generates keys for this run's secret, runs the
   operation suite, and deletes the branch.

Branches copy the parent's data. The CI secret can differ from production because the
integration job removes the inherited encrypted keys first. Branch names include the
run id and attempt, so two runs never collide.

The workflow ran green on `master` on 2026-10-23, including the heartbeat fix and the
abuse controls
([run 39873145755](https://github.com/Ediwow110/echo-karaoke/actions/runs/39873145755)):
`verify`, `database`, and `integration` all passed. The first CI attempt failed at
`db push` because Neon's branch URI carries `channel_binding`, which the Supabase CLI
connector sends as a server parameter. `scripts/neon-branch.mjs` now removes that
parameter from the branch URIs. A later run hit a one-second bucket boundary in
`ratelimit_test.sql`; the test now expires the stored window deterministically instead
of sleeping across the boundary.

## Step 7: The room sweep

When a room is created, the same request first calls
`cleanup_abandoned_rooms(now() - interval '30 minutes')` and
`cleanup_ended_rooms(now() - interval '2 days')`. A room whose members have not sent a
heartbeat for thirty minutes is deleted the next time somebody creates a room. Ended
rooms older than two days are deleted at the same time.

Both sweeps are best effort. A sweep failure is ignored so that a room can still be
created when the cleanup call fails. There is no required pg_cron job and no
five-minute guarantee; the interval is opportunistic.

## Step 8: The songbook catalog retention cron

`vercel.json` schedules `0 2 * * *` against `/api/cron/catalog-retention`. That call
runs `karaoke_catalog_retire_stale()`, which deletes catalog songs and channel cursors
older than 28 days, so synced YouTube metadata is never served beyond the 30-day
revalidation window even when the site is idle and no host refreshes.

That job only **removes**. Nothing schedules a refresh: `catalog-sync` runs when a host presses
**Refresh the songbook**, and the read filter serves only rows whose `synced_at` is inside 28 days.
So a songbook nobody refreshes empties itself on day 28 — that shrink is the read filter, not this
cron; the cron only sweeps the expired rows and their cursors out of the table. A full four-channel
walk costs up to 16 of the 40 daily units — three playlist pages per channel, plus one handle
lookup each on the first walk before the cursors exist, one unit per call (measured at 409 songs) —
so pressing the button once a day keeps a standing supply; the six-hour per-channel throttle means
extra presses report `skipped` rather than spending again.

The route accepts only `GET`, and only when `Authorization` equals `Bearer ` plus
`CRON_SECRET` compared with `timingSafeEqual`. It returns 404 outside Production, 405
for other methods, 401 on a mismatched bearer, and 503 if the secret is unset or
shorter than 32 characters. A database failure returns `{ ok: false }` with no
connection or query detail. It is matched in `api/router.ts` before Better Auth, so
cron traffic never creates an anonymous identity, and the operation is not in the
public registry.

Confirm it after deploying, from the deployed host:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://your-app.example/api/cron/catalog-retention
# 401 — reachable, and rejected without the bearer secret
```

Verified in a live process before any deploy: outside Production the same route answers **404**
even when handed the correct bearer token, and for `POST` as well — so a preview deployment cannot
run retention or be probed into it.

### Running the full app locally against a branch

`vercel dev` is the only working full-stack local path, and it reads `.env.local`, which names
production `main`. Repoint it by deriving branch URLs from the same credentials rather than
editing that file — Neon role passwords are project-wide, so a branch URL is the production URL
with the host swapped:

1. Create a disposable branch off `main` and note its endpoint host (direct and `-pooler`).
2. Copy `.env.local`, replace the hostname of each of the three URLs with the branch host
   (`DATABASE_URL` takes the pooled host; `AUTH_DATABASE_URL` and `NEON_DATABASE_URL` the direct
   one). Keep the credentials untouched and never echo the result.
3. Assert before use that no produced URL still names the production host, and that the owner-role
   URL uses the direct endpoint.
4. `npx supabase db push --db-url "$NEON_DATABASE_URL" --yes` to bring the branch to 0034, export
   the three swapped variables in the shell, then `npx vercel dev`.
5. Delete the branch afterwards. Neon computes do not auto-suspend on this project, so a leftover
   branch keeps billing.

`npm run test:integration` and `npx supabase test db --db-url` both accept the same swapped values,
which is how the songbook loop was proven against real YouTube without touching production.

Migrations 0031 (catalog tables and paging), 0032 (`playback_next_if_current`),
0033 (retention, RLS and the 28-day read filter) and 0034 (the same surface granted
to `echo_service`) must be applied before this tree serves traffic: the sync and the
cron both call functions 0033 installs. 0034 is not optional — the function layer
connects as `echo_service`, so without it every songbook call answers 500 while the
owner-run database suite still passes. Grant new functions to both roles from now on;
`supabase/tests/role_grant_parity_test.sql` fails if they drift apart.

Apply the **whole chain in one `db push`**, never a single file. 0031 defines
`karaoke_catalog_page` and 0033 replaces it with the version that hides metadata older than 28
days, so re-running 0031 on its own quietly removes that privacy filter and nothing errors — the
rows stay and the expiry disappears. Re-applying an edited migration must always be followed by
everything that overrides it; this happened during local work on 2026-10-25 and the retention
test is what caught it.

## Step 9: Shipping the songbook

Production `main` was at migration 0030 when this runbook was written. **Step 2 was executed on
2026-10-26** — 0031–0034 are applied (`{"latest":"0034","tables":2,"functions":7}`, and `echo_service`
executes `karaoke_catalog_page`), so read step 2 as already done and do not run it again. What remains
is step 1 (the secret), step 3 (the push) and step 4 (verify the origin, probe the cron, seed, prove
playback). Run what is left in order; nothing after it is safe to skip.

If step 1 is not yet available, **do not push** — the build command refuses a production build
without `CRON_SECRET`, so a push fails rather than shipping. Applying step 2 alone is a separate
question, and it is safe in the narrow sense: the deployed commit (`badd036`) references no catalog
object at all (`git grep` for `karaoke_catalog`, `catalog-page`, `catalog-sync`,
`playback_next_if_current` across its `server`, `src` and `api` trees: zero hits), and the only
non-catalog object in 0031–0034 is `playback_next_if_current`, which that code never calls. So the
schema can sit ahead of the app without changing how the running app behaves — which is why the
grants in 0034 are needed even though nothing calls them yet.

1. **Create `CRON_SECRET`** (at least 32 random characters) in the Vercel Production environment.
   Pipe it so it does not land in shell history or a transcript:

   ```bash
   openssl rand -hex 32 > secret.txt
   npx vercel env add CRON_SECRET production --force --sensitive < secret.txt
   rm secret.txt
   ```

   Generating it in the shell keeps the value out of chat and shell history, and `--sensitive`
   stores it as a Vercel Secret, listed as `Hidden` afterwards. Rehearsed 2026-10-26 with a
   throwaway name on this project: the piped form adds without any interactive prompt, and
   `npx vercel env rm <NAME> production --yes` removes it just as cleanly, so neither half needs the
   dashboard. The probe variable is gone — Production lists the same eight names it did before.

   Without it `npm run verify:deploy` refuses the build (proved: it is the only remaining
   complaint once the other variables are set) and the daily retention run answers 503. A new
   environment value only reaches a running deployment through a new deployment, so add it before
   pushing, not after.

2. **Apply 0031–0034 to production `main`.** `server/.env.neon`'s `NEON_DATABASE_URL` is the owner
   credential **for production**, so this command writes to production — confirm the hostname is
   `ep-long-leaf-b3708f3l` before running it, and never point `supabase test db` at it (the pgTAP
   fixtures create and delete rows; they belong on a disposable branch).

   Confirm the pending set first — `--dry-run` reads the remote history and applies nothing
   (measured 2026-10-26 with CLI 2.122.0: it printed exactly these four files, and `main` was still
   0030 with zero catalog objects afterward). The CLI warns that `--db-url` must be percent-encoded;
   the production URL in `server/.env.neon` passes as it is.

   ```bash
   npx supabase db push --dry-run --db-url "$NEON_DATABASE_URL"
   ```

   If that lists anything other than 0031 through 0034, stop: the remote is not where this branch
   expects to find it.

   ```bash
   npx supabase db push --db-url "$NEON_DATABASE_URL" --yes
   ```

   0034 must be included: it grants the catalog and `playback_next_if_current` to `echo_service`,
   the role the app actually connects as. Without it every songbook call answers 500 while the
   owner-run database suite stays green.

3. **Deploy** by pushing `master`. Note this branch also carries the two local-only `master`
   commits (`9dc5396`, `54b8478`) that were never shipped. They are not inert: `9dc5396` is a host
   playback feature — handing the host to the party view and ending a song early — that added 95 lines
   to `HostPlayer.tsx`, the same component that owns the auto-advance, so watch for a regression there
   and not only in the songbook. `54b8478` only deletes a retired Supabase-era dev-tunnel script.
   Read the whole push as three things shipping at once — the songbook, that playback feature, and the
   hardening batch — which is why the post-deploy checks below include the ordinary host flow, not just
   catalog calls.

   **That warning earned its keep.** Proving the songbook in a real browser found exactly such a
   regression, invisible to every automated gate: the YouTube IFrame API replaces the element it is
   handed, `HostPlayer` gave it a div React rendered, and the next client-side navigation that
   inserted a sibling threw `NotFoundError: insertBefore` and dropped the host screen to the error
   boundary. Fixed in `c66aa8a` by letting the factory own a throwaway child node, with a test that
   reproduces the same DOMException against the old code. The lesson worth keeping: a suite that mocks
   the API can never see a conflict between that API and the reconciler.

   Nothing else in this tree can fail the build, and that is measured rather than assumed.

   **What this deploy changes for rooms that are already running.** When a video ends in an open host
   tab, the queue now advances by itself. Before this push nothing does that: the operation exists only
   after 0032, and the deployed front-end never sends the field that triggers it. The path is guarded —
   `HostPlayer.advance()` refuses unless the video it loaded is still the room's current song,
   `playback_next_if_current` re-checks that song under the room lock, the client latches one advance
   per song id, and a refusal shows as a stalled-advance state instead of silence. But **there is no
   host setting that turns it off**: `HostSettingsPage` exposes only the guest-control and
   guest-playback locks. Treat it as a product decision to ship, not a silent side effect — if you
   want a per-room switch, that is a follow-up, not something to bolt on mid-ship.
   `npx vercel build --prod` run locally on 2026-10-26 completed in 32 s: `verify:deploy` passed once
   a ≥32-character `CRON_SECRET` existed (any value satisfies the length check — the guard does not
   compare it to anything), the Vite bundle built, and `api/router.ts` packaged into
   `.vercel/output/functions` at 7.6 MB. The same run **without** the secret died on the first
   command with `BUILD_UTILS_SPAWN_1`, which is what a pushed deploy does in production too: the
   missing secret is the only build blocker. Note that Vercel withholds stored secrets from local
   builds, so running this yourself means supplying `BETTER_AUTH_SECRET`, `DATABASE_URL`,
   `AUTH_DATABASE_URL`, `ALLOWED_ORIGINS`, and a throwaway `CRON_SECRET` in the environment — and
   `.env.local` wraps `AUTH_DATABASE_URL` in single quotes, which survives a naive shell export.
   The build output carries no credentials: none of the four production values appears in any file
   under `.vercel/output`.

4. **Verify on the live origin:**

   ```bash
   npm run verify:preview -- https://echo-karaoke-mocha.vercel.app
   curl -s -o /dev/null -w '%{http_code}\n' https://echo-karaoke-mocha.vercel.app/api/cron/catalog-retention
   ```

   Before the push, `verify:preview` fails **exactly two** checks on production (measured
   2026-10-25, re-measured 2026-10-26 with the same two lines and nothing else): `referrer-policy
   does not contain strict-origin-when-cross-origin` and `The
   kara-echo title is missing from the HTML`. Both are the branch's own values asserting themselves
   against the older deployment — every other check (headers, CSP, SPA fallback, asset caching,
   credential-free HTML, JWKS, JSON on an unknown `/api` route) passes, so the live origin is
   healthy. Treat those two as the ship's signal: after a successful deploy they must clear, and if
   they still fail the new build is not the one being served. Expect nothing else to differ.

   Before blaming the app for a song that will not play, know that the top of the list has been
   checked for embeddability: `karaoke_catalog_page` sorts by `published_at desc`, so the first songs
   a tester meets are the newest uploads. Probed 2026-10-26 with the quota-free oEmbed endpoint
   against the 15 newest items in `@musisikaraoke`'s uploads playlist — 15 of 15 embeddable, none
   refused, and one `playlistItems` unit spent straight from the key's daily allowance rather than
   the songbook's internal 40-unit budget. An oEmbed refusal normally means the uploader switched
   embedding off, which is content, not a broken ship; the client already reports it as a player
   error instead of a silent freeze. Only the largest channel's newest 15 were checked.

   Expect `401` from the cron — reachable, and rejecting an unauthenticated caller. Then open a
   room as host, press **Refresh the songbook**, and confirm the note reports songs added with no
   "could not find" clause; the first run fills roughly 400 rows from four channels for about 16
   quota units, and browses afterward cost nothing. A dead or quota-exhausted key does not look like
   a failure there — it looks like a refresh that added nothing — so spend one unit before the
   sixteen: one `channels.list?forHandle` call with the key `YOUTUBE_API_KEY` carries must answer
   `200` with exactly one item. Measured 2026-10-26: `@musisikaraoke` returns `Musisi Karaoke` with
   uploads playlist `UUJw1qyMF4m3ZIBWdhogkcsw`, the same id the plan's probe table records. Do it
   with the key read from the environment rather than typed, so it stays out of shell history.

   If a press stops before every channel is filled — the eight-second budget can cut a walk in the
   middle of a playlist — press again rather than waiting. A channel whose stored page token is still
   pending resumes from that token; the six-hour throttle only holds a channel that was brought fully
   up to date, because `karaoke_catalog_cursor_save` stamps `last_synced_at` on every page and the
   finish is told apart by the token, not the timestamp.

   Before the push, both songbook routes answer **`404` `That operation is not available`** on the
   live origin (measured 2026-10-25). After a correct ship they answer **`401`**, because the
   session check runs before dispatch. A `500` instead means the code deployed but the migrations
   or 0034's grants did not — so this one request separates "not shipped", "shipped correctly" and
   "shipped without the database", which is otherwise easy to misread as a runtime bug:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://echo-karaoke-mocha.vercel.app/api/catalog-page \
     -H 'content-type: application/json' -H 'origin: https://echo-karaoke-mocha.vercel.app' \
     -d '{"roomId":"00000000-0000-0000-0000-000000000000"}'
   ```

**Rolling back** is cheap because every catalog object is additive: redeploy the previous commit to
drop the feature from the app and leave the tables and grants in place. Do not drop `karaoke_catalog`
to undo a deploy — 0033's RLS and grant hygiene is what keeps the metadata unreachable by the anon
and authenticated roles.

### Already verified, so you do not re-check it

- **Production has no grant drift today.** Read-only comparison on `main` found zero functions
  reachable by `service_role` and unreachable by `echo_service`. The rotation copied everything that
  existed at 0030; 0034 is needed only because 0031–0033 land on top of that copy. Checked the other
  direction on 2026-10-26 as well, because it is the one that can redden the push: read every ACL
  with `aclexplode` on `main` and all 32 functions `echo_service` may execute are named explicitly
  (none lean on default `PUBLIC` execute, which is why `anon` is denied), and every one of those 32
  names appears in a `grant execute` statement in the migration chain. So the freshly migrated branch
  CI builds will grant what production already has, and the runtime-role grant gate cannot fail there
  for a reason it passes here.
- **The cron schedule is allowed on every plan.** `0 2 * * *` runs once per day, which satisfies the
  Hobby restriction that cron expressions running more frequently fail during deployment. A
  more frequent schedule would break the build on that plan.
- **Vercel's rewrite cannot swallow the cron path.** `/api/(.*)` is matched before the SPA fallback,
  and the fallback's negative lookahead already excludes `api/`. `restoreApiRequest` rebuilds the
  pathname as `/api/cron/catalog-retention`, which is what the router compares — covered by
  `tests/unit/catalogRetentionRouter.test.ts` using the real rewrite helper, not a mock.
- **CI has everything it needs on the remote, and the push cannot conflict.** The repository
  variable `NEON_PROJECT_ID` and the secrets `NEON_API_KEY`, `NEON_DATABASE_URL`,
  `NEON_SERVICE_DATABASE_URL`, `NEON_AUTH_DATABASE_URL` and `BETTER_AUTH_SECRET` are all set, and
  there is **no** `YOUTUBE_API_KEY` in CI — which is exactly the condition the local simulation ran
  under, so the search assertions behave identically. Both `master` and `origin/master` are already
  ancestors of the feature branch, so the push is a fast-forward and cannot produce a merge
  conflict.
- **The sync's eight-second budget needs no `maxDuration` config.** Vercel Functions default to
  300 seconds on every plan under Fluid Compute, which is enabled by default, so the refresh path
  and its drain sit far inside the platform limit. Checked against Vercel's duration limits on
  2026-10-25 — do not add a `maxDuration` to "fix" a timeout that cannot occur.
- **The first refresh is bounded**: four channels, at most three pages each, roughly 400 rows and
  about 16 quota units, against a 40-unit daily cap. Browsing the songbook costs nothing.
- **Every RPC the operations name is executable by the runtime role on production.** Audited
  2026-10-26 by reading `pg_proc` as the owner for all 28 names enumerated from `server/operations`
  (not just the songbook's five): `echo_service` and `service_role` can execute each one, `anon` can
  execute none, and both catalog tables carry `SELECT/INSERT/UPDATE/DELETE` with row security on. The
  seed path (`karaoke_catalog_cursors`, `karaoke_catalog_upsert`, `karaoke_catalog_cursor_save`) was
  the part worth checking, because the integration suite only ever *executes* `karaoke_catalog_page`
  and `karaoke_catalog_upsert` as that role — `catalog-sync` is rejected for lack of a key before it
  reaches the database. That gap is now a gate: the suite enumerates the call sites from source and
  asks the database what `current_user` may execute, so a new RPC without a grant fails CI instead of
  failing a host's refresh. Proven to have teeth by planting `operationCall('temp_probe_rpc', [])`
  into an operation file, which failed the run naming that RPC; the privilege half discriminates
  because `anon` reads false for the same functions `echo_service` reads true on.
- **The deploy does not log anyone out.** `server/auth/auth.ts` is in the diff, and its only change
  is `appName: 'ECHO'` → `'kara-echo'`. In the installed Better Auth, `appName` is stored on the
  context and consumed at exactly two places, both the fallback TOTP issuer for two-factor
  authenticator URLs — it is not part of session tokens, cookie naming, or secret derivation, and this
  tree has **zero** call sites for two-factor, TOTP, or multi-factor. `BETTER_AUTH_SECRET` is
  unchanged, and none of 0031–0034 touches an auth table, so live rooms keep their sessions and host
  passes across the deploy. The other file on every request's path, `api/router.ts`, gains one exact
  `pathname === '/api/cron/catalog-retention'` guard ahead of the auth branch; every other path falls
  through untouched. If two-factor is ever added, that issuer string becomes the thing a re-brand
  changes for already-enrolled authenticators.
- **Every environment variable the Function reads is present in Production except
  `CRON_SECRET`.** Enumerated from `server/` and `api/` including the dynamic
  `process.env[name]` budget reads: `DATABASE_URL`, `AUTH_DATABASE_URL`,
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS`, `YOUTUBE_API_KEY` all set;
  `VERCEL_URL`/`VERCEL_PROJECT_PRODUCTION_URL` are injected by Vercel; the four
  `YOUTUBE_DAILY_*` and two abuse-limit variables fall back to documented defaults;
  `PREVIEW_*` apply only to preview. `CRON_SECRET` is the one gap, and it fails loudly
  (503 on the cron, build refused) rather than silently.
- **No other read path disguises a broken deployment as empty data.** The keyless
  songbook fallback used to swallow every database error and answer "no results"; it now
  tolerates only SQLSTATE 42883 (not yet migrated), so a denied grant reaches the host as
  a 500 instead of an empty list.
- **All four CI jobs were simulated on a fresh branch off `main`** (2026-10-25): the full
  0001→0034 chain applies, `npx supabase test db` reports 328/328, and `npm run test:integration`
  reports 8/8 connecting as `echo_service` **without** a YouTube key — the same conditions CI runs
  under. `npm audit --audit-level=high` is clean, and locally `tsc`, 429 unit tests, the build and
  16 mocked UI flows pass. The push should be green; if it is not, the difference is in CI's
  environment, not in this tree.

### What the app-level live proof showed (and what it cost)

Running the real flow with the real key on a disposable Neon branch seeded **409 songs** and walked
filter → chip → queue → play → auto-advance, which is how 0034's missing grants were found. Do not
re-run that casually: `catalog-sync` spends real quota and the branch's catalog rows make the
catalog fixtures in `supabase/tests/catalog_test.sql` fail (they assume a clean table), so reuse a
branch for the app-level proof only, or expect those four assertions to complain.

## Verification checklist

- [x] `npx supabase test db --db-url "$NEON_DATABASE_URL"` reports 328 passing assertions on a fresh branch.
- [x] `npm run test:integration` passes on the same branch, as `echo_service`.
- [x] `npm test` reports 429 passing tests on the current tree.
- [x] `npm run build` passes on the current tree.
- [x] `npm run test:e2e:ui` reports 16 passing tests on the current tree.
- [ ] `npm run verify:deploy` passes with the production environment. **It cannot pass today.**
  Measured 2026-10-26 with every other production variable loaded and `CRON_SECRET` unset, the
  guard's only complaint was that missing secret — so this line was checked while false, and it is
  the one that tells you whether the build will be refused. Tick it after the secret exists.
- [x] 0031–0034 applied to production `main` (2026-10-26): remote history reads 0034, two catalog
  tables and seven catalog functions exist, and `karaoke_catalog_page` executes as `echo_service`
  rather than merely being granted to it. This line is new — without it the next reader has nothing
  marking step 2 as finished, and a re-apply looks plausible.
- [x] `npx vercel build --prod` completes locally with the guard satisfied, the router packaged as a
  Function, and no credential in `.vercel/output` (2026-10-26). Fails on the missing secret alone.
- [ ] `vercel deploy --prod` builds with the guard enabled.
- [ ] `npm run verify:preview -- https://echo-karaoke-mocha.vercel.app` passes.
- [ ] A browser host/guest flow works with a 390px guest viewport.
- [ ] A host heartbeat survives an auth session replacement on the live site.
- [ ] The live sign-in limit returns 429 at the cap and the room limit returns 409.
- [ ] A physical phone can scan the camera QR and run the same flow.
- [ ] The CI workflow runs green on `master` after a push.

## Not covered here

- The YouTube Data API key. Configure it to use search-based song entry; without it,
  search and karaoke picks report that they are not configured, and the search panel
  offers the manual-link fallback.
- Per-IP sign-in throttling in front of Better Auth.
- A physical-phone camera run against this tree.
- A production deployment of this tree; the live alias predates it.
