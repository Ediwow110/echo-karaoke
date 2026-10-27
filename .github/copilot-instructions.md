# GitHub Copilot Custom Instructions for online-karaoke

> Sauron Universal Harness v1.0.0

## Project Stack

- Runtime: Node.js 24, TypeScript 5.9, ESM
- App: React 19 and Vite 8 SPA (`src/`)
- Server: one Vercel Function (`api/router.ts`), Better Auth, Neon Postgres, authorized SQL operations in `supabase/migrations`
- Tests: Vitest (unit and integration), Playwright (mocked UI and real host/guest flows), pgTAP through the Supabase CLI
- Authoritative workflow and commands: `CLAUDE.md` and `README.md`

## Coding and Architectural Guidelines

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

## Fellowship Sub-Agents and Roles

- **Elessar** (Principal System Architect): /aragorn
- **Shield of Gondor** (Security Auditor and Shield): /boromir
- **Ringbearer** (Core Task Executor): /frodo
- **Mithrandir** (Master Planner and Strategy Guide): /gandalf
- **Lockbearer** (Refactorer and AST Dead Code Slasher): /gimli
- **Greenleaf** (Precision Linter and Syntax Bug Hunter): /legolas
- **Brandir** (QA and TDD Specialist): /merry
- **Took** (Edge Case and Chaos Prober): /pippin
- **The Brave** (Git Commits and State Keeper): /samwise

## Available Department Skills

- `/plan-feature`: Plan Feature (architecture)
- `/schema-design`: Schema Design (architecture)
- `/ci-generator`: Ci Generator (devsecops)
- `/conventional-commit`: Conventional Commit (devsecops)
- `/api-doc-gen`: Api Doc Gen (docs)
- `/readme-generator`: Readme Generator (docs)
- `/edge-fuzzer`: Edge Fuzzer (qa)
- `/tdd-runner`: Tdd Runner (qa)
- `/secrets-scan`: Secrets Scan (security)
- `/security-audit`: Security Audit (security)
- `/caveman`: Caveman (workflow)

## Anti-Patterns and Prohibitions

- AP-1 (Vague task verb) : Always decompose requests into concrete atomic tasks.
- AP-6 (Monolithic prompt) : Never combine architecture, code, and test in one step.
- AP-14 (Leaking secrets) : Zero credentials in version control.
- AP-17 (Skipping tests) : Code without a prior failing test is unverified code.
- AP-18 (Non-atomic commit) : One logical concern per commit.
- AP-52 (Fake fix) : Masking errors with type casts or empty catch blocks is prohibited.
