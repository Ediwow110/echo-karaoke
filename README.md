# kara-echo

A login-free YouTube karaoke room. A host creates a named room, guests scan a real QR code or type the room code, and everyone adds songs to one shared queue while the host screen plays the music.

## What it does

- Create a named room and share a real, scannable QR or the 80-bit room code.
- Split guest permissions: requests can stay open while playback stays host-only, or either can be switched independently.
- Search YouTube by song or artist and add songs directly from the results.
- Prevent duplicate active songs, including concurrent adds.
- Queue songs, reorder and remove as host, and let the next song start automatically.
- Host stage view with play/pause, 10-second seek, fullscreen, volume, favorites and keyboard shortcuts.
- Full-screen party view with the room QR for new singers.
- Phone remote with Search and Queue tabs, duration, automatic-advance feedback, and a "you're up next" card.
- Honest connection states: stale queue while offline, automatic recovery and a restored notice.
- Local Song library, Favorites and Recently sung, plus remembered room sessions.
- Ended-room and unavailable-video states that do not leave dead controls.

Host-only controls: skip, remove, reorder, guest removal, lock and clear. Link rotation, turn rotation and room expiry are not implemented; the UI does not pretend they exist.

## Architecture

The browser talks to one same-origin Vercel Function at `/api`. It never receives a database URL and never queries Postgres directly.

    browser  ->  Vercel Function  ->  Neon Postgres
                 /api/auth/*       ->  Better Auth      -> auth tables (echo_auth)
                 /api/<operation>  ->  room operations -> room schema (service_role)

Search falls back to a clearly labeled manual YouTube-link entry only when search is
not configured or resting. It is not a general replacement for search.

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

YouTube search and chart require a data API key. Without it the app explains that search is not configured. Put these in `.env.local` for local development and in the Vercel environment for production:

    YOUTUBE_API_KEY=<your data api v3 key>
    YOUTUBE_DAILY_SEARCH_BUDGET=90
    YOUTUBE_DAILY_POPULAR_BUDGET=6
    YOUTUBE_DAILY_METADATA_BUDGET=5000
    YOUTUBE_ROOM_METADATA_BUDGET=500

Searches are cached for ten minutes, limited to 20/min and 30/day per member and 60/day per room, and capped by the global daily budget. YouTube resets its quota at midnight Pacific. `search.list` has its own bucket of 100 calls/day at one unit per call; the default 90 user searches plus 6 karaoke-strip refreshes stay within it. The strip asks for embeddable karaoke videos with lyrics, caches a pool of up to twenty for twelve hours, hides medleys and compilations, and serves each screen a random eight-song selection from that pool. Song metadata uses quota-free oEmbed, with a per-room daily lookup budget and a larger deployment budget. If search is resting or the key is absent, the panel offers a manual YouTube-link fallback.

Apply the schema and run the database suite against the Neon owner URL. Apply
migrations 0025 through 0033 before deploying this tree; queue and search now call
`queue_add_preflight`, `peek_daily_rate_limit`, the search refund, and the longer
karaoke-strip cache TTL, host removal now repairs playback state, an automatic advance
calls `playback_next_if_current`, and the songbook catalog tables and its retention
function must exist before the sync and the daily cron run.

    npx supabase db push --db-url "$NEON_DATABASE_URL" --yes
    npx supabase test db --db-url "$NEON_DATABASE_URL"

`ALLOWED_ORIGINS` is the deployed app origin. It is read by the deploy guard and trusted by Better Auth; the function is same-origin, so it is not a CORS allowlist:

    ALLOWED_ORIGINS=https://your-app.example

Two abuse controls are optional. The room cap counts the host and guests present in the last 30 seconds; an inactive guest frees a slot and the host can remove a guest. The sign-in cap counts anonymous sign-ins per hashed network address per hour:

    ROOM_MEMBER_LIMIT=50
    ANON_SIGNIN_LIMIT_PER_HOUR=120

Before shipping, run `npm run verify:deploy`. It refuses a build when the auth secret, the two database URLs, an origin, a quota budget, or the Production `CRON_SECRET` is missing or malformed, or when any `VITE_` variable holds a PostgreSQL connection string. `vercel.json` applies the security headers and the CSP at the Vercel edge, pins the function to `sin1`, sends `/api/*` to the function instead of the app shell, and schedules the catalog retention cron.

The hosted setup, step by step, is in `docs/deployment/hosted-setup.md`. It covers the Neon project, the two database credentials, the auth service, the Vercel environment, the CI secrets, and the preview checks.

After deploying, run `npm run verify:preview -- https://your-app.example`. It checks the headers, the CSP, the SPA fallback, asset caching, a credential-free HTML and main asset, the JWKS endpoint, and that an unknown `/api` route answers JSON instead of the app shell.

Rooms are cleaned up when a room is created. That request first deletes every room whose members have not sent a heartbeat for 30 minutes and every ended room older than two days; members, queue items, votes, events, and host secrets cascade. The app sends a slow heartbeat while a tab is hidden, so a background host tab is not treated as empty. Anonymous identities are intentionally retained: they contain no room content after the sweep, and Better Auth owns them. Room creation is capped at 10 rooms per session per hour; this is a per-session speed bump, not a replacement for sign-in rate limits.

The karaoke songbook is a local catalog of embeddable karaoke videos, filled only by a host pressing Refresh. Browsing, filtering and paging read the catalog and cost zero YouTube quota. One refresh costs at most 12 `playlistItems` units (four channels, three pages) plus one more for a
channel it has to re-resolve, against a 40-unit daily budget, no-ops while every channel synced
within six hours, and stops after eight seconds with a partial result. Because third-party YouTube metadata must be revalidated or deleted within 30 days, the page function hides anything older than 28 days and `karaoke_catalog_retire_stale()` deletes it. That runs inside each refresh and once more from a Vercel Cron at 02:00 UTC, so an idle site still expires its catalog. Set `CRON_SECRET` to at least 32 characters in the Production environment; Vercel sends it as `Authorization: Bearer <secret>`. The endpoint answers 404 outside Production, 401 on a non-matching bearer, and 503 when the secret is unset or short, and never returns database contents. When search is unconfigured, out of budget, or failing, the search panel falls back to matching catalog entries within that same 28-day window and says so; it never serves aged metadata as a search result.

## Tests

    npm test                 # 426 unit and component tests (jsdom)
    npm run build            # typecheck and production build
    npx supabase test db --db-url "$NEON_DATABASE_URL"   # 328 pgTAP assertions
    npm run test:integration # 8 router/auth/operation tests against a Neon branch
    npm run test:e2e:ui      # 16 CI-safe Playwright UI flows with a mocked API
    npm run test:e2e         # real Playwright flows against vercel dev on port 3000

`vercel dev` reads `.env.local`, whose database URLs name production Neon, so `npm run test:e2e` with no `E2E_BASE_URL` creates real rooms in production. Run it only against a disposable branch: repoint the server, or set `E2E_BASE_URL` to a branch-backed deployment.

The integration suite needs `DATABASE_URL`, `AUTH_DATABASE_URL`, and `BETTER_AUTH_SECRET`, and starts its own HTTP server around the function handler. It skips itself when those variables are absent. The database suite needs Docker because the Supabase CLI runs `pg_prove` in a container.

The UI suite needs no database or YouTube key. The real E2E suite creates rooms against the running app; start `vercel dev` first or set `E2E_BASE_URL`. One E2E test decodes the rendered QR through the local Vite dev resolver.

## Security notes

- Guest and host passes live in localStorage, so any same-origin script can read them. An XSS bug can take over a session.
- Losing the host pass leaves a live room without host controls. There is no recovery flow.
- The `service_role` and `echo_auth` connection strings exist only in the function environment. They must never reach the browser bundle, logs, or the repository. The browser has no database credential at all.
- The function connects as `echo_service`. A new SQL function must be granted to `echo_service` as well as `service_role`, or the feature 500s in production while every owner-run database test passes; `supabase/tests/role_grant_parity_test.sql` fails if the two roles' surfaces drift.
- The owner connection string is used only for migrations and CI. It is never set on Vercel.
- `ALLOWED_ORIGINS` is a trusted auth origin, not a CORS policy. The function is same-origin, so a browser on another origin cannot call it through CORS.
- Rotating `BETTER_AUTH_SECRET` requires deleting `public.jwks` first; otherwise the stored private key cannot be decrypted.
- Room codes gate joining only. Do not treat a room as secret.
- Guest request and playback permissions are independent. Skip, remove and reorder are always host-only.
- A partial unique index prevents two active copies of the same video in one room. Played songs may return.
- A song cap of five per minute per member is enforced. Room creation is capped at 10 rooms per session per hour, and a room is capped at 50 present members including the host (`ROOM_MEMBER_LIMIT`, 2–500). Inactive guest rows stop counting after 30 seconds; the host can remove a guest, which also removes that guest's queue and votes. Anonymous sign-in is capped at 120 per hour per network address (`ANON_SIGNIN_LIMIT_PER_HOUR`, 1–1000), stored as an HMAC, not a raw IP. These are speed bumps; a large venue should set the sign-in cap for its expected crowd.

## Layout

    api/router.ts           the only Vercel Function: auth routes and operations
    server/auth             Better Auth configuration, token verification, JWKS
    server/operations       the fourteen operations, the sweep, error mapping
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
