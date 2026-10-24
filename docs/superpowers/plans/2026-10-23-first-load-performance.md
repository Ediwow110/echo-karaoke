# First Load Performance Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement this plan inline, task-by-task. Do not delegate or commit without the user's request.

**Goal:** Finish fixing slow initial loads and refreshes in the running karaoke app.

**Architecture:** Keep the per-icon imports and single-flight room polling already implemented. Read Better Auth's public keys through its server API instead of invoking the same server over HTTP; retain the cache, rotation refresh, and cryptographic checks.

**Tech Stack:** React 19, TypeScript, Better Auth 1.7, Vite 8, Vitest 5, Playwright MCP.

## Global Constraints

- Preserve existing user changes in `api/router.ts`, `server/auth/auth.ts`, `server/env.ts`, and deployment configuration.
- No dependency additions, authentication bypasses, remote deployments, or commits.
- Verify using the running app at `http://localhost:3000`.
- Do not read or print browser credentials.

---

### Task 1: Remove the nested JWKS invocation

**Files:** Modify `server/auth/jwks.ts`, `server/auth/identity.ts`; extend `tests/unit/jwks.test.ts` and `tests/unit/serverIdentity.test.ts`.

**Interfaces:** `fetchJwks` and `verifyBearerToken` accept a URL or a stable async public-key loader. URL callers remain supported. `requireAnonymousCaller(request)` uses the configured Better Auth instance's `getJwks` API.

- [x] Write a regression that supplies an async key loader with HTTP fetch disabled, verifies a correctly signed Ed25519 token, and rejects a tampered signature.
- [x] Run `npm test -- tests/unit/jwks.test.ts tests/unit/serverIdentity.test.ts`; confirm the loader regression fails before the fix.
- [x] Use a stable loader in `identity.ts`:

  ```ts
  const localJwks = async () => {
    const { auth } = await import('./auth.js');
    return auth.api.getJwks();
  };
  ```

  In `jwks.ts`, key the existing cache by the source (URL or loader), load a URL with the existing five-second fetch timeout, and otherwise await the loader. Keep validation of the returned key array and forced refresh behavior.
- [x] Run the focused tests and `npm run build`. Check expiry, anonymous identity, algorithm, signature, key rotation, cache reuse, and loader errors.

### Task 2: Guard room polling regressions

**Files:** Extend `tests/unit/useRoomData.test.tsx`; change `src/features/rooms/useRoomData.ts` only when a regression demonstrates incorrect behavior.

**Interfaces:** Preserve `RoomState.refresh(): Promise<void>` and existing room/role-scoped state.

- [x] Add a delayed initial read under `StrictMode`; multiple four-second timer ticks must not create additional reads, and the first response must clear loading.
- [x] Add a route-switch test with room A still pending; resolving A must not overwrite B or launch another A read using B's queued flag.
- [x] If the stale operation consumes another room's queue, enforce operation ownership in the loop:

  ```ts
  } while (queued.current && active.current && operationSeq.current === seq);
  ```

- [x] Run `npm test -- tests/unit/useRoomData.test.tsx`, then `npm test` and `npm run build`.

### Task 3: Live proof and review

**Files:** Store visual evidence under `shots/`; update this plan with measured results.

- [x] Reload the host room via Playwright MCP; wait for the room heading, collect resource timings, and confirm no overlapping room reads or stuck skeleton.
- [x] Inspect fresh console/network errors, and capture the host/stage UI. Compare room read times with the earlier 7–10 second baseline and separate remaining runtime startup overhead from app work.
- [x] Review `git diff --check` and the task-related diff; ensure user edits remain untouched. Stop when regression tests pass and live verification supports the fix.

## Evidence

- Before continuation: icon barrel migration reduced the worst measured dev long task from 856 ms to 82 ms; 239 tests and build passed.
- Before JWKS fix: `/api/auth/jwks` took 3781 ms; live room reads took 7146–9673 ms. A two-minute live polling sample had 14 completed reads, none overlapping.
- JWKS regression initially failed with `HTTP key lookup must not run`; all 16 focused auth tests then passed and the build passed.
- Route-switch regression initially showed an unexpected third read for room A. The operation sequence guard fixed it; all seven room hook tests pass.
- First live sample after removing the JWKS HTTP hop: room reads 2810–3912 ms, all HTTP 200, no overlapping reads, zero console errors.
- Final gates: `npm test` passed 48 files / 248 tests; `npm run build` passed with 207 modules and 82.29 KB gzip entry; `npm audit --omit=dev` found zero vulnerabilities; `git diff --check` passed (line-ending warnings only).
- Final instrumented host reload: DOMContentLoaded 500 ms, room heading visible at 7979 ms, no recorded long tasks before that heading. Token request 3246 ms and room read 3575 ms, both HTTP 200.
- Final 22-read live sample: median 3444 ms, range 2954–4900 ms, zero failed reads and zero overlap. Host and empty-stage views captured in `shots/perf-host-room-after.png` and `shots/perf-host-stage-after.png`; zero console errors, one browser WebGPU warning.
- Remaining local runtime overhead: even `/api/auth/ok` returning `{ "ok": true }` took 3248 ms. This work removes the redundant invocation but does not eliminate Vercel dev's per-invocation delay. No production API timing claim or deployment was made.
- Final cache-disabled home load: DOMContentLoaded 812 ms, load event 814 ms, no long tasks recorded at the heading check, largest Phosphor resource 13,568 bytes instead of the original 17.6 MB barrel. Home icons and settled form visually verified.
- Independent focused review found no task-introduced Critical/Important issues; confirmed icon changes are import-only and use matching per-icon paths. Existing user changes remain in place. Work is kept uncommitted as approved; no merge, push, or deployment.
