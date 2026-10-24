# Search-only Song Entry Implementation Plan

> **For agentic workers:** Use `executing-plans` inline. User approved implementation in the current checkout without committing.

**Goal:** Remove redundant paste-link entry from host and guest song search.

**Architecture:** Delete the shared panel's paste-form import/render and the unused component. Keep search results, their Add buttons, and queue APIs unchanged. Update obsolete fallback copy and tests.

**Tech Stack:** Existing React/TypeScript, Vitest, Playwright MCP.

## Global Constraints

- Follow `docs/superpowers/specs/2026-10-23-search-only-song-entry-design.md`.
- No new controls, dependencies, auth changes, commits, pushes, or deployments.
- Preserve prior performance fixes and unrelated working-tree changes.
- Preserve existing colors, typography, spacing, and search behavior; remove the paste divider and its occupied space only.

### Task 1: Search-only entry (in progress)

**Files:** `src/features/queue/SongSearchPanel.tsx`, `src/features/queue/useSongSearch.ts`, `src/features/queue/PasteSongForm.tsx`, `tests/unit/songSearchPanel.test.tsx`, `tests/unit/guestRoomPage.test.tsx`, `tests/e2e/room-flow.spec.ts`; copy-only edits in `server/operations/youtube.ts`, the three `supabase/functions/youtube-*` entrypoints, `README.md`, and `docs/deployment/hosted-setup.md`.

**Interfaces:** Keep `SongSearchPanelProps`, `useSongSearch`, `addSong`, and all API payloads unchanged.

- [x] Extend host/guest panel tests with `expect(screen.queryByLabelText(/paste a youtube link/i)).not.toBeInTheDocument()` before and after searches. Guest tests use a search result and its `Add` button; locked guests cannot invoke `queue-command`.
- [x] Run `npm test -- tests/unit/songSearchPanel.test.tsx tests/unit/guestRoomPage.test.tsx`; confirm missing-form assertions fail before implementation.
- [x] Remove the `PasteSongForm` import and final render block from `SongSearchPanel`; delete `PasteSongForm.tsx`. No replacement markup.
- [x] Replace paste fallback messages with `Search is not configured. Ask the host to enable YouTube search.`, `YouTube search is unreachable right now. Try again.`, or `Try again tomorrow.` according to the failure. Keep status codes, rate-limit values, and response shape unchanged.
- [x] Update browser flows to fill `Find a song on YouTube`, find the result row containing `Never Gonna Give You Up`, and press its `Add` button. Assert the existing added notice and queue content; the permission test searches then verifies `Add` is disabled.
- [x] Update current README/setup guidance to describe search-only entry; leave historical plans/specs unchanged.
- [x] Run focused tests, `npm test`, and `npm run build`. Inspect `git diff --check` and verify no paste guidance remains in runtime code.
- [ ] Use Playwright MCP against `http://localhost:3000` to verify host and guest search have no paste form, search still returns Add controls, and add-to-queue still works. Capture screenshots under `shots/`.
- [ ] Review task-scoped diff and document evidence; keep work uncommitted.

## Evidence

- RED: focused suite failed five tests because the paste inputs and obsolete messages remained. GREEN: all 13 focused tests pass.
- Full suite: 48 files / 250 tests pass. Build passes with 203 modules (down from 207); shared search chunk 16.50 KB / 5.10 KB gzip (previously 24.88 KB / 7.75 KB gzip).
- Live Playwright MCP: host search returned HTTP 200, displayed result Add buttons, and had zero paste inputs/forms. A separate 390px guest browser joined the room, searched for ABBA Dancing Queen karaoke, and showed a result Add button with zero paste inputs.
- Visual evidence: `shots/search-only-host.png`, `shots/search-only-guest.png`.
