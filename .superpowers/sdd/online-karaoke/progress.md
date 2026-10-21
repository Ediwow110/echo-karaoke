# SDD ledger — plan: docs/superpowers/plans/2026-10-18-online-karaoke-implementation.md

Workspace: G:/Vscode/online-karaoke/.worktrees/online-karaoke
Branch: feature/online-karaoke
Started from: 91198894488c601cff1d7ef97d7e9f8068c9a9db
Plan: docs/superpowers/plans/2026-10-18-online-karaoke-implementation.md

## Preflight task self-consistency

| Task | Check | Finding / ruling |
|---|---|---|
| 1 | Files, smoke test, scripts, build | Consistent; app screen should be minimal and dependency scope limited to listed stack. |
| 2 | Blueprint then migration | Explicit security approval gate; stop after blueprint and ask the user before applying migrations. |
| 3 | Operations rely on reviewed schema | Depends on Task 2. Ruling: session-to-member relationship and host-token verification must be resolved in Task 2 blueprint before implementation. |
| 4 | Routes depend on Task 3 APIs | Consistent; QR package is not named. Ruling: use a maintained small QR package or generate SVG; select during task based on available dependencies. |
| 5 | Queue schema / APIs | Server-side oEmbed function is named but absent in explicit file list. Ruling: create supabase/functions/youtube-oembed/index.ts within Task 5, as task text requires. |
| 6 | Search and moderation | Depends on queue contract from Task 5. Ruling: keep queue management in Task 6 as specified; use reviewed DB functions for host privilege. |
| 7 | Presence interface | Uses membership established by Tasks 2-4; consistent. |
| 8 | Playback and privileged controls | Requires approved host capability from Task 2; tests cover lock and ended state. |
| 9 | Votes and event attribution | Depends on queue/member schema, consistent. |
| 10 | Deploy / CI | Follows app and test scripts created earlier, consistent. |

## Shared file/interface scan

| Task pair | Shared file or interface | Check |
|---|---|---|
| 1 / 3 | src/lib/supabase.ts and package.json | Task 1 installs Supabase JS; Task 3 owns client configuration, no source overlap. |
| 2 / 3 | rooms and members schema / room API | Task 2 blueprint and approved schema precede Task 3 client contract. |
| 2 / 5 | migrations and queue RLS | Task 2 defines all tables and policy model; Task 5 adds queue migration after approval. |
| 2 / 7 | members and private Realtime | Task 2 specifies channel authorization; Task 7 implements subscription and UI. |
| 2 / 8 | host capability and room commands | Task 2 defines host proof; Task 8 consumes that approved contract. |
| 4 / 7 | host/guest room views | Task 4 creates shells; Task 7 adds roster components without replacing routing. |
| 5 / 6 | addSong, SongMetadata, QueueList | Task 5 defines interfaces; Task 6 consumes them and adds search/moderation. |
| 5 / 8 | queue status and playback state | Task 5 creates queue status; Task 8 transactionally advances playback. |
| 6 / 9 | queue songs and member attribution | Task 6 exposes queue identity; Task 9 adds votes/activity linked to those IDs. |
| 7 / 8 | private room channel | Task 7 provides presence and reconnect pattern; Task 8 publishes playback state through authorized channel. |
| 1 / 10 | scripts, .env.example, workflow | Task 1 establishes scripts/env file; Task 10 extends them for CI/deploy. |

## Task 1

BASE: 91198894488c601cff1d7ef97d7e9f8068c9a9db
Status: implementation committed; independent task review pending
Commit: 97bf96d chore: bootstrap karaoke web app
TDD evidence: implementer-recorded RED (missing App module), GREEN (1/1 test)
Fresh verification: npm test 1/1, npm run build passed, git diff --check clean. Review commit range 9119889..97bf96d.

### Task 1 review and fix round 1
Review: request changes. Responsive overflow at 621-750px; low contrast at CSS lines 32,48,64; RED failure was module resolution and executed zero tests, so not behavioral RED evidence.
Ruling: fix confirmed layout and contrast defects. Preserve the fact that the recorded RED failed before assertions; do not fabricate behavioral RED evidence. The original test-first attempt is therefore weaker than intended, but current behavioral coverage remains. Cost if wrong: leave an avoidable weakness in the TDD history.
Fix base: 97bf96d.

Task 1: fix round 1/5 (responsive and contrast findings addressed; commit 557d744; test harness correction 6d4db16; restored coverage fd884b5)
Task 1: complete (commits 9119889..fd884b5, review findings addressed; scoped re-review approved)

## Task 2 - token-gated database and Edge Function boundary

Status: implementation complete, independent security review dispatched.

Approved design: docs/superpowers/plans/room-security-blueprint.md (user re-approved after the guest token became mandatory on every data request).

Commits:
- 542fbba docs: require the guest token on every room data request
- 61997b2 feat: add token-gated karaoke room schema
- 8e86468 feat: add token-validating room Edge Functions

Verification evidence:
- npx supabase db reset: applied 0001_room_core.sql cleanly.
- npx supabase test db: 52 pgTAP assertions pass, covering zero anon/authenticated table privileges, zero function execution grants for browser roles, RLS on every table, closed private schema, room code and ended-state constraints, token digests stored instead of plaintext, wrong and cross-user and cross-room token rejection, host-only commands, guest lock, ended-room read returning status only, and ROOM_NOT_FOUND versus ROOM_ENDED.
- npm run test:integration against served functions: 4 tests pass covering missing session, missing and wrong room token, cross-user and cross-room tokens, host-only operations, and distinct unknown and ended rooms.
- npm test: 3 unit tests pass.
- npm run build: passes.

Defects found and fixed during the task:
- Collapsed dollar quoting in the migration when helper functions were inserted, which broke the first migration apply.
- read_room_guest and read_room_host did not return a top-level status, so callers could not distinguish live from ended without parsing the nested room projection.
- pgTAP tests passed text into uuid parameters, which Postgres will not implicitly cast for function arguments; the tests now use a typed context table.

Deliberately deferred to later tasks: queue mutation, playback commands, voting, and Realtime invalidation. Task 2 ships only rooms, members, host secrets, queue and vote and event tables, and the room lifecycle operations.

Local stack: npx supabase start, then npx supabase functions serve, then npm run test:integration with LOCAL_SUPABASE_URL and LOCAL_SUPABASE_ANON_KEY set.


## Tasks 3 and 4 - typed client and room screens

Commits: eb13307 feat: add typed token-scoped room client; a65e11a feat: add host, join and room screens; plus a styling commit.

Verification evidence:
- npm test: 42 unit tests pass (room codes, display names, edge api headers and typed errors, token isolation per room, room api wiring, room url helpers, landing screen).
- npx tsc --noEmit and npm run build pass.
- npm run test:integration: 5 tests pass against the local stack, including the typed client wrapper.
- Direct database audit: information_schema shows no anon or authenticated privileges on any karaoke table; has_function_privilege is false for anon and authenticated on create_room, join_room and host_command and true for service_role; anon cannot use the private schema or execute private helpers; all 12 SECURITY DEFINER functions pin search_path to empty; service_role holds only SELECT, INSERT, UPDATE and DELETE after trimming TRUNCATE, REFERENCES and TRIGGER.

Notes:
- Room screens poll the token-checked read functions every four seconds. Realtime invalidation replaces polling in Task 7.
- Playwright end-to-end coverage is not written yet; component and API-level integration tests cover the flows so far. Real browser and real phone verification stay on the Task 10 gate.
- The QR component renders library-generated SVG for the same-origin join URL.


## Tasks 5, 6 and 8 - queue, search, playback

Commits: feat: add token-scoped song queue; feat: add YouTube search behind the room pass; feat: add token-scoped playback and host controls; feat: style the karaoke player and playback controls.

Verification evidence:
- npx supabase test db: 97 assertions pass across room_core, queue and playback suites.
- npm run test:integration: 10 tests pass, covering queue add with server-resolved metadata, invalid and unknown videos, ownership rejection, guest lock on add and playback, host moderation while locked, playback play/pause/skip, position reporting, and search authorization without a key.
- npm test: 75 unit tests pass. npm run build passes.

Server rules proven by tests: five additions per minute per member, guest lock blocks guest queue and playback but not the host, guests act only on their own songs, positions stay unique under a room lock, the first queued song becomes current on play, skip marks the song played and promotes the next, playback stops at room end, and host position reporting requires the host pass.

Design notes:
- Video titles come from YouTube oEmbed on the server, so clients cannot invent metadata and unresolvable links never create rows.
- Search returns available:false with a message when YOUTUBE_API_KEY is absent; pasting a link stays the fallback.
- The host screen owns the only player. The player factory is injected so tests drive it without loading the YouTube IFrame API.

Still open: voting and activity events, roster heartbeat, Realtime invalidation instead of polling, docs and CI, and real browser plus phone verification.


## Task 9 and launch docs - voting, heartbeat, README, CI

Commits: feat: add token-secured voting and roster heartbeat; docs: describe setup, security model and release checks.

Verification evidence:
- npx supabase test db: 113 assertions across room_core, queue, playback and votes suites.
- npm run test:integration: 11 tests pass, now including vote toggle, unvote, wrong-pass rejection, unknown song rejection, locked voting, and heartbeat with a wrong pass.
- npm test: 79 unit tests pass. npm run build passes.

Fixed during the task: vote_toggle reported votedByViewer using FOUND after a later count query, so the flag was always wrong; the result now captures the prior vote state in a variable. A room-code fixture in the votes suite was 15 characters, which the format check correctly rejected.

Known gaps for the next rounds: Realtime still polls every four seconds instead of using a fixed invalidation channel; there is no Playwright end-to-end run, no real browser or phone verification, and no production deployment because that needs explicit authorization and real credentials.

