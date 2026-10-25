# Hosted Setup Runbook

Date: 2026-10-24
Status: `https://echo-karaoke-mocha.vercel.app` was verified on the 2026-10-23 tree.
The current working tree is uncommitted and includes quota, membership, player, and
accessibility changes; do not treat the live alias as proof of this tree. Every hosted
value below is named, never printed.

This runbook takes ECHO from the repository to a deployed, verified site. On the
current tree, typecheck, the production build, 264 unit tests, and 6 UI Playwright
tests pass locally. The pgTAP suite (283 assertions) and the operation integration
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

## Step 9: Shipping the songbook

Production `main` is at migration 0030, so the catalog does not exist there yet. Run these in
order; step 1 is the only one that is not a command, and nothing after it is safe to skip.

1. **Create `CRON_SECRET`** (at least 32 random characters) in the Vercel Production environment.
   Pipe it so it does not land in shell history or a transcript:

   ```bash
   openssl rand -hex 32 > secret.txt
   npx vercel env add CRON_SECRET production --force --sensitive < secret.txt
   rm secret.txt
   ```

   Generating it in the shell keeps the value out of chat and shell history, and `--sensitive`
   stores it as a Vercel Secret, listed as `Hidden` afterwards.

   Without it `npm run verify:deploy` refuses the build (proved: it is the only remaining
   complaint once the other variables are set) and the daily retention run answers 503. A new
   environment value only reaches a running deployment through a new deployment, so add it before
   pushing, not after.

2. **Apply 0031–0034 to production `main`.** `server/.env.neon`'s `NEON_DATABASE_URL` is the owner
   credential **for production**, so this command writes to production — confirm the hostname is
   `ep-long-leaf-b3708f3l` before running it, and never point `supabase test db` at it (the pgTAP
   fixtures create and delete rows; they belong on a disposable branch).

   ```bash
   npx supabase db push --db-url "$NEON_DATABASE_URL" --yes
   ```

   0034 must be included: it grants the catalog and `playback_next_if_current` to `echo_service`,
   the role the app actually connects as. Without it every songbook call answers 500 while the
   owner-run database suite stays green.

3. **Deploy** by pushing `master`. Note this branch also carries the two local-only `master`
   commits (`9dc5396`, `54b8478`) that were never shipped.

4. **Verify on the live origin:**

   ```bash
   npm run verify:preview -- https://echo-karaoke-mocha.vercel.app
   curl -s -o /dev/null -w '%{http_code}\n' https://echo-karaoke-mocha.vercel.app/api/cron/catalog-retention
   ```

   Expect `401` from the cron — reachable, and rejecting an unauthenticated caller. Then open a
   room as host, press **Refresh the songbook**, and confirm the note reports songs added with no
   "could not find" clause; the first run fills roughly 400 rows from four channels for about 16
   quota units, and browses afterward cost nothing.

**Rolling back** is cheap because every catalog object is additive: redeploy the previous commit to
drop the feature from the app and leave the tables and grants in place. Do not drop `karaoke_catalog`
to undo a deploy — 0033's RLS and grant hygiene is what keeps the metadata unreachable by the anon
and authenticated roles.

### Already verified, so you do not re-check it

- **Production has no grant drift today.** Read-only comparison on `main` found zero functions
  reachable by `service_role` and unreachable by `echo_service`. The rotation copied everything that
  existed at 0030; 0034 is needed only because 0031–0033 land on top of that copy.
- **The cron schedule is allowed on every plan.** `0 2 * * *` runs once per day, which satisfies the
  Hobby restriction that cron expressions running more frequently fail during deployment. A
  more frequent schedule would break the build on that plan.
- **Vercel's rewrite cannot swallow the cron path.** `/api/(.*)` is matched before the SPA fallback,
  and the fallback's negative lookahead already excludes `api/`. `restoreApiRequest` rebuilds the
  pathname as `/api/cron/catalog-retention`, which is what the router compares — covered by
  `tests/unit/catalogRetentionRouter.test.ts` using the real rewrite helper, not a mock.
- **The first refresh is bounded**: four channels, at most three pages each, roughly 400 rows and
  about 16 quota units, against a 40-unit daily cap. Browsing the songbook costs nothing.
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
  0001→0034 chain applies, `npx supabase test db` reports 325/325, and `npm run test:integration`
  reports 8/8 connecting as `echo_service` **without** a YouTube key — the same conditions CI runs
  under. `npm audit --audit-level=high` is clean, and locally `tsc`, 407 unit tests, the build and
  15 mocked UI flows pass. The push should be green; if it is not, the difference is in CI's
  environment, not in this tree.

### What the app-level live proof showed (and what it cost)

Running the real flow with the real key on a disposable Neon branch seeded **409 songs** and walked
filter → chip → queue → play → auto-advance, which is how 0034's missing grants were found. Do not
re-run that casually: `catalog-sync` spends real quota and the branch's catalog rows make the
catalog fixtures in `supabase/tests/catalog_test.sql` fail (they assume a clean table), so reuse a
branch for the app-level proof only, or expect those four assertions to complain.

## Verification checklist

- [x] `npx supabase test db --db-url "$NEON_DATABASE_URL"` reports 325 passing assertions on a fresh branch.
- [x] `npm run test:integration` passes on the same branch, as `echo_service`.
- [x] `npm test` reports 407 passing tests on the current tree.
- [x] `npm run build` passes on the current tree.
- [x] `npm run test:e2e:ui` reports 15 passing tests on the current tree.
- [x] `npm run verify:deploy` passes with the production environment.
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
