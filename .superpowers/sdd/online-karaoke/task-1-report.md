# Task 1 report: Bootstrap the web application

## Status and scope

Task 1 files are implemented on branch `feature/online-karaoke`. The app is a React and TypeScript Vite landing screen with clearly labeled **Create room** and **Join room** controls. Room flows remain out of scope. This report is intentionally not part of the Task 1 commit.

## Verification evidence

**RED command:** `npm test -- --reporter=verbose`, run after the render test was written and before `src/app/App.tsx` existed.

**RED result:** exit 1. Vitest reported that it could not find module `../../src/app/App` imported from `tests/unit/app.test.ts`; one test file failed, with no tests executed. This was the expected failure because the application module had not yet been implemented. An earlier parser-error run occurred before changing the test to use `createElement`; it is not the cited RED evidence.

**GREEN command:** `npm test -- --reporter=verbose`; exit 0. Vitest reported `✓ tests/unit/app.test.ts > karaoke home screen > offers clearly labeled room entry points`, one file passed, one test passed.

Fresh final verification after implementation:

- `npm test`: exit 0. Vitest reported `✓ tests/unit/app.test.ts (1 test)`, `Test Files 1 passed (1)`, and `Tests 1 passed (1)`.
- `npm run build`: exit 0. The script ran `tsc --noEmit && vite build`; Vite 8.3.4 transformed 16 modules and built successfully.
- `git diff --cached --check`: exit 0 with no whitespace errors.
- `npm list --depth=0`: exit 0; installed top-level versions are listed below.

No browser-rendered test was done. The test is a jsdom React Testing Library render test, not a real-browser visual check.

## Dependencies

Manifest ranges and exact installed versions (from fresh `npm list --depth=0`):

| Package | Manifest range | Installed |
|---|---:|---:|
| `@supabase/supabase-js` | `^2.118.0` | 2.118.0 |
| `@tailwindcss/vite` | `^4.3.3` | 4.3.3 |
| `@testing-library/jest-dom` | `^6.9.1` | 6.9.1 |
| `@testing-library/react` | `^16.3.3` | 16.3.3 |
| `@types/react` | `^19.2.14` | 19.3.0 |
| `@types/react-dom` | `^19.2.3` | 19.3.0 |
| `@vitejs/plugin-react` | `^6.1.2` | 6.1.2 |
| `jsdom` | `^30.1.3` | 30.1.3 |
| `react` | `^19.3.1` | 19.3.1 |
| `react-dom` | `^19.3.1` | 19.3.1 |
| `tailwindcss` | `^4.3.3` | 4.3.3 |
| `typescript` | `^7.0.2` | 7.0.2 |
| `vite` | `^8.3.4` | 8.3.4 |
| `vitest` | `^5.0.5` | 5.0.5 |

The exact dependency resolutions are recorded in `package-lock.json`.

## Changed Task 1 files

- `.gitignore`: includes `node_modules/`, `dist/`, local env ignores (with `!.env.example` exception), Playwright output paths (`playwright-report/`, `test-results/`, `blob-report/`), and preserves ignores for `.worktrees/` and `.superpowers/`.
- `.env.example`: only the blank `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` placeholders; no credentials.
- `package.json` and `package-lock.json`: required dev/test/build scripts and dependency selections/resolutions.
- `index.html`: document metadata and application mount point.
- `tsconfig.json`: strict TypeScript settings.
- `vite.config.ts` and `vitest.config.ts`: Vite React/Tailwind plugins and jsdom test setup.
- `src/main.tsx`, `src/app/App.tsx`, `src/styles.css`, and `src/vite-env.d.ts`: React entry point, karaoke landing screen, responsive styling, and Vite types.
- `tests/unit/app.test.ts`: checks that Create room and Join room buttons render.

No implementation features were added beyond the Task 1 brief. No browser-rendered test was run. The two controls are presentation-only; room creation/join behavior is not implemented in this bootstrap task.

## Commit

Subject: `chore: bootstrap karaoke web app`

SHA: 97bf96d (author: Karaoke Project <karaoke@localhost>, supplied as a repository-local identity for this commit only).

## Fix: improve landing layout and text contrast

### Review items addressed

- At tablet widths through 790px, the hero now uses a single-column layout. Above 790px the desktop two-column grid remains in effect; at 850px and below the two columns would provide less than the 349px combined button minimum plus their gap.
- The shared muted token is now #62645c (5.28:1 against paper #f4f0e7) and is used by .topbar-note, .quiet-note, and .bottomline p. The footer list also uses this same semantic muted token.
- Body text #66675f measures 5.03:1 against paper, and primary ink #252a25 measures 12.85:1.

### Focused verification and commands

- Added tests/unit/styles.test.ts for the two-column/stacking breakpoints, shared muted-token usage, and calculated WCAG contrast for actual CSS text colors. No dependency was added.
- npm test -- --reporter=verbose -- tests/unit/styles.test.ts: exit 0, 2 test files / 3 tests passed (focused stylesheet tests plus existing app test).
- npm test: exit 0, 2 test files / 3 tests passed.
- npm run build: exit 0; TypeScript check and Vite production build succeeded.
- git diff --check: exit 0.
- Computed contrast: muted 5.28:1, body text 5.03:1, ink 12.85:1 against paper.
- No browser-rendered proof was performed.

### Commit

Subject: fix: improve landing layout and text contrast

SHA: 557d7447c0bc34db003adaa836888c9e861473fd
