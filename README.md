# Encore

A login-free YouTube karaoke room. A host creates a room, guests scan a QR code or enter the room code, and everyone adds songs to one shared queue while the host screen plays the music.

## What it does

- Create a private room and share an 80-bit room code or QR link.
- Join from any phone without an account.
- Search YouTube when a key is configured, or paste a link or video id.
- See who is in the room and which songs they added.
- Vote on songs, skip, and play or pause from any phone.
- Host controls: lock guest controls, clear the queue, end the room.

## Architecture

The browser talks to Supabase for anonymous Auth and HTTPS Edge Functions only. It never queries karaoke tables directly.

    browser  ->  Edge Function  ->  Postgres
                 (verifies JWT and room pass, uses service role)

- Anonymous Auth identifies a browser session. It grants no room access.
- Joining a room returns a random 32-byte guest room pass. Hosting returns a separate host room pass. Only SHA-256 digests are stored.
- Every guest or host request carries its pass to an Edge Function, which verifies the session, the room membership and the pass before touching the database.
- Row Level Security is enabled on every table, and the anon and authenticated roles hold no table privileges and no execute rights on the karaoke operations.
- Realtime is not used for room data. Screens poll the token-checked read function; a fixed invalidation channel can replace polling later.

Room codes use 16 Crockford Base32 characters (80 bits). Rooms live until the host ends them.

## Local setup

Requires Node 20 or newer, Docker, and the Supabase CLI.

    npm install
    npx supabase start
    npx supabase db reset
    npx supabase functions serve

Copy the local URL and anon key into an .env file:

    VITE_SUPABASE_URL=http://127.0.0.1:54321
    VITE_SUPABASE_ANON_KEY=<anon key from npx supabase status>

Optional YouTube search. Without this key the app still accepts pasted links:

    # supabase/functions/.env
    YOUTUBE_API_KEY=<your data api v3 key>

Run the app:

    npm run dev

## Tests

    npm test                 # unit and component tests (jsdom)
    npm run build            # typecheck and production build
    npx supabase test db     # pgTAP checks for grants, RLS and room rules

Integration tests exercise the served Edge Functions. Start the stack and functions, then:

    $env:LOCAL_SUPABASE_URL='http://127.0.0.1:54321'
    $env:LOCAL_SUPABASE_ANON_KEY='<anon key>'
    npm run test:integration

The integration suite skips itself when those variables are absent, so the default test run never needs Docker.

## Security notes

- Guest and host passes live in localStorage, so any same-origin script can read them. An XSS bug can take over a session.
- Losing the host pass leaves a live room without host controls. There is no recovery flow.
- The service role key exists only inside Edge Functions. It must never reach the browser bundle, logs, or the repository.
- Room codes gate joining only. Do not treat a room as secret.
- No join throttling, member cap, or room expiry exists yet. A song cap of five per minute per member is enforced.

## Layout

    src/app                 screens and routing
    src/features/rooms      create and join, passes, roster
    src/features/queue      links, search, queue actions, votes
    src/features/playback   host player and playback commands
    src/lib                 Supabase client and Edge API transport
    supabase/migrations     schema, policies, authorized operations
    supabase/functions      the only browser-facing data API
    supabase/tests          pgTAP suites
    tests/unit              logic and component tests
    tests/integration       Edge Function authorization tests
