# GEMINI.md

> Governed by Sauron v1.0.0. Persistent context and instructions for Gemini CLI.

## Project Overview & Tech Stack

Production codebase governed by Sauron Universal Agent Harness.
- Runtime: Node.js 24, TypeScript 5.9, ESM
- App: React 19 and Vite 8 SPA in `src/`
- Server: one Vercel Function at `api/router.ts`, Better Auth, Neon Postgres, and authorized SQL operations in `supabase/migrations`
- Tests: Vitest (unit), Playwright (mocked UI and real host/guest flows), pgTAP through the Supabase CLI, and Vitest integration against a disposable Neon branch

## Essential Commands

- Build and typecheck: `npm run build`
- Unit and component tests: `npm test`
- Mocked UI flows: `npm run test:e2e:ui`
- Real host/guest flows: `npm run test:e2e` (needs `vercel dev` or `E2E_BASE_URL`)
- Integration: `npm run test:integration` (needs a disposable Neon branch)
- Database: `npx supabase test db --db-url "$NEON_DATABASE_URL"`
- Single unit test: `npx vitest run tests/unit/<filename>.test.ts`

## Architectural & Coding Guidelines

- Present tense, active voice, English language exclusively.
- Zero emojis across all code files, comments, and commit messages.
- Prohibit Latin abbreviations: use 'for example', 'that is', 'and so forth'.
- Prohibit em dashes: use colons, parentheses, or separate sentences.
- Strict Red-Green-Refactor TDD required before touching production code.
- Zero untyped boundary parameters: enforce runtime validation (Zod, Pydantic).
- Zero hardcoded secrets, connection strings, or unredacted logging output.
- Token Conservation & Caveman Mode: When invoked with '/caveman' (or 'lite', 'ultra'), eliminate conversational filler and pleasantries while preserving all code, commands, paths, and technical precision verbatim. Restore standard conversational style when requested with '/caveman off'.

## Token Optimization & Caveman Mode

- When contributor triggers `/caveman` (or `lite`, `ultra`), enforce terse, spartan communication.
- Drop conversational pleasantries, filler phrases, and tool narration overhead.
- Never alter or compress code blocks, diffs, file paths, or commands.
- Restore normal conversational style immediately when requested with `/caveman off`.

## Fellowship Sub-Agents Delegation

- **Elessar** (`/aragorn`): Principal System Architect
- **Shield of Gondor** (`/boromir`): Security Auditor and Shield
- **Ringbearer** (`/frodo`): Core Task Executor
- **Mithrandir** (`/gandalf`): Master Planner and Strategy Guide
- **Lockbearer** (`/gimli`): Refactorer and AST Dead Code Slasher
- **Greenleaf** (`/legolas`): Precision Linter and Syntax Bug Hunter
- **Brandir** (`/merry`): QA and TDD Specialist
- **Took** (`/pippin`): Edge Case and Chaos Prober
- **The Brave** (`/samwise`): Git Commits and State Keeper

## Gemini Behavior & Safety Boundaries

- AP-1 (Vague task verb) : Always decompose requests into concrete atomic tasks.
- AP-6 (Monolithic prompt) : Never combine architecture, code, and test in one step.
- AP-14 (Leaking secrets) : Zero credentials in version control.
- AP-17 (Skipping tests) : Code without a prior failing test is unverified code.
- AP-18 (Non-atomic commit) : One logical concern per commit.
- AP-52 (Fake fix) : Masking errors with type casts or empty catch blocks is prohibited.
- Never modify files in `.sauron/backups/` directly.
- Never commit secrets, credentials, or `.env` files.
- Always run tests and verify zero exit codes before concluding.
