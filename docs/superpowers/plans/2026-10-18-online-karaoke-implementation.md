# Online Karaoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a login-free YouTube karaoke web app where a host creates a room and guests join by room ID or QR code to search and add songs, control playback, and see who is present.

**Architecture:** A React and TypeScript Vite SPA provides host and guest views. Supabase provides anonymous sessions, Postgres, Row Level Security, Edge Functions, and Realtime. The host browser alone plays YouTube through its embedded player. YouTube search uses a server-side function when configured; pasting a YouTube URL or video ID works without the search key.

**Tech Stack:** React, TypeScript, Vite, Tailwind CSS, Supabase Auth/Postgres/Realtime/Edge Functions, YouTube IFrame Player API, YouTube Data API v3, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-10-18-online-karaoke-design.md

## Global Constraints

- No user-facing login or account creation; anonymous session identity supports room membership.
- A room ID or QR URL grants guest access. Rooms are unlisted, not secret.
- Enable Row Level Security on every application table and deny access by default.
- Never ship Supabase service-role credentials or the YouTube API key to the browser.
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

**Files:** Create docs/superpowers/plans/room-security-blueprint.md. After approval only, create supabase/config.toml and supabase/migrations/0001_room_core.sql.

**Interfaces:** Define tenant isolation, session identity, host proof, safe room-code join, table access policies, and private Realtime authorization.

- [ ] Specify how anonymous Supabase Auth maps an installation session to members without showing login UI.
- [ ] Specify rooms, members, queue_songs, votes, and room_events with foreign keys, allowed states, unique constraints, and indexes for all policy filters.
- [ ] Define room-code join so an unjoined caller can join a live room without exposing host secrets or allowing arbitrary room reads.
- [ ] Define host capability storage and verification, guest membership authorization, and denial rules for ended rooms and locked controls.
- [ ] Define per-table RLS policies for select, insert, update, and delete. Include positive and negative policy tests.
- [ ] Define private Realtime channel authorization. Presence payloads identify roster entries but never grant permissions.
- [ ] Present the blueprint and STOP for user approval before writing/applying migrations or connecting to a hosted project.
- [ ] After approval, implement the reviewed local migration, run supabase db reset, and test member, non-member, guest, and host access.
- [ ] Commit as feat: add room schema and deny-by-default policies.

## Task 3: Add room and identity operations

**Files:** Create src/lib/supabase.ts, src/lib/validation.ts, src/features/rooms/roomCode.ts, src/features/rooms/roomApi.ts, tests/unit/roomCode.test.ts, tests/unit/validation.test.ts, tests/integration/roomApi.test.ts; add reviewed room-operation migration as needed.

**Interfaces:**

    normalizeDisplayName(value: string): string
    generateRoomCode(): string
    createRoom(): Promise<CreatedRoom>
    joinRoom(code: string, displayName: string): Promise<JoinedRoom>

CreatedRoom returns roomId, roomCode, memberId, and hostToken. JoinedRoom returns roomId, memberId, normalized displayName, and guest role.

- [ ] Write tests for the room-code alphabet and length, generated codes being distinct across repeated runs, display-name trimming, empty-name fallback, Unicode, and 32-character cap.
- [ ] Run focused tests and confirm failure before implementation.
- [ ] Implement cryptographically secure room-code generation and display-name normalization.
- [ ] Create the browser Supabase client using only public URL and anon key; throw an actionable configuration error if absent.
- [ ] Implement create and join through the reviewed database operations. Store the host capability only in host localStorage and never expose its hash.
- [ ] Test create, valid join, duplicate/rejoin, unknown room, ended room, and invalid display name against local Supabase.
- [ ] Run unit and integration tests; commit as feat: create and join anonymous karaoke rooms.

## Task 4: Build host, join, and QR flows

**Files:** Create src/app/routes.tsx, src/features/rooms/HomePage.tsx, src/features/rooms/HostRoomPage.tsx, src/features/rooms/JoinRoomPage.tsx, src/features/rooms/GuestRemotePage.tsx, src/features/rooms/RoomQrCode.tsx, src/features/rooms/roomUrl.ts, tests/unit/roomUrl.test.ts, tests/e2e/room-join.spec.ts.

**Interfaces:** Routes are /, /room/:roomId/host, and /join/:roomCode. QR encodes the absolute join URL.

- [ ] Test join URL construction with special-character room codes and multiple origins.
- [ ] Implement route parsing, room creation action, visible room ID, QR code, and copyable join URL.
- [ ] Implement room-ID entry and QR landing. Ask for a display name, await server confirmation, then show joined state.
- [ ] Show distinct invalid-room, ended-room, loading, and network-error states.
- [ ] Add a browser test creating a room in one context and joining by code and direct QR URL in another.
- [ ] Run unit tests, e2e room flow, and build; commit as feat: add host and QR guest room flows.

## Task 5: Implement YouTube URL fallback and queue insertion

**Files:** Create src/features/queue/youtubeVideo.ts, src/features/queue/queueApi.ts, src/features/queue/PasteSongForm.tsx, src/features/queue/QueueList.tsx, tests/unit/youtubeVideo.test.ts, tests/integration/queueApi.test.ts; create supabase/migrations/0002_queue.sql and a server-side oEmbed metadata function.

**Interfaces:**

    parseYouTubeVideoId(input: string): string | null
    addSong(roomId: string, song: SongMetadata): Promise<QueueSong>

SongMetadata has videoId, title, channelTitle, thumbnailUrl, and nullable durationSeconds.

- [ ] Test accepted watch, short, embed, and raw-ID forms. Reject empty input, unsupported hosts, invalid IDs, and extra paths.
- [ ] Run the parser tests and confirm they fail before implementation; implement strict URL parsing with the URL API.
- [ ] Add queue schema with status constraints, room and member references, unique room/position, and indexes. Enable RLS and test each policy's allow and deny cases.
- [ ] Implement a transactional database function that appends a song with a unique next position and enforces the per-member rate limit of 5 per minute.
- [ ] Implement server-side metadata lookup for pasted IDs. Do not create a queue row if metadata resolution fails; show an actionable error.
- [ ] Render queue title, channel, thumbnail, position, and adder's display name; subscribe to queue changes.
- [ ] Test simultaneous adds, duplicate videos, rate limiting, ended-room rejection, and cross-room reads.
- [ ] Run unit/integration tests and build; commit as feat: add YouTube links to shared song queue.

## Task 6: Add YouTube search and queue management

**Files:** Create supabase/functions/youtube-search/index.ts, src/features/queue/SongSearch.tsx, src/features/queue/QueueControls.tsx, tests/integration/youtubeSearch.test.ts.

**Interfaces:** Search receives roomId and query with the caller's anonymous session and returns up to 10 SongMetadata results. The YouTube key is an Edge Function secret.

- [ ] Test successful response mapping, empty results, missing key, quota failure, malformed upstream response, timeout, and unauthorized room.
- [ ] Validate active room membership, trim query, reject empty queries, cap query length at 100 characters, and return at most 10 results.
- [ ] Implement the Edge Function using server-side key access only. Never log credentials or session tokens.
- [ ] Return a typed unavailable response on missing key or upstream failure; keep URL/ID entry available.
- [ ] Implement search results and add buttons using the same addSong operation as the paste flow.
- [ ] Implement guest reorder/remove only for own songs and host reorder/remove for any song through reviewed server-authorized functions.
- [ ] Test that a guest cannot modify another member's song. Run functions tests, local Supabase checks, and build; commit as feat: search YouTube and manage karaoke queue.

## Task 7: Add live participant roster and recovery

**Files:** Create src/features/rooms/useRoomPresence.ts, src/features/rooms/ParticipantRoster.tsx, tests/unit/roomPresence.test.ts, tests/e2e/room-presence.spec.ts.

**Interfaces:** useRoomPresence(roomId, memberId) returns participants and connectionState, and removes its channel subscription when the view unmounts.

- [ ] Test presence join, sync, leave, duplicate events, and reconnect behavior.
- [ ] Implement private room presence keyed by member ID and authorized only for members.
- [ ] Render names and host/guest roles on host and guest screens. Preserve durable membership when a user disconnects.
- [ ] On reconnect, fetch authoritative room/queue/playback state before resuming event processing.
- [ ] Test host plus two guests joining/leaving, and a non-member presence subscription being rejected.
- [ ] Run tests and build; commit as feat: show live karaoke room participants.

## Task 8: Implement synchronized playback and host controls

**Files:** Create src/features/playback/YouTubePlayer.tsx, src/features/playback/playbackApi.ts, src/features/playback/PlaybackControls.tsx, src/features/rooms/HostRoomControls.tsx, tests/unit/playbackState.test.ts, tests/integration/roomCommands.test.ts, tests/e2e/playback-controls.spec.ts; create supabase/migrations/0003_playback_controls.sql.

**Interfaces:** Playback snapshot contains currentSongId, positionSeconds, isPlaying, and updatedAt. Guest commands are play, pause, and skip. Host commands are end-room, clear-queue, lock-guests, and unlock-guests.

- [ ] Test play, pause, skip to next queued song, empty queue, song-ended transition, locked guest action, and ended-room immutability.
- [ ] Implement transactional room commands with server-side membership and host-token checks. Reject wrong-room, stale, missing, or guest host tokens.
- [ ] Integrate YouTube IFrame Player API only on the host screen. Handle ready, play, pause, ended, and embed-error states.
- [ ] Prompt the host to tap to start when browser autoplay restrictions block audio.
- [ ] Apply playback updates idempotently from authorized realtime events; on reconnect, reload authoritative state.
- [ ] Add guest play/pause/skip controls and host end/clear/lock controls. Explain locked and ended states.
- [ ] Test non-member rejection, guest host-command rejection, locked controls, unembeddable-video skip, and autoplay prompt behavior.
- [ ] Run unit, integration, e2e, and build checks; commit as feat: synchronize YouTube playback and host controls.

## Task 9: Add voting and activity attribution

**Files:** Create src/features/queue/VoteButton.tsx, src/features/queue/voteApi.ts, tests/unit/voteState.test.ts, tests/integration/voteApi.test.ts; create supabase/migrations/0004_votes_and_events.sql.

**Interfaces:** toggleVote(queueSongId) returns the authoritative vote count. Room events record join, add, skip, and leave without secrets.

- [ ] Add votes unique per song and member with RLS and same-room membership checks.
- [ ] Test one vote per member, toggle off, cross-room voting rejection, and removed-song rejection.
- [ ] Render vote counts without changing queue ordering; queue position remains authoritative.
- [ ] Record room events through trusted operations and test that event payloads contain no session or host tokens.
- [ ] Run tests and build; commit as feat: add song voting and room activity events.

## Task 10: Polish, CI, deployment, and device verification

**Files:** Update src/styles.css, room/queue/playback components, README.md, playwright.config.ts, .github/workflows/ci.yml, and .env.example.

- [ ] Add accessible labels, keyboard focus, 44px touch targets, responsive phone layout, loading/error/empty states, and reduced-motion support.
- [ ] Document local setup, anonymous Auth configuration, migrations, functions, and environment variables.
- [ ] Add CI for unit tests, build, local Supabase integration, and deterministic browser tests without production secrets.
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
- Only host screen plays video/audio; room state synchronizes in realtime.
- RLS denies non-members and unauthorized host actions; secrets remain server-side.
- Automated core-flow tests pass and real-phone QR flow is manually verified.

## Review Notes

- Task 2 is a mandatory security review gate: no database migrations are applied until the user approves the concrete RLS and Realtime blueprint.
- Anonymous Auth is an implementation identity only; it does not add a visible login requirement.
- Production Supabase, YouTube secrets, and Vercel deployment require user-provided credentials and explicit authorization.
