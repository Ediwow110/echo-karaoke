# CLAUDE.md

Persistent instructions for agents working in ECHO. See `README.md` for the product
and deployment contract.

## Commands

- `npm run dev`: Vite only. `/api` is not served unless the optional local backend is
  running.
- `npx vercel dev`: the full app and the same-origin Function on port 3000.
- `npm run build`: `tsc --noEmit` then the production Vite build.
- `npm test`: unit and component tests in jsdom.
- `npm run test:e2e:ui`: Playwright UI checks against Vite with mocked `/api` calls.
  This suite must stay database-free and key-free.
- `npm run test:e2e`: real host/guest flows against `vercel dev` or `E2E_BASE_URL`.
- `npm run test:integration`: router/auth/operation path against a disposable Neon
  branch. It skips without `DATABASE_URL`, `AUTH_DATABASE_URL`, and
  `BETTER_AUTH_SECRET`.
- `npx supabase test db --db-url "$NEON_DATABASE_URL"`: pgTAP suite.
- `npm run verify:deploy`: the production environment guard used by Vercel.
- `npm run verify:preview -- <url>`: deployment header, CSP, asset, and API checks.

## Architecture

- `src/`: React 19 and Vite SPA. The host screen owns one persistent YouTube player.
  Guest phones are search and queue remotes.
- `api/router.ts`: the only Vercel Function. It serves Better Auth under `/api/auth/*`
  and the room operations under `/api/*`.
- `server/auth`: Better Auth, JWT verification, JWKS, trusted origins, and the
  DB-backed sign-in limiter.
- `server/operations`: validation, quotas, the sweep, error mapping, and structured
  failure logs.
- `server/db`: Neon serverless operation calls and the auth connection.
- `supabase/migrations`: plain Postgres schema and authorized SQL operations. The
  Supabase CLI is only the migration and pgTAP runner; there are no Supabase Edge
  Functions.
- The browser never receives a database URL. It sends a Better Auth JWT plus a
  room-scoped guest or host capability header.

## Non-negotiables

- Keep authorization, duplicate checks, room limits, and quota checks in SQL or the
  server. UI hiding is not authorization.
- Keep queue and playback mutations under the room row lock. Revalidate after locking.
- Never log tokens, passes, cookies, connection strings, or raw IP addresses.
- Keep phone controls at least 44 by 44 pixels and reflow without horizontal scrolling
  at 200 percent text.
- Preserve the one persistent host player across host child-route changes.
- Do not commit or deploy without the owner's explicit approval.
- No secrets in source, tests, commands, or chat. Local values live in ignored files.

## Current risk areas

- Quotas are shared. Preflight cheap checks before spending a daily budget.
- Host presence matters: guests must not be told playback will advance when the host
  screen is offline.
- Preview deployments must use a Neon branch, not the production database.
- `npm run verify:deploy` requires the auth secret, both database URLs, origins, and
  bounded quota budgets.
