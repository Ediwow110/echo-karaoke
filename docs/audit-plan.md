# Production-Readiness Audit — Task Tracker

Repository: G:\Vscode\online-karaoke
Auditor: OpenCode (senior architect / security / staff FE / BE / DB / QA / DevOps / UX)
Status: IN PROGRESS
Base commit: 025b4ec (branch master, pushed to https://github.com/Ediwow110/echo-karaoke)

## Passes
| Pass | Scope | Status |
|---|---|---|
| Pass 1 | Map repo, docs, config, dependencies | done |
| Pass 1 | Architecture & business logic trace | running |
| Pass 1 | AuthN / AuthZ | running |
| Pass 1 | Database / migrations / constraints | running |
| Pass 1 | API / validation / security | running |
| Pass 1 | Frontend / UX / a11y / performance | running |
| Pass 1 | Testing / CI / production readiness | running |
| Pass 2 | Adversarial second pass (prove first pass wrong) | pending |
| Pass 3 | Cross-validation of Critical/High findings | pending |
| Final | Write final report | pending |

The six Pass 1 domains run as independent read only auditors, one per domain, so that
no two reviewers share an assumption. Pass 2 takes every finding back and tries to
refute it, and Pass 3 re-checks only the Critical and High findings against the code
path, because a reviewer can cite a correct line next to a wrong severity.

## Pass 1, the repository map
Tracked files, 275 in total, on one branch with no history beyond the ECHO rewrite.

| Area | Files | Lines | What it holds |
|---|---|---|---|
| `src/` | 71 | 8298 | The React client: `app/` screens and routing, `features/` rooms, queue, playback, library, `lib/` Supabase client and Edge transport, `ui/` primitives |
| `supabase/functions/` | 16 | 1281 | Thirteen Deno Edge Functions plus `_shared/room.ts`, the shared auth, CORS and error layer |
| `supabase/migrations/` | 19 | 2841 | The schema and the authorized operations, 0001 through 0019 |
| `supabase/tests/` | 7 | 1077 | The pgTAP suites |
| `tests/` | 42 | 3530 | Thirty nine Vitest files for logic and components, two Playwright specs for the real flows |
| `scripts/` | 5 | 309 | The deploy guard, the preview verifier, the dev tunnel |
| `public/` | 16 | | The fonts, the images, the favicon, `robots.txt`, `llms.txt` |
| `docs/` | 10 | | The specs and the plans under `docs/superpowers/`, the hosted setup runbook, this tracker |
| `.github/` | 3 | | The CI workflow, the issue and pull request templates |

Runtime dependencies: `@phosphor-icons/react`, `@supabase/supabase-js`, `jsqr`, `qrcode`,
`react`, `react-dom`, `react-router-dom`. Seven in total, and none of them is a server
framework, a date library, a state manager, a validation library, or a test runner in
the production path.

Build tooling: Vite 8, Tailwind 4, TypeScript 7, Vitest 5, Playwright 1.64, the
Supabase CLI 2.121.0 pinned in the CI workflow.

## Evidence collected before the audit
- Local gates green on the base commit: build pass, unit 193/193, database 210/210, Edge
  integration 17/17, Playwright 9/9, `npm audit --audit-level=high` 0 findings.
- The full CI path was reproduced locally before it ever ran on GitHub: `supabase db reset`
  applied migrations 0001 to 0019 and the seed from scratch, `supabase test db` passed
  210/210, the `supabase status -o env` extraction used by the workflow returned the
  API URL and the anon key, and the Edge integration suite passed 17/17 against the
  Edge Functions running in the container that `supabase start` brings up.
- First GitHub CI run 39779181642: `verify` succeeded, `production-artifact` skipped
  because the repository variables are not set yet, `database` still running.
- A Vercel preview deployment passes `npm run verify:preview`, and a browser check of
  that deployment reports zero console errors and zero warnings.

## Pass 1 findings, not yet validated
The Pass 1 auditors report here. Nothing in this section is a conclusion until Pass 2
has tried to refute it and Pass 3 has re-checked the Critical and High findings.

### AUTH-1: the host heartbeat is bound to the Auth user id while the host token is not
Pass 1 severity: Medium. Auditor confidence: High.
Proven against the local stack, not just read:
```
touch-member with the original session : 200
touch-member after the session swap    : 401 UNAUTHORIZED
host-room-read after the session swap  : 200, the host is still in control
```
`supabase/functions/touch-member/index.ts:22` accepts only the guest pass, and
`private.require_guest` matches on room, user id and digest together
(`supabase/migrations/0001_room_core.sql:168-172`). The client mints a new anonymous
user whenever the stored session is rejected (`src/lib/supabase.ts:61-64`), and the
host pass is not user bound (`0001_room_core.sql:198-202`), so the host keeps full
control while its member row stops being refreshed. The sweep in
`supabase/migrations/0019_abandoned_room_cleanup.sql:29-36` then deletes the live room
thirty minutes later and cascades the queue, the votes, the events and the host secret.
**Severity raised to High by the auditor's own severity rubric:** this is data loss of a
live room with an active host, and the trigger is a long session, because the local
Auth configuration expires the access token after one hour.
Proposed fix: accept the host pass in `touch-member` and resolve the host member
through `private.require_host`, which is not bound to a user id, so the heartbeat
survives an Auth session replacement.

### AUTH-2: the heartbeat never checks the room state
Pass 1 severity: Low. Auditor confidence: High.
`public.touch_member` (`0001_room_core.sql:540-562`) has no `private.require_live`,
unlike every other mutation, so a deliberate heartbeat loop keeps an ended room alive
past the retention window. The honest client stops polling an ended room
(`src/features/rooms/useRoomData.ts:85-87`), so only a deliberate loop triggers it.

### AUTH-3: the vote path is the only member write without a rate limit
Pass 1 severity: Low. Auditor confidence: High.
`supabase/functions/vote-command/index.ts:1-47` carries no limiter, and
`0001_room_core.sql:97-111` and `0015_vote_reorder_locks.sql:58` append a
`room_events` row on every toggle, so a vote loop grows that table without bound.

### AUTH-4: the room creation cap is keyed on a resettable identity
Pass 1 severity: Info. Auditor confidence: High.
`0018_retention_and_creation_limits.sql:78` keys the ten rooms per hour on the
anonymous user id, which the client can mint again at will, so the real ceiling is the
hosted anonymous sign-in limit times ten. The abandoned sweep bounds the effect.

## Findings ledger (id | severity | confidence | title)
(appended as verified in Pass 2 and Pass 3)

## Notes
- The audit is read only. No production code is changed while it runs.
- The report is written outside the tracked tree first, because the repository is
  public and a report that names a live weakness is a disclosure. Committing the
  report is a separate decision for the owner.
