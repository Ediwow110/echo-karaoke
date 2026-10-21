# Player Chrome and Phone Scan: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the host transport controls inside the video frame, and let a phone join a room by scanning the code the host shows.

**Architecture:** The player gains an `overlay` slot that renders inside the 16 by 9 stage. A new `PlayerChrome` component draws the bar over the bottom of the frame and fades it away while a song plays. A new lazy route at `/scan` opens the phone camera, decodes the code with jsQR and sends the guest to the join page.

**Tech Stack:** React 19, Vite 8, Tailwind v4, Phosphor Icons 2.1, jsQR 1.4, Supabase.

## Global Constraints

- Write in English, present tense, active voice. No emojis, no em dashes, no Latin abbreviations.
- The guest remote on a phone keeps its own transport dock. The change touches the host screen.
- The typed room code stays as the fallback for every guest.
- The scanner bundle stays out of the entry chunk.

---

### Task 1: The bar over the video frame

**Files:**
- Create: `src/features/playback/PlayerChrome.tsx`
- Create: `tests/unit/playerChrome.test.tsx`
- Modify: `src/features/playback/YouTubePlayer.tsx`
- Modify: `src/features/playback/PlaybackControls.tsx`
- Modify: `src/app/HostRoomPage.tsx`

**Interfaces:**
- Consumes: the `TransportButton` primitive, the playback state.
- Produces: `PlayerChrome(props: PlayerChromeProps)` with `playing: boolean`, `title: string | null`, `channel: string | null`, `children: ReactNode`. The player gains the prop `overlay?: ReactNode`. `PlaybackControls` gains the prop `layout?: 'stack' | 'inline'`.

- [x] **Step 1: Write the failing test**

```tsx
it('hides the controls while a song plays and the host is still', () => {
  vi.useFakeTimers();
  const { container } = render(createElement(PlayerChrome, { playing: true, title: null, channel: null, children: 'controls' }));
  act(() => { vi.advanceTimersByTime(5000); });
  expect(container.querySelector('[data-controls]')?.className).toContain('opacity-0');
});
```

Also cover the paused case, the title and the pointer wake.

- [x] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/playerChrome.test.tsx`
Expected: FAIL, because the component does not exist.

- [x] **Step 3: Write the component**

`PlayerChrome` holds the idle state. While `playing` is true it fades the bar out after 2600ms. A `pointermove` or a `keydown` anywhere in the document brings it back. Focus inside the bar always reveals it, so a keyboard user never loses the controls.

- [x] **Step 4: Move the controls into the stage**

`YouTubePlayer` renders the view buttons in the top right corner of the stage and the `overlay` slot at the bottom. The host page passes the `PlayerChrome` with the `PlaybackControls` in the `inline` layout, and the separate Playback panel is removed.

- [x] **Step 5: Run the tests**

Run: `npm test`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/features/playback src/app/HostRoomPage.tsx tests/unit/playerChrome.test.tsx
git commit -m "feat: move the host transport controls inside the video frame"
```

---

### Task 2: The phone scanner

**Files:**
- Create: `src/features/scan/roomCodeFromScan.ts`
- Create: `src/features/scan/ScanRoomPage.tsx`
- Create: `tests/unit/roomCodeFromScan.test.ts`
- Create: `tests/unit/scanRoomPage.test.tsx`
- Create: `tests/unit/scanDecoding.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/HomePage.tsx`

**Interfaces:**
- Consumes: `normalizeRoomCode` and `isValidRoomCode` from the room code module, the `qrcode` package for the test.
- Produces: `roomCodeFromScan(text: string): string | null` and the route `/scan`.

- [x] **Step 1: Write the failing tests**

`roomCodeFromScan` reads the code out of a join link, out of a bare code, and rejects a link that points somewhere else.

`scanDecoding` rasterizes the exact code the host screen draws and decodes it with jsQR, which proves the scanner reads the code the host shows.

- [x] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/unit/roomCodeFromScan.test.ts tests/unit/scanDecoding.test.ts`
Expected: FAIL, because the module does not exist.

- [x] **Step 3: Write the helper**

`roomCodeFromScan` takes the last path segment of the scanned text, normalizes it and accepts it when it holds sixteen valid symbols. It also tries the whole text, so a code that was scanned on its own works.

- [x] **Step 4: Write the scanner screen**

The screen asks for the rear camera, draws each frame onto a canvas, and decodes it every 120ms. A blocked or missing camera shows a panel that offers the typed code. The camera is released when the screen goes away.

- [x] **Step 5: Wire the route and the entry point**

`App` loads the screen on demand at `/scan`. The join card on the home screen gains a `Scan a code` action that opens it.

- [x] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/features/scan src/app/App.tsx src/app/HomePage.tsx tests/unit
git commit -m "feat: let a phone join a room by scanning the host code"
```

---

### Task 3: The verification pass

- [x] **Step 1: Run the whole suite, the typecheck and the build**

Run: `npm test`, then `npx tsc --noEmit`, then `npm run build`.
Expected: all green.

- [x] **Step 2: Check the frames in a browser**

The host frame shows the view buttons in the top right corner and the bar over the bottom of the picture. The bar hides after 2.6 seconds of stillness while a song plays, and any pointer movement brings it back.

- [x] **Step 3: Check the phone flow**

Open the join page with a code, add a name, and add a song from the remote. The song lands in the shared queue.

- [x] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: correct the console layout after the visual pass"
```

---

## Notes

- The picture sits in an iframe, which keeps every pointer event to itself. The bar wakes on
  a pointer movement that the page can see, which includes the strip under the picture, and
  on any key press.
- The scanner bundle is 139 kB, 50 kB gzip, and it loads only on the scan route.
