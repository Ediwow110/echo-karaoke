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
  0001→0035 chain applies, `npx supabase test db` reports 345/345, and `npm run test:integration`
  reports 8/8 connecting as `echo_service` **without** a YouTube key — the same conditions CI runs
  under. `npm audit --audit-level=high` is clean, and locally `tsc`, 447 unit tests, the build and
  16 mocked UI flows pass. The push should be green; if it is not, the difference is in CI's
  environment, not in this tree.

### What the app-level live proof showed (and what it cost)

Running the real flow with the real key on a disposable Neon branch seeded **409 songs** and walked
filter → chip → queue → play → auto-advance, which is how 0034's missing grants were found.
`catalog-sync` spends real quota, so don't re-run it casually. The old follow-on hazard — a branch
holding catalog rows broke four assertions in `supabase/tests/catalog_test.sql`, which assume they
are the only songs in the table — is closed: that file now clears the table first, inside its own
`begin; … rollback;`. It had to be closed, because once the songbook went live **every** CI branch
inherits the seeded rows from `main`, and the `database` job on `master` went red for exactly that
reason: four failures, all of them the fixtures meeting real data they never expected.

### The guest-to-handoff chain, proven on production (2026-10-26)

The last two unverified behaviors closed in one room ("Handoff Proof"), with the host in
one browser and the guest in a second, isolated one:

```
23:27:13 join  guest Meow
23:28:12 add   guest → When I Was Your Man      POST /api/queue-command 201
23:28:54 add   guest → Umbrella                 POST /api/queue-command 201
23:31:46 skip  member_id: null                  ← the automatic advance
queue_songs: row 1 played, row 2 playing
```

The guest joined by code, queued two karaoke picks, the host tab auto-opened party view playing the
guest's song with "Added by Meow", and 213 s later — a 3:36 video ending through the 5-second early-end
rule — `advance_queue` handed off with nobody pressing next. `member_id: null` on the `skip` is what
separates an automatic advance from a host skip. The settings screen also offered "Hand the room to
Meow" with a live roster, so the transfer UI is confirmed reachable against real data.

**Two limits on that proof, stated rather than glossed.** The guest browser's synthetic clicks never
reached React's handlers, so its join and queue actions were dispatched through the DOM instead; the
server logged ordinary `200`/`201` traffic, which makes that a harness limitation and not an app
defect. And that browser could not be resized, so the guest flow ran at desktop width — the checklist
line about a **390px** guest viewport stays unticked, even though the narrow layouts were measured
separately the same day.

**A second instance of the teardown rough edge.** Ending the room logged a `409` from
`playback-command`: the player's unmount cleanup tried to pause a room that had already ended. Same
shape as the `403` a demoted host's tab logs after transfer-host — a pause attempt with a pass that is
no longer valid. The refusal is correct; the console noise is the bug, and one guard should cover both.

## Transfer host (migration 0035, shipped 2026-10-26)

A host can hand the room to any guest whose remote is still connected, from **Room settings →
crown icon**. Control genuinely moves: the outgoing host's pass stops working at that instant and
they are demoted to a guest with a pass of their own, rather than being dropped out of a room they
are still watching.

Proven against production with two separate browser profiles, not just in tests. The host clicked
**Hand it over**; their tab landed on the guest remote showing "Hosted by Rafa" with no host pass
left in storage; the receiving guest's remote grew a "You are the host now" panel, and opening the
host view from it worked — nav, invite QR, search and queue all live. Production then read
`Qoder/guest`, `Rafa/host`, `HOST_COUNT 1`, and a `transfer_host` room event at the moment of the
click.

**Why it is two calls.** The host pass is stored only as a digest, so the database cannot hand it
back, and the replacement may only ever be returned to the device that minted it. `transfer-host`
revokes and flips roles; `claim-host` mints the new pass on the incoming host's own device using
the guest credential they already hold. The gap between them is a second or two with no usable host
pass, which is deliberate: an unusable window beats a window where two devices can both skip.

**One rough edge, understood rather than hidden.** The demoted host's tab logs a `403` from
`playback-command`: the player's unmount cleanup tries to pause the room with the pass it no longer
holds. The refusal is the correct outcome — a guest should not be pausing the room — but it is a
console error, and silencing it means skipping the unmount pause when the tab was demoted rather
than closed.

## Narrow screens (shipped 2026-10-26)

The owner's screenshot showed `kara-echo` folded across two lines in the stage header at 320px, with
the back arrow and Party view pushed apart. The wordmark was a fixed `2.05rem` in a flex row, so on a
phone it had no room and wrapped instead of yielding. `src/ui/Logo.tsx` now clamps each size to the
viewport, forbids the break, and lets the bars refuse to shrink; the stage header drops the wordmark
below the small breakpoint, as the host header already did, because there the brand competes with
actions a person needs to hit.

Measured on the live origin at 320px — stage, party, host discovery, guest, home, settings and the
songbook (30 rows): no element wider than the viewport outside a clipped container, no text whose
scroll width exceeded its box, and the brand either absent (stage) or on one line everywhere else. At
640px, where the stage wordmark returns, the header is one 65px row with 24px of slack. The only
horizontal scroll anywhere was 10px at a 320px *desktop* window, where `body { min-width: 320px }`
holds the floor against the classic scrollbar; with the scrollbar removed the document measures
exactly 320, so a real phone at 320pt does not scroll sideways.

`tests/unit/logo.test.tsx` holds the contract: the wordmark never wraps, all three sizes stay fluid,
the bars keep `shrink-0`, and header-specific classes land on the text only. Red-proved by restoring
the pre-fix `Logo.tsx` — four assertions fail, and the fifth (the stage header's own class) does not,
which is the shape of the bug.

**Tap targets: the guest remote is clean, the host screen is not, and that is a decision rather than
a defect.** Measured at 390x844 on 2026-10-27 by listing every control under 44px in the rendered
page. The guest remote returns **zero** undersized targets on queue, songbook and search, and the
suite enforces that (`guest remote keeps 44px targets and fits a phone`). The host queue page at the
same width returns sixteen, none of them new: the logo 21x24, "Party view" and "Room settings" 36px
tall, "Back to home" 32x32, the reorder arrows and row remove 32x32, and two inline links --
"Add more songs" and "Full queue" -- at **17px**. The recorded convention is "guest-facing controls
keep a 44px minimum target; host big-screen controls may stay compact", so the 32-36px items are the
design, and the vote control added with `0ac6a64` (41x32) is larger than the row controls beside it.
The 17px links were the one part that wording does not cover: a prose link is not a dock control, and
17px is below even WCAG 2.5.8's 24x24 floor. **Fixed on 2026-10-27**: seven controls were raised to a
24px minimum across the four host screens (the prose links, the stage's Queue link and Save toggle,
and the phone-width logo), and `no host link or button is smaller than the 24px target floor` now
walks discover, queue, stage and settings at 390px so a new one cannot slip in. The stage's seek
slider is deliberately outside that gate -- it is a range input with a different shape, and nothing
here claims it was changed.

## Landing identity and the roomless nav (shipped 2026-10-26)

**No name until one is typed.** `karaoke.profile.name` survived the blank field: the landing
sidebar, the collection pages, the join form, `Sidebar` itself and `HostRoomPage` all read it, so a
shared TV still opened by announcing whoever last used it. Identity now comes only from what is typed
in this session, or from the room's own roster once you are inside one, and the storage helper is
deleted because nothing reads it. The accepted cost is retyping your name each visit, including on the
join screen.

**The nav before a room.** Four room-only destinations used to sit greyed out beside the live ones,
which read as a broken sidebar rather than a room that hasn't started. The nav now carries Create room
alone, plus the page a visitor arrived on so a bookmark to the library never shows a nav hiding where
you are, and all eight return the moment there is a room to point them at. The placeholder branch is
gone with it.

**Proven on production after the push, not just in jsdom.** Cold landing: one nav link, zero
placeholders, brand at 27.2px inside a 40px nav row. With `karaoke.profile.name` still holding `Qoder`
in that browser, typing "Rafa" moved the sidebar identity and nothing rendered the stored name.
Creating a room brought all eight links back with zero console errors. `tests/unit/sidebarNav.test.tsx`
and `sidebarIdentity.test.tsx` hold both rules; two of the nav assertions were red beforehand.

## Moderated entry (migration 0037, shipped 2026-10-26)

A host can require approval for each new guest, admit or reject them from **Room settings → At the
door**, and close the door to arrivals mid-party. The gate is SQL, not UI: a pending member's
`read_room_guest` returns only `{roomId, status:'waiting', room:{name,hostName}, viewer}`, and
`private.require_guest` — which every participating operation already goes through — refuses a
non-active member with `ROOM_PENDING`. Exactly three paths stay open to a waiting guest: the room read,
`touch-member` and `room-access-check`.

**Proven on production with three isolated browser contexts** (host at 1920, guests at 390):

- Waiting: "WAITING AT THE DOOR / Door Proof / Rafa needs to let you in. This screen opens by itself
  once they do." — zero iframes, no queue text.
- Host: header badge "2 AT THE DOOR"; settings listed both names with Let/Keep controls.
- Approve: the same guest tab flipped to the live remote within one poll, no reload.
- Lock: a new context's join answered "The host has closed the room"; the admitted guest could still
  rejoin, which is the exemption the lock deliberately keeps.
- Reject: the rejected tab's next poll showed the revoked-pass screen ("Your room pass is no longer
  valid…"), which is the ruled behaviour below.
- Event rows: `approve` with the member id, `reject` with `member_id` null and the name in the
  payload — required, because `room_events` cascades from `members` and an attached event would
  delete itself with the row.

**Two decisions worth knowing.** A rejected guest gets the revoked-pass screen, not a named message:
rejection deletes the row, and naming the host would need a tombstone kept per rejection — a ban list
by another name, and a lie for anyone whose pass was rotated. And the door lock exempts anyone the
room already knows, so a waiting guest can rejoin to refresh a lost pass; only strangers are refused.

**The create form stopped asking (0038, 2026-10-26).** Every new room now moderates entry: the
three permission switches left the landing page, approval defaults on, guest playback stays locked,
and guests always add songs — the add-songs control is gone from Room settings too. Approval is
changed in settings, and turning it **off admits whoever is already waiting** rather than leaving
them at a doorbell nobody answers. `0038` must be applied before this build ships, for the same
reason as `0037`.

**Deploy order is load-bearing.** The server calls the nine-argument `create_room` and the door
functions, so `0037` must be applied before the build ships — the reverse order breaks room creation
outright. The old client tolerates the new fields, so the window only affects a guest tab that
reloads mid-deploy.

**Voting reaches the room (0039, 2026-10-27).** The server has counted votes since `0005` and three
screens have promised guests could cast one, but no screen ever sent `vote-command`. Queue rows now
carry a ThumbsUp with the count, filled when this member has seconded the song. `0039` threads the
viewer's member id into `private.room_queue` and drops the one-argument form, so the queue can never
again be projected without saying whose view it is. Apply it with this build: the redefined reads
answer the currently deployed build exactly as before plus one field per row, so either order is
safe -- but a build shipped without the migration shows counts that never fill.

**Three facts about that path, measured on production `main` on 2026-10-27 rather than assumed.**
`vote_toggle(uuid, text, text, uuid)` is executable by `echo_service` and denied to `anon`, so the
feature will not meet the 42501 that caught the songbook before 0034 -- and CI's own grant gate
(`tests/integration/operations.test.ts`) enumerates the operation names from source, so it covers
this call without a list being edited. `members_room_user_key UNIQUE (room_id, user_id)` holds, which
is what lets `0039`'s host read resolve the viewer's member row by user id with a `limit 1` safely.
And production already has the `0037`/`0038` columns (`require_approval`, `admissions_locked`,
`members.status`), so the unchecked "apply 0037 to production" box in the moderated-entry plan is a
stale checkbox, not a live breakage.

**Not verified:** a second human on a real phone, and screen-reader announcement of the waiting status
(the unit test asserts the role, not that it is announced).

**Known rough edges, deferred deliberately:** with two guests at the door, only the row being acted on
shows a spinner (the others disable); the waiting screen has no offline signal and no way out except
the browser's back button; and the door list fetches `online`/`joinedAt` without rendering them, so a
host cannot yet tell who is still watching from who walked away.

## What protects the API from a browser console (2026-10-26)

DevTools holds the page's own session, so "only the UI calls the API" was never a control. The
layers that are real, each checked in source and one of them proven live:

- **A budget per session**, at the shared dispatch point: 300 requests a minute per anonymous
  session, then `429 RATE_LIMITED` with "Slow down: too many requests from this session". It sits
  after identity (an unauthenticated flood never reaches the counter) and before the switch (an
  operation added later inherits it). 300 is the product's own worst case plus headroom — the
  songbook filters on a 200ms debounce — not a comfortable average.
- **No credential that works alone.** The session cookie is `httpOnly` (`document.cookie` is empty
  on the live origin), the access token lives only in a module variable, and no `VITE_`-prefixed
  variable exists anywhere, so no server secret can be baked into the bundle. The room passes are in
  `localStorage` and readable — but every operation re-checks the pass **and** the authenticated
  user id in SQL, so a copied pass without the cookie authenticates as nothing.
- **Same-origin only**: the CSP's `connect-src` is `'self'` plus YouTube, so a page cannot post the
  API anywhere else.
- **Server guards still apply to every call**: POST-only with a 405, an operation allowlist with a
  404, `requireAnonymousCaller` before dispatch, per-room host/guest capabilities, a 4KB JSON-object
  body cap, and a cron that is production-only, GET-only and timing-safe.
- **Dev mode does not widen any of it.** The dev proxy points at the local function runtime
  (`VITE_API_DEV_ORIGIN`, default `127.0.0.1:3002`) instead of port 3001, which on this machine is
  another project's server; and the client's development log prints operation, status and duration,
  with a test that it never prints a pass or a body.

**Proven live:** from the page's own session, 290 `guest-room-read` calls returned 200 and request
291 returned the 429 body above; a minute later the same call returned 200 again, so the budget
throttles rather than locks out.

**What this does not do:** it does not stop someone who copies an `httpOnly` cookie out of the
Network panel — that is the session, by definition — it does not replace a WAF against many
sessions at once (anonymous sign-in is capped per network), and a local dev server pointed at the
production database is still a mistake the code cannot detect.

## The create action opens the create form (committed 2026-10-26, NOT DEPLOYED as of 2026-10-27)

**Status correction, measured not remembered.** This section's heading used to say "shipped", and it
was wrong: production still serves `862e747`, whose sidebar still links "Create room" to `/`. Proven
twice on 2026-10-27 by fetching the live origin and grepping every served chunk for `/create` and
`Back to the room` -- zero hits in all 35, while the positive controls "Create room" and "Join the
room" both match. Everything below is committed on `feature/songbook` and waits on the push.

**What was wrong.** The sidebar's "Create room" was a plain link to `/`, so a host who clicked it
while hosting a room landed on the landing page. On a wide screen that page happens to be the create
workspace, which is why the bug read as "the host suddenly goes to home". On a short window — 1024x600,
a laptop at 125%, or any phone — the landing page opens in join mode, so the action named "Create
room" answered with **"Join the room."** and no create form at all. The room being hosted was left
behind as well: the host screen owns the only player, so clicking the action tears the player down,
and the "My sessions" list that used to offer a way back was removed in `10d09e6` because it kept
listing dead rooms.

**The offer is not taken on one reading.** After this change the hosted-room offer is re-checked when
the tab becomes visible, when the network returns, and once a minute -- and a failed check keeps the
last known room rather than blanking the only way back. Before that it was one read at mount: a
blip removed the link until a reload, and a room that ended while the host sat on the screen stayed
offered. The screen also sends the room's heartbeat now: the host screen owns the only one, so offering
"Back to the room" from a screen that kept nothing alive let the sweep take the room while the link
still said it was there.

**What ships now.** `/create` is a route of its own and renders the create form in every viewport;
the landing page `/` keeps its join-first behaviour on a narrow screen. **Every** create action
points at that route — the sidebar's "Create room" item, the sidebar's "Start something good."
card, the collection pages' mobile action, the "Create a room" link in the songbook, and the
"Start another room" buttons — so no control that promises a new room can answer with the join
screen. The logo, which goes home, now says so: its accessible name is "kara-echo home" instead of
"kara-echo, create a room", which was a promise the landing page cannot keep on a phone.

The hosted room the browser
still holds a pass for is offered back as **"Back to the room"**, and **the server decides whether
it is still alive**: the offer appears only after a `host-room-read` answers `live`, and disappears
when the room has ended or gone. A local timestamp cannot answer that — the abandoned-room sweep
only deletes a room once *every* member has stopped heartbeating, so a room the host left an hour
ago can still be live, and a room the host left five minutes ago can already be gone. Ending a room
forgets its session, so an ended room is never offered and the last-room pointer never leads into
it.

**Proven against the running app, not only in jsdom.** A host created a room at 1440x900, resized to
1024x600, and clicked "Create room" in the sidebar: the URL became `/create`, the screen showed
"Make it your room." with the room name and host name fields, and there was no room code field
anywhere. "Still hosting Mock Night? Back to the room" carried the room's own URL, and following it
returned the host to the live host screen at 1024x600 and at 390x844, with no horizontal overflow.
When the same room was answered as ended, the offer was gone. Red-proved by restoring the pre-fix
`src/`: the same click landed on `/` and the check failed.

**One thing the review caught, worth keeping in mind.** React Router reuses a route element when
only the path changes, so the landing page and the create route are keyed separately. Without the
keys the landing page's join-first mode followed the host to `/create`, and the create route
answered with the phone join screen again — the same bug, one navigation deeper.

## Shipping the held work (rehearsed 2026-10-27, awaiting approval)

Every commit between the deployed `862e747` and this tree is held locally -- count them with
`git rev-list --count origin/master..HEAD`, since a number written here is stale the moment it is
committed. They carry: the create-route fix, the
navigation and party-heading honesty fixes, the songbook and queue wording fixes, voting with
migration `0039`, the clear-queue control, the browser gates, and the two playback-position fixes that
stop a video which has not started from rewinding the room, the stage status light that no longer
claims autoplay on a paused, empty or stalled room, and the API client refusing to treat an empty
answer as a room that ended, the promoted guest who keeps retrying a failed host-pass claim, the
handover dialog that stays open when a transfer fails, the songbook that no longer blames the
catalog for a failed search, the refused start that no longer jumps to a silent party view, and the
songbook refresh that no longer blames a channel for a spent daily budget, the search fallback that
keeps the reason it was asked, two error screens whose copy now says only what is true whatever
the cause, the per-network sign-in budget that now keys on the platform's own forwarded header
rather than one a proxy in front of the deployment can overwrite, and the songbook title decode that no
longer unescapes an entity twice.
Nothing is pushed -- the owner
answered "Hold the push, keep hunting" on 2026-10-27 -- so this section is the rehearsal, not the
order.

**Order, and why either direction is safe.**

1. `supabase db push --dry-run` against `main` must list exactly `0039_vote_viewer_flag.sql` and
   `0040_vote_host_identity.sql`, then `supabase db push`. **Rehearsed 2026-10-27 against production
   `main`:** the dry-run printed exactly those two files and nothing else, and the tracker read confirms
   the remote is at `0038`. Applying first is safe under the build that is running: `git grep room_queue
   origin/master -- server/` returns nothing, so the deployed Function only calls
   `read_room_guest` / `read_room_host`, whose signatures `0039` preserves. The old build ignores the
   extra field on each queue row.
2. `git push origin HEAD:master`. Rehearsed with `--dry-run` at `24bd328`, which printed
   `862e747..24bd328  HEAD -> master` -- a clean fast-forward, no force, no merge.
3. Watch the CI jobs and the Vercel build, then prove the bundle actually changed rather than
   assuming it: `curl -s https://echo-karaoke-mocha.vercel.app/ | grep -o 'assets/index-[^"]*\.js'`
   must name a hash other than `index-CMmJCzWH.js`, and the served chunks must now contain `/create`,
   `Back to the room` and `vote-command`.

**Rollback is code-only.** Promote the previous Vercel deployment. `0039` needs no unwinding, because
the build being rolled back to was proven above to tolerate its output -- and do not re-apply it
afterwards either, since migrations here are forward-only and never edited once applied anywhere.

**`0040` is safe in either order too, for a different reason.** It adds a five-argument `vote_toggle`
that accepts a host pass and keeps the four-argument form as a delegate that passes `null`, so the
build still serving during the migration window keeps voting while the new build sends its host pass.
The same migration makes `read_room_host` resolve the viewer's member row by role instead of by user
id, which is what lets a host whose anonymous identity was replaced still see its own vote marked.
A later migration can retire the delegate once no deployed build calls it.

**Already settled, so nobody re-derives it under ship pressure:** `echo_service` may execute
`vote_toggle` and `anon` may not (measured on `main`); `members_room_user_key UNIQUE (room_id,
user_id)` holds, which is what makes the host read's member lookup safe; the whole `0001→0040` chain
replays from scratch locally with pgTAP 414/414.

## Verification checklist

- [x] `npx supabase test db --db-url "$NEON_DATABASE_URL"` reports 406 passing assertions on a fresh branch. **Stale as of 2026-10-27:** `0039` adds three, `0040` adds five (two of them pinning the host's own vote and its survival of an identity replacement), and the local stack reports 414/414 with the full `0001→0040` chain replayed from scratch. **Source-reconciled 2026-10-27:** the test files contain exactly 414 assertion calls — 201 `is`, 82 `throws_ok`, 45 `lives_ok`, 38 `function_privs_are`, 29 `ok`, 14 `table_privs_are`, 2 `isnt`, 2 `has_table`, 1 `has_column` — and none of them is an always-true `ok(true)`. **Re-run 2026-10-27 against the running local stack at
`e40ee16`:** `npx supabase test db --local` reported `Files=21, Tests=414`, `Result: PASS`.
**Fresh-chain replay 2026-10-27:** a scratch database built by applying `0000→0018` + `0020→0040` in
order (skipping only `0019`, because pg_cron may only be created in the database named by
`cron.database_name`, here `postgres`) ran 20 of the 21 test files with byte-identical results to the
migrated database — 383 assertion lines and zero failures. The single difference is
`abandoned_test.sql` (18 assertions), which tests the cron-scheduled sweep and therefore needs the real
database. That is the evidence that a database built from zero reaches production's shape, including
`0039` and `0040`. Re-run on a
disposable branch before the next ship — this line is the only one that proves a fresh database
reaches what production has.
- [x] `npm run test:integration` passes on the same branch, as `echo_service`. **Locally it needs
  `NEON_API_KEY` + `NEON_PROJECT_ID`** so `scripts/neon-branch.mjs` can create a disposable branch;
  neither is on this machine (2026-10-27), so the suite is CI-only here. A local Docker Postgres cannot
  substitute: the server's client is `@neondatabase/serverless`, which speaks Neon's HTTPS protocol and
  fails on a plain host with `Failed to parse URL from https://api.0.0.1/sql` — measured 2026-10-27
  against the local stack. Point it at production and it writes rooms — never do that.
- **Local stack ports moved to 55900–55909** (2026-10-27): Windows began excluding 55392–55491, which
  contains the old 55420–55429 range, so `supabase start` could no longer bind them. `supabase/config.toml`
  now uses api `55901`, db `55902`, studio `55903`, inbucket `55904`, analytics `55907`, pooler `55909`,
  shadow `55900`. Update any local `.env.local` that points at the old ports.
- [x] `npm test` reports 552 passing tests on the current tree (measured 2026-10-27 at `49cb2d3`).
- [x] CI itself is healthy before relying on it: `gh run list` on 2026-10-27 shows the last five runs on
  `master` all concluded `success` (latest `2026-10-26T03:41Z`), so the push runs against a working
  workflow rather than inheriting a broken pipeline.
- [x] `npm audit --audit-level=high` reports 0 vulnerabilities (measured 2026-10-27), and
  `package.json`/`package-lock.json` are unchanged since the deployed `862e747`, so the `verify` job's
  audit step and the lockfile are both already validated. The `ui` job's command is the mocked-UI suite
  above; the `database` and `integration` jobs need the Neon branch and run in CI only.
- [x] No credential-bearing file is tracked. **Verified 2026-10-27:** `git ls-files` shows only
  `.env.example`; `.gitignore` covers `.env`, `.env.*` and `.neon`; and a `git grep` for
  `postgres://user:pass@` across tracked files returns only placeholder fixtures on `.example` hosts
  (docs and four unit tests) — no real connection string. Re-run this before any push that touched env
  handling.
- [x] `npm run build` passes on the current tree.
- [x] `npm run test:e2e:ui` reports 56 passing tests on the current tree (measured 2026-10-27 at `49cb2d3`; the suite is two files, `ui-mock.spec.ts` and `ui-mock-moderation.spec.ts`, matched by `ui-mock*.spec.ts`). **Thirteen of those gates are mutation-proved** (2026-10-27): suppressing `clear_queue`, suppressing the vote call, pointing `buildJoinUrl` at `/j/`, shrinking one link below `min-h-6`, removing the empty-answer guard, closing the handover dialog regardless, navigating on a refused start, restoring the status pill's catch-all, dropping the host-pass retry, reporting the raw player clock while buffering, reporting a seek the player never made, and dropping the songbook's error gate — the last on **both** the host and guest songbook routes — each turned exactly one test red, on its own assertion — including the QR gate, which also navigates to the encoded URL and checks the join form. The suite is load-bearing rather than decorative.
- [ ] `npm run verify:deploy` passes with the production environment. **It cannot pass today.**
  Measured 2026-10-26 with every other production variable loaded and `CRON_SECRET` unset, the
  guard's only complaint was that missing secret — so this line was checked while false, and it is
  the one that tells you whether the build will be refused. Tick it after the secret exists.
  **Measured 2026-10-27: production is not the problem.** `GET /api/cron/catalog-retention` with no
  Authorization header answers **401**, which means the handler reached its bearer comparison — so
  `CRON_SECRET` *is* set in Vercel and the 02:00 retention job runs. Only the local environment this
  command reads lacks it. Do not "fix" production for this line.
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
