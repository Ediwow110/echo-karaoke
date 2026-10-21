# Device Aware Home and Live Suggestions: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home screen lead with the right action for the screen size, and give guests a live list of songs they can queue without typing.

**Architecture:** The screen size decides the order of the home screen through responsive utilities, so the markup order never changes for a screen reader. A new edge function serves the YouTube music chart, and a new component renders it as a strip of song cards above the search field.

**Tech Stack:** React 19, Vite 8, Tailwind v4, Supabase Edge Functions, Deno, Vitest, Playwright.

## Global Constraints

- Write in English, present tense, active voice. No emojis, no em dashes, no Latin abbreviations.
- The role in a room comes from the token, never from the device.
- The YouTube data key never reaches the browser.
- The search field and the paste a link field stay on every screen.

---

### Task 1: The popular songs function

**Files:**
- Create: `supabase/functions/youtube-popular/index.ts`
- Modify: `src/lib/edgeApi.ts`
- Modify: `tests/integration/edgeRoomAuth.test.ts`

**Interfaces:**
- Consumes: the room pass check and the shared search mapper.
- Produces: the edge function name `youtube-popular` and the answer `{ available: boolean, results: SearchResult[], message?: string }`.

- [ ] **Step 1: Write the failing integration test**

```ts
it('reports popular songs as unavailable without a YouTube key', async () => {
  const session = await anonymousSession();
  const created = await callFunction('create-room', { session, body: { displayName: 'Popular Host' } });
  const roomId = created.body.roomId as string;
  const guestToken = created.body.guestToken as string;

  const noToken = await callFunction('youtube-popular', { session, body: { roomId } });
  expect(noToken.status).toBe(401);

  const withoutKey = await callFunction('youtube-popular', {
    session,
    roomHeader: 'x-room-guest-token',
    roomToken: guestToken,
    body: { roomId },
  });
  expect(withoutKey.status).toBe(200);
  expect(withoutKey.body.available).toBe(false);
  expect(withoutKey.body.results).toEqual([]);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:integration`
Expected: FAIL, because the function does not exist.

- [ ] **Step 3: Write the function**

Copy the access check from `youtube-search`. Without a key, answer that it is not
configured. With a key, call the chart endpoint for the music category with twelve results
and map them with `mapSearchResponse`. Cache the answer in the function for five minutes.

- [ ] **Step 4: Add the function name to the client**

Add `youtube-popular` to `EdgeFunctionName` in `src/lib/edgeApi.ts`.

- [ ] **Step 5: Run the test and watch it pass**

Run: `npm run test:integration`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/youtube-popular src/lib/edgeApi.ts tests/integration/edgeRoomAuth.test.ts
git commit -m "feat: serve the YouTube music chart for song suggestions"
```

---

### Task 2: The suggestion strip

**Files:**
- Create: `src/features/queue/PopularSongs.tsx`
- Create: `tests/unit/popularSongs.test.tsx`

**Interfaces:**
- Consumes: `api.invoke('youtube-popular', { roomId }, { guestToken })` and `addSong`.
- Produces: `PopularSongs(props: { roomId: string; onAdded?: () => void })`.

- [ ] **Step 1: Write the failing test**

Render the strip with a fake answer and assert that every song shows a queue button with
the name of the song, and that an answer that is not configured renders nothing.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/popularSongs.test.tsx`
Expected: FAIL, because the component does not exist.

- [ ] **Step 3: Write the component**

Load the list once when the panel appears. Render a horizontal strip of cards, each with
the thumbnail, the title, the channel and a plus button that queues the song. Hide
everything when the answer is not configured or when the call fails.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/popularSongs.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/queue/PopularSongs.tsx tests/unit/popularSongs.test.tsx
git commit -m "feat: add a strip of live song suggestions"
```

---

### Task 3: The screen aware home page

**Files:**
- Modify: `src/app/HomePage.tsx`
- Modify: `tests/unit/homePage.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: the join card first on a phone, the start card first on a wide screen, and the
  stage line on a wide screen.

- [ ] **Step 1: Write the failing test**

Assert that the join card carries the phone first order, the start card carries the wide
first order, and that the stage line is on the page.

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/homePage.test.tsx`
Expected: FAIL, because the order classes and the stage line do not exist.

- [ ] **Step 3: Change the home page**

Give the start card `order-2 sm:order-1` and the join card `order-1 sm:order-2`. Put the
scan action at the top of the join card. Add the line that tells a wide screen it plays
the music, hidden on a phone.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/homePage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/HomePage.tsx tests/unit/homePage.test.tsx
git commit -m "feat: lead the home screen with the action that fits the screen"
```

---

### Task 4: Put the strip in the room screens

**Files:**
- Modify: `src/app/GuestRoomPage.tsx`
- Modify: `src/app/HostRoomPage.tsx`

**Interfaces:**
- Consumes: `PopularSongs`.
- Produces: the strip above the search field in both add a song panels.

- [ ] **Step 1: Render the strip**

Put `<PopularSongs roomId={roomId} onAdded={...} />` above `SongSearch` in both panels.

- [ ] **Step 2: Run the whole suite, the typecheck and the build**

Run: `npm test`, then `npx tsc --noEmit`, then `npm run build`.
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/app/GuestRoomPage.tsx src/app/HostRoomPage.tsx
git commit -m "feat: show the song suggestions in both room screens"
```

---

### Task 5: The verification pass

- [ ] **Step 1: Check the home screen at both sizes**

At 390 pixels the join card comes first with the scan action on top. At 1440 pixels the
start card comes first and the stage line shows.

- [ ] **Step 2: Check the room screens**

The strip stays hidden while no key is configured and the search panel explains why. The
room still works with the paste a link path.

- [ ] **Step 3: Check the function with a key**

Set `YOUTUBE_API_KEY` in `supabase/functions/.env`, restart the stack, and confirm that
the strip shows twelve songs and that one tap queues a song.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: correct the suggestion strip after the visual pass"
```

---

## Notes

- The YouTube data key is required for the suggestions. Without it the function answers
  that it is not configured and the strip stays hidden.
- The chart endpoint returns the same item shape as the search endpoint, so the shared
  mapper reads both.
