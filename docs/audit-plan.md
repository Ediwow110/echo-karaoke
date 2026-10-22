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

## Findings ledger (id | severity | confidence | title)
(appended as verified in Pass 2 and Pass 3)

## Notes
- The audit is read only. No production code is changed while it runs.
- The report is written outside the tracked tree first, because the repository is
  public and a report that names a live weakness is a disclosure. Committing the
  report is a separate decision for the owner.
