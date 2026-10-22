# Hosted Setup Runbook

Date: 2026-10-23
Status: Deployed and verified at `https://echo-karaoke-mocha.vercel.app` on
2026-10-23. The CI workflow is green on `master`: verify, database, and integration
all passed. Every hosted value below is named, never printed.

This runbook takes ECHO from the repository to a deployed, verified site. The local
gates are already green: 226 unit tests, 225 database assertions against Neon, 3
operation integration tests, and a production build. This document covers only what a
hosted account makes possible.

## What this procedure produces

- A Neon Postgres database with the full migration chain and the two login roles.
- A Better Auth service inside the same Vercel Function, with anonymous sessions and
  Ed25519 JWTs.
- One Vercel Function at `/api/*` that serves auth and the thirteen room operations.
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
```

| Variable | Value |
|---|---|
| `DATABASE_URL` | The pooled `service_role` connection string |
| `AUTH_DATABASE_URL` | The direct `echo_auth` connection string |
| `BETTER_AUTH_SECRET` | A random secret of at least 32 characters |
| `BETTER_AUTH_URL` | `https://echo-karaoke-mocha.vercel.app` |
| `ALLOWED_ORIGINS` | `https://echo-karaoke-mocha.vercel.app` |

`ALLOWED_ORIGINS` is read by the deploy guard and becomes a trusted auth origin. It is
not a CORS allowlist any more: the function is same-origin, so no CORS headers are
needed.

Repeat the database, auth secret, and origin variables for the Preview environment.
Do **not** set `BETTER_AUTH_URL` for Preview; the current deployment host is derived
from `VERCEL_URL` and trusted automatically. Preview deployments still need the two
database URLs and the secret, or the function cannot start.

The guard runs before every build. A missing `ALLOWED_ORIGINS`, a wildcard origin, an
origin with a path or trailing slash, and any `VITE_*` PostgreSQL URL all stop the
build.

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
   runs the 225 pgTAP assertions, and deletes the branch even on failure.
3. `integration` creates a second branch, applies the chain, deletes the inherited
   `public.jwks` rows so Better Auth generates keys for this run's secret, runs the
   operation suite, and deletes the branch.

Branches copy the parent's data. The CI secret can differ from production because the
integration job removes the inherited encrypted keys first. Branch names include the
run id and attempt, so two runs never collide.

The workflow ran green on `master` on 2026-10-23
([run 39868480083](https://github.com/Ediwow110/echo-karaoke/actions/runs/39868480083)):
`verify`, `database`, and `integration` all passed. The first CI attempt failed at
`db push` because Neon's branch URI carries `channel_binding`, which the Supabase CLI
connector sends as a server parameter. `scripts/neon-branch.mjs` now removes that
parameter from the branch URIs.

## Step 7: The room sweep

When a room is created, the same request first calls
`cleanup_abandoned_rooms(now() - interval '30 minutes')` and
`cleanup_ended_rooms(now() - interval '2 days')`. A room whose members have not sent a
heartbeat for thirty minutes is deleted the next time somebody creates a room. Ended
rooms older than two days are deleted at the same time.

Both sweeps are best effort. A sweep failure is ignored so that a room can still be
created when the cleanup call fails. There is no required pg_cron job and no
five-minute guarantee; the interval is opportunistic.

## Verification checklist

- [x] `npx supabase test db --db-url "$NEON_DATABASE_URL"` reports 225/225.
- [x] `npm run test:integration` reports 3/3 against Neon.
- [x] `npm test` reports 226 unit tests passing.
- [x] `npm run build` passes.
- [x] `vercel deploy --prod` builds with the guard enabled.
- [x] `npm run verify:preview -- https://echo-karaoke-mocha.vercel.app` passes.
- [ ] A real host/guest flow works on a phone.
- [x] The CI workflow runs green on `master` after a push.

## Not covered here

- The YouTube Data API key. Without it, search reports that it is not configured and
  the paste-a-link path keeps working.
- The host heartbeat after an auth session replacement, which remains an open finding
  from the 2026-10-22 audit.
- Per-IP sign-in throttling in front of Better Auth.
