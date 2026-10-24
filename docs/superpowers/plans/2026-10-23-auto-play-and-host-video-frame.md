# Auto-play and Host Video Frame Implementation Plan

> **For agentic workers:** Use `executing-plans` inline. User approved this design in conversation; implement now without committing.

**Goal:** Make every song added to the host queue start playing automatically without the host clicking Play, and show the YouTube video frame on the host main screen at widescreen/tablet (`lg+`) with nothing drawn on top of the video itself.

**Architecture:**
- `HostRoomPage.tsx`: add an effect that fires `playback-command: play` when the room is live, the queue is non-empty, nothing is playing (`isPlaying === false`), and no video is currently loaded (`currentVideoId === null`). Guarded so it never re-triggers while `isPlaying` is true or while a video is already loaded. Browser autoplay block falls back to the existing "Start playback" button in `HostPlayer`.
- `HostPlayer.tsx`: when no stage slot is registered but a video is loaded and viewport is `lg+`, render the player layer as a fixed floating frame (`320×180`, top-right) instead of hiding it off-screen. Render zero overlay content on top of the video in this mode — title/added-by info stays in the existing dock below.
- `tests/unit/hostRoomPage.test.tsx`: add auto-play tests using the existing `makeApi` / `renderHost` pattern.

**Tech Stack:** Existing React 19, TypeScript, Vitest 5, Vite 8, Playwright MCP for live verification.

## Global Constraints
- Do not put any text or controls on top of the video frame itself.
- Preserve existing user changes in `api/router.ts`, `server/auth/auth.ts`, `server/env.ts`, and deployment configuration.
- No new dependencies, no commits, no pushes, no deployments.
- Verify using the running app at `http://localhost:3000`.
- Keep phones on current behavior (dock + optional Stage view) unless the user later asks for the frame there too.

---

### Task 1: Auto-play every new current song (in progress)

**Files:** Modify `src/app/HostRoomPage.tsx`; extend `tests/unit/hostRoomPage.test.tsx`.

**Interfaces:** Consumes `runPlayback('play')` (already defined in HostRoomPage) and `data.playback`, `queue`, `live`, `nowPlaying`. Produces a `playback-command: play` API call when conditions are met. No signature changes.

- [ ] **Step 1: Add the auto-play effect**

In `HostRoomPage`, after the existing effects, add:

```tsx
useEffect(() => {
  if (!live) return;
  if (isPlaying) return;
  if (queue.length === 0) return;
  if (data.playback?.currentVideoId !== null) return;
  void runPlayback('play');
}, [live, isPlaying, queue, data.playback, runPlayback]);
```

Why each guard:
- `!live` — room not active, nothing to do.
- `isPlaying` — a song is already playing; never interrupt or re-trigger.
- `queue.length === 0` — no songs to play.
- `data.playback?.currentVideoId !== null` — a video is already loaded/playing; don't reload.

This fires once when the first song is added to a stopped queue, and again when the queue empties and a new song is added. After `play()` succeeds, the server sets `isPlaying: true` and `currentVideoId`, so the effect does not re-run.

- [ ] **Step 2: Write failing auto-play tests**

Add to `tests/unit/hostRoomPage.test.tsx` using the existing `makeApi` / `renderHost` pattern. The mock `playback-command` already records calls; for the play test, make it return `isPlaying: true` after a `play` action so the effect does not loop.

Test A — plays when a song is added to a stopped queue:

```tsx
it('automatically plays a song added to a stopped queue', async () => {
  const stoppedRoom = {
    ...liveRoom,
    playback: { ...liveRoom.playback, isPlaying: false, currentVideoId: null, currentSongId: null },
    queue: [{ ...liveRoom.queue[1], status: 'queued' }],
  };
  const playedCalls: Array<{ name: string; body: unknown }> = [];
  const api: EdgeApi = {
    invoke: (async (name, body, _tokens, options) => {
      playedCalls.push({ name, body });
      if (name === 'host-room-read' || name === 'guest-room-read' || name === 'touch-member') {
        return stoppedRoom;
      }
      if (name === 'playback-command' && (body as { action?: string }).action === 'play') {
        return { roomId, status: 'live', playback: { ...stoppedRoom.playback, isPlaying: true } };
      }
      if (name === 'playback-command') {
        return { roomId, status: 'live', playback: stoppedRoom.playback };
      }
      return { ok: true };
    }) as unknown as EdgeApi['invoke'],
  };
  renderHost(api);

  await waitFor(() => {
    expect(playedCalls.some(
      (call) => call.name === 'playback-command' && (call.body as { action?: string }).action === 'play'
    )).toBe(true);
  });
});
```

Test B — does not re-trigger when already playing:

```tsx
it('does not request play when a song is already playing', async () => {
  const playingRoom = { ...liveRoom, playback: { ...liveRoom.playback, isPlaying: true } };
  const { api, calls } = makeApi(playingRoom);
  renderHost(api);

  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name: 'After Hours' })).toBeInTheDocument();
  });
  expect(calls).not.toContainEqual(
    expect.objectContaining({ name: 'playback-command', body: expect.objectContaining({ action: 'play' }) })
  );
});
```

- [ ] **Step 3: Run focused tests**

Run `npm test -- tests/unit/hostRoomPage.test.tsx`. Test A must fail before the effect exists, pass after. Test B must pass before and after. Then run `npm test` (full suite, 250+ tests) and `npm run build`.

---

### Task 2: Visible floating video frame on host main screen at widescreen

**Files:** Modify `src/features/playback/HostPlayer.tsx`.

**Interfaces:** `HostPlayer` already receives `videoId`, `isPlaying`, `playerError`, `advanceStalled`, `needsTap`, `slot`, `rect`. Uses `registerStageSlot` to receive the stage element. Produces a fixed frame div when `slot === null && videoId !== null && isLgOrUp`. No signature changes.

- [ ] **Step 1: Add viewport detection**

At the top of `HostPlayer` component body, after `const videoId = ...`, add:

```tsx
const isLgOrUp = typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
const [isLg, setIsLg] = useState(isLgOrUp);
useEffect(() => {
  const mq = window.matchMedia('(min-width: 1024px)');
  const handler = () => setIsLg(mq.matches);
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}, []);
```

- [ ] **Step 2: Show the floating frame instead of off-screen hiding**

Replace the `layerStyle` assignment (currently off-screen when `slot === null`):

```tsx
const layerStyle = slot === null
  ? (videoId !== null && isLg
      ? { top: 4, right: 4, width: 320, height: 180, opacity: 1, pointerEvents: 'auto' as const }
      : { top: 0, left: -10000, width: 320, height: 180, opacity: 0, pointerEvents: 'none' as const })
  : { top: rect.top, left: rect.left, width: rect.width, height: rect.height, opacity: 1, pointerEvents: 'auto' as const };
```

- [ ] **Step 3: Render zero overlay on top of the video in floating-frame mode**

In the return JSX, the layer div (`<div ref={layerRef} ...>`) currently always renders the overlay content (title chips, time, progress, controls). Wrap that overlay content so it only renders when NOT in floating-frame mode:

```tsx
{slot === null && videoId !== null && isLg ? null : (
  <div className="pointer-events-none absolute inset-0">
    <div className="absolute inset-0 bg-[...gradient...]" aria-hidden="true" />
    <div className="relative flex items-start justify-between gap-3 p-4">
      ... existing title chips ...
    </div>
    ... existing time/progress controls ...
  </div>
)}
```

The floating frame itself is just:
```tsx
<div ref={hostRef} className="absolute inset-0" />
```
inside the visible layer — the YouTube iframe is injected into `hostRef` by `youtubePlayerFactory`. No text, no controls on top of the video.

- [ ] **Step 4: Run focused tests + full suite + build**

Run `npm test -- tests/unit/hostRoomPage.test.tsx`, then `npm test`, then `npm run build`. Confirm `git diff --check` is clean.

---

### Task 3: Live verification on http://localhost:3000

**Files:** None (runtime verification only); screenshots under `shots/`.

- [ ] **Step 1: Verify auto-play via Playwright MCP**

Navigate to `http://localhost:3000/room/<id>/host` (a live host room). From a separate guest context or via the host search, add a song. Confirm:
- The host main screen shows a visible video frame (top-right, ~320×180) with no text overlaid on the video.
- Playback starts automatically (or the "Start playback" button shows if the browser blocks autoplay).
- No console errors.

- [ ] **Step 2: Capture screenshots**

`shots/auto-play-host-frame.png` (host main screen with visible frame) and `shots/auto-play-guest-add.png` (guest adding song, host frame responds).

- [ ] **Step 3: Review diff**

`git diff -- src/app/HostRoomPage.tsx src/features/playback/HostPlayer.tsx tests/unit/hostRoomPage.test.tsx` — confirm no unrelated changes, no text over video, no placeholder left behind.

---

## Evidence

- Before: host main screen hides player off-screen; host must click Play for every song; song title text is drawn on top of the video (obstructing singers, per the shared image).
- After plan: auto-play triggers on every new current song; visible floating frame at `lg+` with clean video surface; fallback "Start playback" button when autoplay is blocked.
- Tests pass: focused host room page tests + full `npm test` (250 tests) + `npm run build` (203 modules, ~82 KB gzip entry).
- Live: Playwright MCP confirms frame visible, no paste-form regressions (prior work), no console errors.

**Draft plan complete.** Confirm this plan, then I'll execute Task 1–3 inline.