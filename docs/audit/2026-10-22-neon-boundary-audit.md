# Neon Boundary Audit

Date: 2026-10-23
Scope: the identity path, the two Neon credentials, the Vercel Function boundary,
and the parts of the room authorization SQL that did not move.
Verdict: **deployed and verified** at `https://echo-karaoke-mocha.vercel.app` on
2026-10-23. CI has not run yet.

## Evidence

| Gate | Command | Result |
|---|---|---|
| Unit and component | `npm test` | 226 passed |
| Database | `npx supabase test db --db-url "$NEON_DATABASE_URL"` | 225 passed, 8 files |
| Operation integration | `npm run test:integration` | 3 passed |
| Production build | `npm run build` | passed |
| Vercel bundle | `vercel build` | passed, `.vercel/output` produced |
| Local hosted-style flow | `vercel dev` plus curl | sign-in 200, token 200, create-room 201 |
| Browser credential scan | `grep postgresql://` over `.vercel/output/static` | no matches |
| Production deploy | `vercel deploy --prod` | ready; alias `echo-karaoke-mocha.vercel.app` |
| Production verifier | `npm run verify:preview -- https://echo-karaoke-mocha.vercel.app` | passed |
| Production auth and room | curl against the alias | sign-in 200, token 200, create-room 201 |

The integration suite signs in through Better Auth, fetches the JWT, verifies it, and
exercises create, join, reads, touch, lock, queue add/vote/remove, playback
play/report/next, the YouTube no-key path, the `/api` rewrite, and the abandoned-room
sweep. The database suite proves the role boundary.

## Findings

### 1. High, fixed: the key set was fetched from the request origin

`requireAnonymousCaller` built the JWKS URL from `new URL(request.url).origin`. A
request with a spoofed Host could make the function fetch keys from an attacker's
origin and accept a forged token. The URL now comes from `resolveBaseUrl`, so it is
the configured auth origin (`server/auth/identity.ts:6-8,86`). A unit test sets the
origin explicitly and proves the request host is not used.

### 2. Medium, fixed: a token without an expiry was accepted

The verifier only checked `exp` when it was present. It now requires a numeric future
`exp` before it fetches the key set (`server/auth/identity.ts:48-50`). Ed25519
signature, `sub`, and the anonymous claim are still checked; the signature is checked
after the key is found.

### 3. High, fixed: the Vercel entry used a legacy default export

A default function export in a Vercel `/api` file is treated as a Node
`(req, res)` handler. The handler returned a `Response` but never ended `res`, so
`vercel dev` logged "still running after 30s" and the client received no response.
The entry now exports the documented Fetch form,
`export default { fetch: handleRequest }` (`api/router.ts:14`). The complete local
flow then returned sign-in 200, token 200, and create-room 201.

### 4. High, fixed: the catch-all function matched only one path segment

The generated route table for `api/[...path].ts` mapped `/api/([^/]+)` only, and sent
every deeper path to a platform 404. `/api/auth/token` would not have worked in
production. The entry is now `api/router.ts`; `vercel.json` rewrites
`/api/(.*)` to `/api/router?path=$1`, and the router restores the original pathname
and body (`server/operations/rewrite.ts:11-37`). The generated table now starts with
`^/api(?:/(.*))$ -> /api/router?path=$1`. The integration suite calls through
`/api/router?path=...` for auth, create-room, and a 404 probe.

### 5. Medium, fixed: the function declared an invalid runtime value

`config = { runtime: 'nodejs24' }` made `vercel build` fail: Vercel accepts only
`nodejs`, `experimental-edge`, or `edge` there. The entry now uses the default Node
runtime, and `package.json` pins `engines.node` to `24.x`.

### 6. Medium, fixed: TypeScript 7 could not be emitted by the Vercel builder

`vercel build` failed with "TypeScript did not emit an output" while the project used
TypeScript 7.0.2. The project is pinned to 5.9.3, and the Vercel build now completes.
This is a build-tooling constraint, not a runtime one.

### 7. Medium, fixed: the auth/service role boundary is now explicitly enforced

`echo_auth` could not run a room operation, but service_role had no explicit revoke
on the identity tables, and Supabase grants new public tables to service_role by
default. Migration `0022_role_boundary.sql` revokes service_role from `user`,
`session`, `account`, `verification`, and `jwks`, and revokes echo_auth from the room
tables and schema. `auth_role_test.sql` now asserts both directions. The suite is
225/225 on Neon.

### 8. Low, fixed: token requests could hang

The client's `/api/auth/token` and anonymous sign-in requests had no deadline. Both
now use a 10-second `AbortSignal.timeout` (`src/lib/auth.ts`).

### 9. Low, fixed: a rotated key set waited out the cache

The JWKS cache is ten minutes. An unknown `kid` now forces one fresh read before the
token is rejected (`server/auth/identity.ts:52-58`), and `jwks.test.ts` proves the
cache is reused normally and refreshed when forced.

### 10. Info, removed: an unused session clear

`clearAnonymousSession` had no caller and was removed rather than left as dead API.

### 11. High, fixed: the production function imports had no ESM extensions

The first production deployment answered every API request with 500. The runtime log
said `Cannot find module '/var/task/server/auth/auth' imported from
/var/task/api/router.js`. Vercel emits one `.js` file per TS module instead of
bundling, and Node ESM does not resolve extensionless or directory imports. Every
relative import in `api/` and `server/` now names `.js`, with `/index.js` for
directory imports. The production flow then returned sign-in 200, token 200, and
create-room 201.

### 12. Medium, fixed: the production alias was assumed

The project's production alias is `echo-karaoke-mocha.vercel.app`, not the
`echo-karaoke.vercel.app` used by the first environment setup. `BETTER_AUTH_URL` and
`ALLOWED_ORIGINS` were corrected and the deployment was repeated. The docs now use the
confirmed alias.

## The boundary that did not move

- The authorized SQL is unchanged. The 225 database assertions cover grants, RLS,
  room rules, permissions, duplicate songs, playback, votes, retention, and the sweep.
- The browser holds no database credential. `vercel build` output has no PostgreSQL
  URL in `static/`; the deploy guard refuses any `VITE_*` connection string, and the
  preview verifier scans the served HTML and main asset.
- The room pass model is unchanged: random guest and host passes, SHA-256 digests at
  rest, capability headers, and the same host-only actions.
- The sweep is opportunistic on room creation, not a cron guarantee. It deletes rooms
  with no heartbeat for 30 minutes and ended rooms older than two days; a sweep
  failure does not block room creation.

## Not covered

- No CI run yet. The CI workflow is committed and needs `NEON_API_KEY`,
  `NEON_DATABASE_URL`, `NEON_SERVICE_DATABASE_URL`, `NEON_AUTH_DATABASE_URL`,
  `BETTER_AUTH_SECRET`, and the `NEON_PROJECT_ID` variable.
- Phone camera scanning and the real guest/host flow on a phone.
- The YouTube Data API key path. The no-key path is tested; the live quota path is not.
- Neon connection limits and function concurrency under a full room.
- Per-IP throttling in front of Better Auth.
- The host heartbeat after an auth session replacement, which remains open from the
  2026-10-22 audit.
- The user-owned `scripts/dev-tunnel.ps1`, which still describes the Supabase tunnel
  and was intentionally not modified.

## Order to finish

1. Add the repository secrets and run the Neon-branch CI workflow. The production
   environment and deployment are complete and verified.
2. Run a real phone host/guest flow against the production alias.
3. Fix the host heartbeat across auth session replacement, with a test that would fail
   without it.
4. Add a per-IP sign-in throttle and an explicit room-size limit before a public party.
5. Decide whether the dev tunnel is updated for `/api` or retired.
6. Decide whether the YouTube key is configured or left as the paste-link fallback.
