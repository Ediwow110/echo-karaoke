# Task 1: Bootstrap the web application

Read this brief as the complete requirements for this task. The parent plan is docs/superpowers/plans/2026-10-18-online-karaoke-implementation.md. This is the first task on feature/online-karaoke, with no app source files yet.

## Files
Create package.json, index.html, vite.config.ts, tsconfig.json, src/main.tsx, src/app/App.tsx, src/styles.css, src/vite-env.d.ts, vitest.config.ts, tests/unit/app.test.ts, .env.example, and .gitignore.

## Goal and interfaces
Provide a small React + TypeScript Vite app with npm run dev, npm test, npm run build. Home screen exposes clearly labeled Create room and Join room entry points. No room behavior yet.

## Requirements
- Install React, React DOM, Vite, TypeScript, Tailwind CSS, Supabase JS, Vitest, jsdom, and React Testing Library. Keep dependency versions current/stable and report exact choices.
- TDD: first write a test rendering the app and asserting the Create room and Join room controls; run it and capture expected failure before implementing the UI.
- Create an accessible, polished landing screen using a deliberate karaoke-specific editorial art direction. Avoid generic gradients, common font defaults, and emoji icons. Keep scope limited to a useful first screen, not fake room features.
- Add .env.example with only VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, with blank/example values and no secrets.
- Ignore node_modules, dist, local .env files, and Playwright output. Preserve inherited Sauron files and do not alter generated rules.
- Follow workspace CLAUDE.md: active voice, no emojis, no em dashes, TDD, no hardcoded secrets.
- Do not dispatch subagents. The controller assigns review after your report.
- Run npm test and npm run build successfully. Inspect changed paths and commit only Task 1 files as chore: bootstrap karaoke web app.

## TDD evidence and report
Write full report to .superpowers/sdd/online-karaoke/task-1-report.md. Include RED command and failure output, GREEN test output, build output, exact versions, changed files, commit SHA, and concerns. Reply only with status, commit, one-line test/build summary, concerns, report path.
