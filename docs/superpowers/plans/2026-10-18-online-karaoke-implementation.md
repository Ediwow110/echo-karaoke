# Online Karaoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a login-free YouTube karaoke web app where a host creates a room and guests join by room ID or QR code to search and add songs, control playback, and see who is present.

**Architecture:** A React and TypeScript Vite SPA provides host and guest views. Supabase Anonymous Auth identifies each browser. Guests receive a separate room-scoped token; every room-data read and write passes through an authenticated Edge Function that validates the JWT and guest token before using its server-only service-role client for narrowly scoped database operations. Browser roles receive no direct application-table grants. Realtime carries only fixed non-sensitive invalidation notices; clients refetch through token-checking Edge Functions. The host screen is the only device that plays YouTube audio/video. Search uses an Edge Function when configured; URL/ID pasting works without the key.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, Supabase Auth/Postgres/Realtime/Edge Functions, YouTube IFrame Player API, YouTube Data API v3, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-10-18-online-karaoke-design.md

## Global Constraints

- No user-facing login or account creation; anonymous session identity supports room membership.
- A room ID or QR URL grants the initial join attempt only. Room data access additionally requires Anonymous Auth membership and a room-scoped guest token.
- Enable Row Level Security on every application table and deny direct browser table access by default. Guest data flows through Edge Functions validating Anonymous Auth plus room-scoped guest token.
- Never ship Supabase service-role credentials or the YouTube API key to the browser. Edge Functions use service role only after validating caller JWT and guest/host bearer token, and constrain database queries to one room/action.
- Host-only actions require server-verified host capability; guest controls obey the room lock.
- Only the host screen plays YouTube audio/video.
- Guests reorder or remove only songs they added; the host can manage all songs.
- Limit guest additions to 5 songs per minute per member.
- Search is optional when no YouTube API key is configured; URL/ID fallback remains available.

## Review Focus

1. Invalid, unknown, or ended room codes must not create memberships. Cover in Task 4.
2. Non-members, guests invoking host controls, and guests acting while locked must be rejected server-side. Cover in Tasks 2, 3, and 8.
3. Concurrent queue additions must receive distinct ordered positions. Cover in Task 6.
4. Malformed or non-YouTube URLs must not create queue rows. Cover in Task 5.
5. Realtime reconnects, blocked autoplay, and unavailable videos must recover or expose a clear user action. Cover in Tasks 7 and 8.

---

## File Structure

- src/app: application shell and route definitions.
- src/lib: browser Supabase client and shared validation.
- src/features/rooms: room creation/join, host and guest views, QR, membership, and participant roster.
- src/features/queue: YouTube ID parsing, metadata, queue APIs, search, and queue controls.
- src/features/playback: host-only YouTube player and synchronized controls.
- supabase/migrations: schema, constraints, RLS policies, database functions, and Realtime authorization.
- supabase/functions: server-side YouTube metadata/search functions and privileged room commands where needed.
- tests/unit, tests/integration, tests/e2e: isolated logic, local Supabase checks, and browser flows.

## Task 1: Bootstrap the web application

**Files:** Create package.json, index.html, vite.config.ts, tsconfig.json, src/main.tsx, src/app/App.tsx, src/styles.css, src/vite-env.d.ts, vitest.config.ts, tests/unit/app.test.ts, .env.example, .gitignore.

**Interfaces:** Provide npm run dev, npm test, and npm run build.

- [ ] Create a React and TypeScript Vite app. Install Tailwind, Supabase JS, Vitest, jsdom, and React Testing Library.
- [ ] Write a failing render test asserting the home screen has Create room and Join room entry points.
- [ ] Run npm test and confirm the new test fails before implementing the screen.
- [ ] Add the minimal app shell and pass the render test.
- [ ] Configure scripts, test environment, and environment example containing only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
- [ ] Ignore node_modules, dist, local env files, and Playwright artifacts.
- [ ] Run npm test and npm run build; commit as chore: bootstrap karaoke web app.

## Task 2: Approve Supabase security and tenancy blueprint

**Files:** Revise docs/superpowers/plans/room-security-blueprint.md and this plan for renewed approval. After approval create supabase/config.toml, supabase/migrations/0001_room_core.sql, supabase/functions/_shared/auth.ts, supabase/functions/_shared/admin.ts, create-room, join-room, guest-room-read, host-room-read, and host-command Edge Functions, plus Supabase pgTAP tests.

**Interfaces:** Define tenant isolation, browser-session identity, host proof, safe room-code join, Edge Function API contracts, closed PostgREST surface, and private invalidation-only Realtime.

- [ ] Specify how anonymous Supabase Auth maps an installation session to members without showing login UI.
- [ ] Specify rooms, members, queue_songs, votes, and room_events with foreign keys, allowed states, unique constraints, and indexes for all policy filters.
- [ ] Define room-code join so an unjoined caller can join a live room without exposing host secrets or allowing arbitrary room reads.
- [ ] Define host capability storage and verification, guest membership authorization, and denial rules for ended rooms and locked controls.
- [ ] Enable RLS on every table and revoke all browser-role table grants. Define the Edge Function API contracts that validate Anonymous Auth plus guest or host bearer token before server-side database access. Include positive and negative tests for both layers.
- [ ] Define private Realtime authorization for non-sensitive room-changed invalidation notices only. Do not use Postgres Changes or Presence as guest data access; read roster/data through token-validating Edge Functions.
- [ ] Present both revised documents and STOP for renewed user approval before writing/applying migrations or connecting to a hosted project.
- [ ] After approval, configure local anonymous Auth, write the reviewed migration, and implement Edge Function entry points. Run supabase db reset only after the migration has passed static review. Add pgTAP checks for all-browser-role table denial and function ACLs; test valid/missing/wrong/cross-room guest and host tokens through Edge Functions.
- [ ] Commit as feat: add token-gated karaoke database and Edge Functions.

## Task 3: Add room and identity operations

**Files:** Create src/lib/supabase.ts, src/lib/validation.ts, src/features/rooms/roomCode.ts, src/features/rooms/roomApi.ts, tests/unit/roomCode.test.ts, tests/unit/validation.test.ts, tests/integration/roomApi.test.ts; add reviewed room-operation migration as needed.

**Interfaces:**

    normalizeDisplayName(value: string): string
    generateRoomCode(): string
    createRoom(): Promise<CreatedRoom>
    joinRoom(code: string, displayName: string): Promise<JoinedRoom>
    invokeRoomFunction<T>(name: string, input: Record<string, unknown>, guestToken?: string): Promise<T>

CreatedRoom returns roomId, roomCode, memberId, hostToken. JoinedRoom returns roomId, memberId, normalized displayName, guestToken, role. Store tokens only in owner-scoped localStorage; never store hashes in browser.

- [ ] Write tests for the room-code alphabet and length, generated codes being distinct across repeated runs, display-name trimming, empty-name fallback, Unicode, and 32-character cap.
- [ ] Run focused tests and confirm failure before implementation.
- [ ] Implement cryptographically secure room-code generation and display-name normalization.
- [ ] Create browser Supabase client using only public URL and anon key for anonymous Auth and Edge Function invocation. Never call `.from()` or `.rpc()` for karaoke data from browser code.
- [ ] Implement create and join through the reviewed Edge Function flow. Edge Function uses server-only service role after validating the anonymous JWT; browser does not invoke database RPC directly. Store the host capability only in host localStorage and guest capability in guest room storage. No client directly reads or writes room tables.
- [ ] Test create, valid join, duplicate/rejoin, unknown room, ended room, invalid display name, missing guest token, wrong token, and cross-room token against local Edge Functions.
- [ ] Run unit and integration tests; commit as feat: create and join anonymous karaoke rooms.

## Task 4: Build host, join, and QR flows

**Files:** Create src/app/routes.tsx, src/features/rooms/HomePage.tsx, src/features/rooms/HostRoomPage.tsx, src/features/rooms/JoinRoomPage.tsx, src/features/rooms/GuestRemotePage.tsx, src/features/rooms/RoomQrCode.tsx, src/features/rooms/roomUrl.ts, tests/unit/roomUrl.test.ts, tests/e2e/room-join.spec.ts.

**Interfaces:** Routes are `/`, `/room/:roomId/host`, `/join/:roomCode`. QR encodes absolute join URL. Guest remote sends guest token on every Edge Function call. Host display reads/commands send host token through host-authorized Edge Functions. No direct table query or RPC.

- [ ] Test join URL construction with special-character room codes and multiple origins.
- [ ] Implement route parsing, room creation action, visible room ID, QR code, and copyable join URL.
- [ ] Implement room-ID entry and QR landing. Ask for display name, await Edge Function join confirmation and receive guest token, store it by room, then show joined state.
- [ ] Show distinct invalid-room, ended-room, loading, and network-error states.
- [ ] Add a Playwright test creating a room in one context and joining by code and direct QR URL in another. Assert room/roster data comes through token-validating Edge Functions and no direct anon/authenticated table query succeeds.
- [ ] Run unit tests, e2e room flow, and build; commit as feat: add host and QR guest room flows.

## Task 5: Implement YouTube URL fallback and queue insertion

**Files:** Create src/features/queue/youtubeVideo.ts, src/features/queue/queueApi.ts, src/features/queue/PasteSongForm.tsx, src/features/queue/QueueList.tsx, tests/unit/youtubeVideo.test.ts, tests/integration/queueApi.test.ts; create supabase/migrations/0002_queue.sql and a server-side oEmbed metadata function.

**Interfaces:**

    parseYouTubeVideoId(input: string): string | null
    addSong(roomId: string, guestToken: string, song: SongMetadata): Promise<QueueSong>
    getQueue(roomId: string, guestToken: string): Promise<QueueSong[]>

SongMetadata has videoId, title, channelTitle, thumbnailUrl, and nullable durationSeconds. getQueue/addSong call Edge Functions with current Auth JWT and guest token. Browser code does not query tables directly.

- [ ] Test accepted watch, short, embed, and raw-ID forms. Reject empty input, unsupported hosts, invalid IDs, and extra paths.
- [ ] Run the parser tests and confirm they fail before implementation; implement strict URL parsing with the URL API.
- [ ] Add queue schema with status constraints, room and member references, unique room/position, and indexes. Enable RLS, revoke browser grants, and test that only the Edge Function route reaches queue data.
- [ ] Implement the queue-command Edge Function: verify JWT, membership and guest token, reject ended/locked mutations, then perform a transaction-safe insert with the next position and the per-member 5-per-minute cap.
- [ ] Implement server-side metadata lookup for pasted IDs. Do not create a queue row if metadata resolution fails; show an actionable error.
- [ ] Render queue title, channel, thumbnail, position, and adder's display name from `getQueue`; subscribe only to a non-sensitive room-changed Broadcast, then refetch through the token-validating Edge Function.
- [ ] Test simultaneous adds, duplicate videos, rate limiting, ended-room rejection, cross-room token rejection, and missing-token rejection.
- [ ] Run unit/integration tests and build; commit as feat: add YouTube links to shared song queue.

## Task 6: Add YouTube search and queue management

**Files:** Create supabase/functions/youtube-search/index.ts, supabase/functions/queue-command/index.ts, supabase/functions/room-read/index.ts, src/features/queue/SongSearch.tsx, src/features/queue/QueueControls.tsx, tests/integration/youtubeSearch.test.ts, tests/integration/edgeRoomAuth.test.ts.

**Interfaces:** Search receives roomId, guestToken, and query with the caller's anonymous JWT; the Edge Function verifies both JWT and membership/token then returns up to 10 SongMetadata. The YouTube key is an Edge Function secret.

- [ ] Test successful response mapping, empty results, missing key, quota failure, malformed upstream response, timeout, missing guest token, and wrong-room token.
- [ ] Validate the anonymous JWT, room membership, guestToken, trim query, reject empty queries, cap query length at 100 characters, and return at most 10 results.
- [ ] Implement the Edge Function using server-side key access only. Never log credentials or session tokens.
- [ ] Return a typed unavailable response on missing key or upstream failure; keep URL/ID entry available.
- [ ] Implement search results and add buttons using the same token-validating Edge Function addSong operation as the paste flow.
- [ ] Implement guest reorder/remove only for own songs and host reorder/remove for any song through the token-validating Edge Function.
- [ ] Test that a guest cannot modify another member's song. Run functions tests, local Supabase checks, and build; commit as feat: search YouTube and manage karaoke queue.

## Task 7: Add live participant roster and recovery

**Files:** Create src/features/rooms/useRoomPresence.ts, src/features/rooms/ParticipantRoster.tsx, tests/unit/roomPresence.test.ts, tests/e2e/room-presence.spec.ts.

**Interfaces:** `getRoster(roomId, guestToken)` returns participants. `touchMember(roomId, guestToken)` updates caller heartbeat. Private Realtime carries invalidation events only; do not treat Presence keys/payloads as roster identity.

- [ ] Test invalidation receipt, roster refetch with a valid token, missing-token rejection, and reconnect behavior.
- [ ] Implement private room Broadcast only for fixed, empty `room-changed` invalidation notices. Only server Edge Functions publish. Every guest read/refetch includes the guest token and calls room-read Edge Function. Do not use Presence keys as membership identity or expose participant or queue data through Realtime.
- [ ] Render names and host/guest roles on host and guest screens. Preserve durable membership when a user disconnects.
- [ ] On reconnect, refetch room/queue/playback/roster through token-validating Edge Functions before processing invalidation notices.
- [ ] Test host plus two guests joining/leaving, roster freshness, and rejection of a non-member subscription or a client-published message.
- [ ] Run tests and build; commit as feat: show live karaoke room participants.

## Task 8: Implement synchronized playback and host controls

**Files:** Create src/features/playback/YouTubePlayer.tsx, src/features/playback/playbackApi.ts, src/features/playback/PlaybackControls.tsx, src/features/rooms/HostRoomControls.tsx, tests/unit/playbackState.test.ts, tests/integration/roomCommands.test.ts, tests/e2e/playback-controls.spec.ts; create supabase/migrations/0003_playback_controls.sql.

**Interfaces:** `getPlayback(roomId, guestToken)` returns currentSongId, positionSeconds, isPlaying, and updatedAt; playback-command accepts guestToken and play/pause/skip. Host commands are end-room, clear-queue, lock-guests, and unlock-guests and require the host token.

- [ ] Test play, pause, skip to next queued song, empty queue, song-ended transition, locked guest action, and ended-room immutability.
- [ ] Implement token-validating playback and host-command Edge Functions. Verify guest token for guest operations and host bearer token for host operations. Reject wrong-room, stale, missing, or guest host tokens. Use service-role DB client only inside Edge Functions after token validation; transaction helpers are non-exposed and callable only by service_role.
- [ ] Integrate YouTube IFrame Player API only on the host screen. Handle ready, play, pause, ended, and embed-error states.
- [ ] Prompt the host to tap to start when browser autoplay restrictions block audio.
- [ ] Apply playback invalidation notices idempotently. Re-fetch the playback snapshot through host-token-authorized Edge Function on the host screen and guest-token-authorized Edge Function on remotes. On reconnect, re-fetch authoritative state.
- [ ] Add guest play/pause/skip controls and host end/clear/lock controls. Explain locked and ended states.
- [ ] Test non-member rejection, guest host-command rejection, locked controls, unembeddable-video skip, and autoplay prompt behavior.
- [ ] Run unit, integration, e2e, and build checks; commit as feat: synchronize YouTube playback and host controls.

## Task 9: Add voting and activity attribution

**Files:** Create src/features/queue/VoteButton.tsx, src/features/queue/voteApi.ts, tests/unit/voteState.test.ts, tests/integration/voteApi.test.ts; create supabase/migrations/0004_votes_and_events.sql.

**Interfaces:** `toggleVote(roomId, guestToken, queueSongId)` returns the authoritative vote count through an Edge Function. Room events record join/add/skip/leave without credentials.

- [ ] Add votes unique per song and member, enforce same-room relationships, and revoke browser table grants.
- [ ] Test one vote per member, toggle off, cross-room voting rejection, and removed-song rejection.
- [ ] Render vote counts without changing queue ordering; queue position remains authoritative.
- [ ] Record room events through trusted Edge Function/database operations and test that event payloads contain no session or host tokens.
- [ ] Run tests and build; commit as feat: add token-secured voting and room activity events.

## Task 10: Polish, CI, deployment, and device verification

**Files:** Update src/styles.css, room/queue/playback components, README.md, playwright.config.ts, .github/workflows/ci.yml, and .env.example.

- [ ] Add accessible labels, keyboard focus, 44px touch targets, responsive phone layout, loading/error/empty states, and reduced-motion support.
- [ ] Document local setup, anonymous Auth configuration, migrations, functions, and environment variables.
- [ ] Add CI for unit tests, build, local Supabase integration, and deterministic browser tests without production secrets. Add a guest-token test proving Auth-only callers cannot fetch room data.
- [ ] Configure Vercel for SPA route refresh. Configure public Supabase URL and anon key only as client variables.
- [ ] Configure YOUTUBE_API_KEY as a Supabase Edge Function secret. Verify service-role and API keys are absent from client build assets and git history.
- [ ] Run npm test, npm run build, and npx playwright test.
- [ ] Deploy only after receiving production credentials and deployment authorization. Test QR scanning with a real phone, roster, queue, playback, autoplay prompt, and unembeddable-video skip.
- [ ] Commit as chore: document and verify karaoke deployment.

## Acceptance Criteria

- Host creates an unlisted room and sees room ID and QR code.
- Guest joins by room ID or QR; no login UI appears.
- Everyone sees current participants and song attribution.
- Guest searches when the YouTube key exists or pastes a YouTube URL/ID without it.
- Songs appear in a consistent ordered queue on all clients.
- Guests control playback and manage their own songs; host can manage all songs.
- Host can end room, clear queue, and lock/unlock guest controls.
- Only host screen plays video/audio. Realtime sends non-sensitive invalidation notices; all room data is refetched through guest-token or host-token Edge Functions.
- Browser table reads/writes are denied; every room data request validates guest token, and host actions validate host token. Secrets remain server-side.
- Automated core-flow tests pass and real-phone QR flow is manually verified.

## Review Notes

- Task 2 is a mandatory security review gate: no database migrations are written or applied until the user approves the revised Edge Function, token, and Realtime blueprint.
- Anonymous Auth is an implementation identity only; it does not add a visible login requirement.
- Production Supabase, YouTube secrets, and Vercel deployment require user-provided credentials and explicit authorization.
