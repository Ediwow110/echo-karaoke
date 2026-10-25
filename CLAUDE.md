# CLAUDE.md

Persistent instructions for agents working in kara-echo. See `README.md` for the product
and deployment contract.

## Commands

- `npm run dev`: Vite only — `/api` is not served. Vite proxies `/api` to
  `http://127.0.0.1:3001`, but nothing in this repo listens there: `scripts/backend-server.ts`
  imports `.js` specifiers that plain Node cannot resolve, so it exits with `ERR_MODULE_NOT_FOUND`.
  It is not wired into any npm script. Neither is its near-duplicate
  `scripts/.local-backend.ts` (ports 5180/3002, a leftover from another project's worktree), which
  fails the same way — do not try that one instead.
- `npx vercel dev`: the only working full-stack local path, on port 3000.
  **Caution:** `.env.local`'s `DATABASE_URL`, `AUTH_DATABASE_URL`, and
  `NEON_DATABASE_URL` all name production Neon `main`, so this command writes real
  rooms, queue rows, and catalog cursors to production. Before running it, apply the
  migration chain to a disposable Neon branch and override all three URLs to that
  branch's hosts in the shell environment (verified procedure:
  `docs/deployment/hosted-setup.md`); never print the resulting connection string,
  because Neon role passwords are shared project-wide.
- `npm run build`: `tsc --noEmit` then the production Vite build.
- `npm test`: unit and component tests in jsdom.
- `npm run test:e2e:ui`: Playwright UI checks against Vite with mocked `/api` calls.
  This suite must stay database-free and key-free.
- `npm run test:e2e`: real host/guest flows against `vercel dev` or `E2E_BASE_URL`.
  Its default base URL is `127.0.0.1:3000`, so with no `E2E_BASE_URL` set it drives
  whatever `vercel dev` is serving — which is production unless you repointed it.
  Set `E2E_BASE_URL` to a branch-backed server before running it.
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
