# ECHO

A login-free YouTube karaoke room. A host creates a named room, guests scan a real QR code or type the room code, and everyone adds songs to one shared queue while the host screen plays the music.

## What it does

- Create a named room and share a real, scannable QR or the 80-bit room code.
- Split guest permissions: requests can stay open while playback stays host-only, or either can be switched independently.
- Search YouTube when a data API key is configured, or paste a YouTube link as a fallback.
- Prevent duplicate active songs, including concurrent adds.
- Queue songs, reorder and remove as host, and let the next song start automatically.
- Host stage view with play/pause, 10-second seek, fullscreen, volume, favorites and keyboard shortcuts.
- Full-screen party view with the room QR for new singers.
- Phone remote with Search and Queue tabs, duration, automatic-advance feedback, and a "you're up next" card.
- Honest connection states: stale queue while offline, automatic recovery and a restored notice.
- Local Song library, Favorites and Recently sung, plus remembered room sessions.
- Ended-room and unavailable-video states that do not leave dead controls.

Host-only in this version: skip, remove, reorder, guest removal, link rotation, turn rotation and room expiry. The UI does not pretend those controls exist.

## Architecture

The browser talks to one same-origin Vercel Function at `/api`. It never receives a database URL and never queries Postgres directly.

    browser  ->  Vercel Function  ->  Neon Postgres
                 /api/auth/*       ->  Better Auth      -> auth tables (echo_auth)
                 /api/<operation>  ->  room operations -> room schema (service_role)

- Better Auth creates an anonymous session and issues an Ed25519 JWT. The browser fetches `/api/auth/token`, caches it for ten minutes, and refreshes it. The JWT grants no room access on its own.
- Joining a room returns a random 32-byte guest room pass. Hosting returns a separate host room pass. Only SHA-256 digests are stored.
- Every guest or host request carries its pass to the function, which verifies the JWT against the published JWKS, then verifies the room membership and the pass inside the authorized SQL operation.
- Row Level Security is enabled on every table. The anon and authenticated roles hold no table privileges and no execute rights on the operations. `echo_auth` reaches only the auth tables; `service_role` reaches only the room operations.
- Realtime is not used for room data. Screens poll the token-checked read function and use visibility-aware polling.
- The host screen owns one persistent YouTube player. It stays mounted while the host moves between Discover, Queue, Settings, Library and Favorites; the Stage and Party views dock that same player into a measured slot.

Room codes use 16 Crockford Base32 characters (80 bits). Rooms live until the host ends them, and abandoned rooms are swept when the next room is created.

## Local setup

Requires Node 24, Docker (only for the pgTAP suite), the Supabase CLI, the Vercel CLI, and a Neon project. The four local values live in `server/.env.neon`, which is ignored by git.

    npm install
    cp server/.env.neon .env.local
    npx vercel dev

`vercel dev` serves the Vite app and the `/api` function from `http://127.0.0.1:3000`. `npm run dev` remains Vite-only at port 5173; it cannot serve `/api`.

Optional YouTube search and chart. Without this key the app explains that search is not configured and keeps the paste-link fallback working. Put these in `.env.local` for local development and in the Vercel environment for production:

    YOUTUBE_API_KEY=<your data api v3 key>
    YOUTUBE_DAILY_SEARCH_BUDGET=90
    YOUTUBE_DAILY_POPULAR_BUDGET=200

Searches are cached for ten minutes, limited to 20/min and 30/day per member and 60/day per room, and capped by the global daily budget. YouTube resets its quota at midnight Pacific. `search.list` has its own default bucket of 100 calls/day, so the default 90-search budget leaves 10 calls of headroom. Chart refreshes draw from the separate 10,000-unit pool (200/day by default). Song metadata uses oEmbed, which does not consume Data API quota.

Apply the schema and run the database suite against the Neon owner URL:

    npx supabase db push --db-url "$NEON_DATABASE_URL" --yes
    npx supabase test db --db-url "$NEON_DATABASE_URL"

`ALLOWED_ORIGINS` is the deployed app origin. It is read by the deploy guard and trusted by Better Auth; the function is same-origin, so it is not a CORS allowlist:

    ALLOWED_ORIGINS=https://your-app.example

Before shipping, run `npm run verify:deploy`. It refuses a build when any `VITE_` variable holds a PostgreSQL connection string, when `ALLOWED_ORIGINS` is missing or malformed, or when an API base URL escapes the app origin. `vercel.json` applies the security headers and the CSP at the Vercel edge, pins the function to `sin1`, and sends `/api/*` to the function instead of the app shell.

The hosted setup, step by step, is in `docs/deployment/hosted-setup.md`. It covers the Neon project, the two database credentials, the auth service, the Vercel environment, the CI secrets, and the preview checks.

After deploying, run `npm run verify:preview -- https://your-app.example`. It checks the headers, the CSP, the SPA fallback, asset caching, a credential-free HTML and main asset, the JWKS endpoint, and that an unknown `/api` route answers JSON instead of the app shell.

Rooms are cleaned up when a room is created. That request first deletes every room whose members have not sent a heartbeat for 30 minutes and every ended room older than two days; members, queue items, votes, events, and host secrets cascade. The app sends a slow heartbeat while a tab is hidden, so a background host tab is not treated as empty. Anonymous identities are intentionally retained: they contain no room content after the sweep, and Better Auth owns them. Room creation is capped at 10 rooms per session per hour; this is a per-session speed bump, not a replacement for sign-in rate limits.

## Tests

    npm test                 # 216 unit and component tests (jsdom)
    npm run build            # typecheck and production build
    npx supabase test db --db-url "$NEON_DATABASE_URL"   # 221 pgTAP assertions
    npm run test:integration # the function's auth and operation path against Neon
    npm run test:e2e         # Playwright against vercel dev on port 3000

The integration suite needs `DATABASE_URL`, `AUTH_DATABASE_URL`, and `BETTER_AUTH_SECRET`, and starts its own HTTP server around the function handler. It skips itself when those variables are absent. The database suite needs Docker because the Supabase CLI runs `pg_prove` in a container.

The E2E suite creates rooms against the running app; start `vercel dev` first or set `E2E_BASE_URL`. One E2E test decodes the rendered QR through the local Vite dev resolver.

## Security notes

- Guest and host passes live in localStorage, so any same-origin script can read them. An XSS bug can take over a session.
- Losing the host pass leaves a live room without host controls. There is no recovery flow.
- The `service_role` and `echo_auth` connection strings exist only in the function environment. They must never reach the browser bundle, logs, or the repository. The browser has no database credential at all.
- The owner connection string is used only for migrations and CI. It is never set on Vercel.
- `ALLOWED_ORIGINS` is a trusted auth origin, not a CORS policy. The function is same-origin, so a browser on another origin cannot call it through CORS.
- Rotating `BETTER_AUTH_SECRET` requires deleting `public.jwks` first; otherwise the stored private key cannot be decrypted.
- Room codes gate joining only. Do not treat a room as secret.
- Guest request and playback permissions are independent. Skip, remove and reorder are always host-only.
- A partial unique index prevents two active copies of the same video in one room. Played songs may return.
- There is no join throttle and no member cap. A song cap of five per minute per member is enforced, room creation is capped at 10 rooms per session per hour, and a room whose members have not sent a heartbeat for 30 minutes is deleted the next time somebody creates a room, but a busy room can still grow.

## Layout

    api/[...path].ts        the only Vercel Function: auth routes and operations
    server/auth             Better Auth configuration, token verification, JWKS
    server/operations       the thirteen operations, the sweep, error mapping
    server/db               Neon serverless client and operation calls
    src/app                 screens and routing
    src/features/rooms      create, join, passes, roster, sessions, invitations
    src/features/queue      links, search, queue rows, duplicate feedback
    src/features/playback   persistent host player, transport, stage and party docking
    src/features/library    local library, favorites and recently sung
    src/lib                 anonymous auth client and same-origin API transport
    scripts                 deploy guard, preview verifier, CI branch helper
    supabase/migrations     schema and authorized SQL operations
    supabase/tests          pgTAP suites
    tests/unit              logic and component tests
    tests/integration       the router, auth, and operation path against Neon
    tests/e2e               real host/guest flows and QR decoding
