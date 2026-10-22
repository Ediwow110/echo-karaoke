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

The browser talks to Supabase for anonymous Auth and HTTPS Edge Functions only. It never queries karaoke tables directly.

    browser  ->  Edge Function  ->  Postgres
                 (verifies JWT and room pass, uses service role)

- Anonymous Auth identifies a browser session. It grants no room access.
- Joining a room returns a random 32-byte guest room pass. Hosting returns a separate host room pass. Only SHA-256 digests are stored.
- Every guest or host request carries its pass to an Edge Function, which verifies the session, the room membership and the pass before touching the database.
- Row Level Security is enabled on every table, and the anon and authenticated roles hold no table privileges and no execute rights on the karaoke operations.
- Realtime is not used for room data. Screens poll the token-checked read function and use visibility-aware polling.
- The host screen owns one persistent YouTube player. It stays mounted while the host moves between Discover, Queue, Settings, Library and Favorites; the Stage and Party views dock that same player into a measured slot.

Room codes use 16 Crockford Base32 characters (80 bits). Rooms live until the host ends them.

## Local setup

Requires Node 20 or newer, Docker, and the Supabase CLI.

    npm install
    npx supabase start
    npx supabase db reset
    npx supabase functions serve

Copy the local URL and anon key into an `.env` file:

    VITE_SUPABASE_URL=http://127.0.0.1:54321
    VITE_SUPABASE_ANON_KEY=<anon key from npx supabase status>

Optional YouTube search and chart. Without this key the app explains that search is not configured and keeps the paste-link fallback working:

    # supabase/functions/.env
    YOUTUBE_API_KEY=<your data api v3 key>
    YOUTUBE_DAILY_SEARCH_BUDGET=90
    YOUTUBE_DAILY_POPULAR_BUDGET=200

Searches are cached for ten minutes, limited to 20/min and 30/day per member and 60/day per room, and capped by the global daily budget. YouTube resets its quota at midnight Pacific. `search.list` has its own default bucket of 100 calls/day, so the default 90-search budget leaves 10 calls of headroom. Chart refreshes draw from the separate 10,000-unit pool (200/day by default). Song metadata uses oEmbed, which does not consume Data API quota.

In any public deployment, set the browser origin allowlist as well. An empty value is convenient for local development but reflects every origin:

    ALLOWED_ORIGINS=https://your-app.example

Before shipping, run `npm run verify:deploy` with the production `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `ALLOWED_ORIGINS`. It rejects missing credentials, non-HTTPS URLs, the ephemeral trycloudflare tunnel, wildcard origins, and origins with paths or trailing slashes. The CI workflow runs the guard when the matching repository variables are configured, builds and uploads a `production-dist` artifact with those values, and also runs the Edge integration suite against the local stack. `vercel.json` applies the host-level security headers and the CSP at the Vercel edge. Those headers are not part of `dist`, so serving the artifact from a plain static host ships the app without them.

The hosted setup, step by step, is in `docs/deployment/hosted-setup.md`. It covers the Supabase project and its Auth limits, the migrations, the Edge Functions and their secrets, the Vercel environment, the git remote, the CI variables, and the preview checks.

Vercel: `vercel.json` runs `npm run verify:deploy` before the build, rewrites SPA routes, and applies CSP/security headers. Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `ALLOWED_ORIGINS` in the Vercel project environment, and mirror `ALLOWED_ORIGINS` as a Supabase Edge secret. The CSP allows `*.supabase.co`; update `connect-src` if your Supabase project uses a custom domain. Test the camera/QR scan and YouTube playback on the first preview. After deploying, run `npm run verify:preview -- https://your-app.example` to check the headers, CSP, SPA fallback, and asset caching. With `VITE_SUPABASE_URL` set, that check also confirms that the CSP allows the Supabase origin the app actually calls.

Rooms are cleaned up when a room is created. That request first deletes every room whose members have not sent a heartbeat for 30 minutes and every ended room older than two days; members, queue items, votes, events, and host secrets cascade. The app sends a slow heartbeat while a tab is hidden, so a background host tab is not treated as empty. Anonymous identities are intentionally retained: they contain no room content after the sweep, and Better Auth owns them. Room creation is capped at 10 rooms per session per hour; this is a per-session speed bump, not a replacement for sign-in rate limits.

Run the app:

    npm run dev

## Tests

    npm test                 # unit and component tests (jsdom)
    npm run build            # typecheck and production build
    npx supabase test db     # pgTAP checks for grants, RLS, room rules, permissions and duplicates
    npm run test:e2e         # Playwright against the running dev app and local stack

Integration tests exercise the served Edge Functions. Start the stack and functions, then:

    $env:LOCAL_SUPABASE_URL='http://127.0.0.1:54321'
    $env:LOCAL_SUPABASE_ANON_KEY='<anon key from npx supabase status>'
    npm run test:integration

The integration suite skips itself when those variables are absent, so the default test run never needs Docker. The E2E suite creates rooms against the live local stack; start the dev server on the configured `E2E_BASE_URL` first. One E2E test decodes the rendered QR through the local Vite dev resolver.

## Security notes

- Guest and host passes live in localStorage, so any same-origin script can read them. An XSS bug can take over a session.
- Losing the host pass leaves a live room without host controls. There is no recovery flow.
- The service role key exists only inside Edge Functions. It must never reach the browser bundle, logs, or the repository.
- Set `ALLOWED_ORIGINS` in production. CORS currently reflects any origin when the list is empty.
- Room codes gate joining only. Do not treat a room as secret.
- Guest request and playback permissions are independent. Skip, remove and reorder are always host-only.
- A partial unique index prevents two active copies of the same video in one room. Played songs may return.
- There is no join throttle and no member cap. A song cap of five per minute per member is enforced, room creation is capped at 10 rooms per session per hour, and a room whose members have not sent a heartbeat for 30 minutes is deleted the next time somebody creates a room, but a busy room can still grow.

## Layout

    src/app                 screens and routing
    src/features/rooms      create, join, passes, roster, sessions, invitations
    src/features/queue      links, search, queue rows, duplicate feedback
    src/features/playback   persistent host player, transport, stage and party docking
    src/features/library    local library, favorites and recently sung
    src/lib                 Supabase client and Edge API transport
    supabase/migrations     schema, policies, authorized operations
    supabase/functions      the only browser-facing data API
    supabase/tests          pgTAP suites
    tests/unit              logic and component tests
    tests/e2e               real host/guest flows and QR decoding
