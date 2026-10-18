# CLAUDE.md

> Managed by Sauron v1.0.0. Persistent instruction manual for Claude Code.

## Common Commands

- **Build Engine**: `npm run build`
- **Run Test Suite**: `npm test`
- **Typecheck**: `npx tsc --noEmit`
- **Run Single Test**: `node --test tests/<filename>.test.mjs`

## Architecture & Code Organization

- Context: Production codebase governed by Sauron Universal Agent Harness.
- `adapters/`: 17 runtime transpilation adapters, types, and safe conflict manager.
- `bin/`: CLI orchestrator and runtime entry points.
- `core/`: Fellowship sub-agent specifications and department skill metadata.
- `skills/`: 44 ECC-standard modular skills across 7 functional departments.
- `tests/`: Automated test suite executed with native Node.js test runner.

## Code Style & Conventions

- Present tense, active voice, English language exclusively.
- Zero emojis across all code files, comments, and commit messages.
- Prohibit Latin abbreviations: use 'for example', 'that is', 'and so forth'.
- Prohibit em dashes: use colons, parentheses, or separate sentences.
- Strict Red-Green-Refactor TDD required before touching production code.
- Zero untyped boundary parameters: enforce runtime validation (Zod, Pydantic).
- Zero hardcoded secrets, connection strings, or unredacted logging output.
- Token Conservation & Caveman Mode: When invoked with '/caveman' (or 'lite', 'ultra'), eliminate conversational filler and pleasantries while preserving all code, commands, paths, and technical precision verbatim. Restore standard conversational style when requested with '/caveman off'.

## Fellowship Sub-Agents

- **Elessar** (`/aragorn`): Principal System Architect
- **Shield of Gondor** (`/boromir`): Security Auditor and Shield
- **Ringbearer** (`/frodo`): Core Task Executor
- **Mithrandir** (`/gandalf`): Master Planner and Strategy Guide
- **Lockbearer** (`/gimli`): Refactorer and AST Dead Code Slasher
- **Greenleaf** (`/legolas`): Precision Linter and Syntax Bug Hunter
- **Brandir** (`/merry`): QA and TDD Specialist
- **Took** (`/pippin`): Edge Case and Chaos Prober
- **The Brave** (`/samwise`): Git Commits and State Keeper

## Token Optimization & Caveman Mode

- When contributor triggers `/caveman` (or `lite`, `ultra`), enforce terse, spartan communication.
- Drop conversational pleasantries, filler phrases, and tool narration overhead.
- Never alter or compress code blocks, diffs, file paths, or commands.
- Restore normal conversational style immediately when requested with `/caveman off`.
