# Device Aware Home and Live Suggestions: Design Spec

Date: 2026-10-22
Status: Approved in conversation, ready for the implementation plan
Follows: `2026-10-22-encore-console-redesign.md`

---

## 1. Purpose

Two changes to how a guest gets into a room and how a guest finds a song.

1. The home screen changes with the size of the screen. A phone leads with the camera
   because a phone is a remote. A tablet or a wide screen leads with starting a room
   because a wide screen is the stage.
2. A guest can add a song without typing, from a list of live YouTube suggestions.

## 2. Device classification

A screen is a **phone** when its shorter edge is under 640 pixels. Every other screen is
**wide**. The shorter edge decides, so a phone in landscape stays a phone and a tablet in
any position stays wide.

The classification lives in the stylesheet through the responsive utilities, not in
JavaScript state. Nothing waits on a resize listener and nothing reflows after the first
paint.

## 3. What the classification decides

Only the home screen. The role in a room still comes from the token, never from the
device.

| Screen | First action | Extra |
|---|---|---|
| Phone | Join a room, with the scan action on top of the card | The start a room card sits below it |
| Wide | Start a room | The card says that this screen plays the music for the room |

The two action cards swap places with the order utilities, so the scan action is the first
thing a phone sees and the start action is the first thing a wide screen sees. There is one
scan action in the markup, not two.

A wide screen that opens the app in a room is not the host. The host is the device that
holds the host token. A guest on a laptop keeps guest powers, so the lock, clear and end
controls stay out of reach.

## 4. Live suggestions

### 4.1 The source

The suggestions come from the YouTube Data API. The most popular music videos are read
from the chart endpoint, which needs no query, so the guest taps instead of types.

### 4.2 The key

The Data API rejects every request without a key. The key lives in the edge function
environment as `YOUTUBE_API_KEY` and never reaches the browser.

Without the key the function answers that it is not configured, the strip stays hidden and
the rest of the app keeps working. A guest can still add a song by pasting a link.

To turn the suggestions on:

```bash
# supabase/functions/.env
YOUTUBE_API_KEY=your_key_here
```

Then restart the local stack, or redeploy the functions.

### 4.3 The edge function

A new function at `supabase/functions/youtube-popular`.

- It asks for the same room pass as the other room functions, so a guest needs a room
  before the list is served.
- Without a key it answers `{ available: false, results: [], message: ... }`, the same
  shape the search function uses.
- With a key it calls the chart endpoint for the music category, twelve results, and maps
  them with the shared search mapper.
- The answer is cached in the function for five minutes, because the chart does not move
  fast and the quota is small.

### 4.4 The client

A new component at `src/features/queue/PopularSongs.tsx` renders a horizontal strip of song
cards. Each card shows the thumbnail, the title and the channel, with a plus button that
queues the song. A card that is already queued shows the state.

The strip loads when the panel appears, once. A failure is silent, because the search box
below it is always there.

### 4.5 Where it sits

In the add a song panel of the guest remote and in the add a song panel of the host
console, above the search field. The search field and the paste a link field stay below
it, so a guest who wants something specific is never blocked.

## 5. What was rejected

- **A device that picks the role.** A guest on a laptop would reach the lock, clear and end
  controls, and two laptops would fight over the host role.
- **A curated list of staples instead of live suggestions.** It works without a key, but the
  choice was made for live YouTube data. The list of staples is a separate decision and
  the server can serve it later from the same strip.
- **A scan step inside the room.** The scan is the way in, so it stays before the guest
  enters. A second scan adds a step and a camera prompt at the worst moment.

## 6. Accessibility

- The order swap is presentation only. The markup order stays the same for a screen reader.
- The scan action is a link, so it opens the scanner route.
- Each suggestion card is a button with the name of the song, so the queue action announces
  what it queues.
- The strip scrolls sideways with a touch and stays reachable with a keyboard.

## 7. Files

### Added
- `supabase/functions/youtube-popular/index.ts`
- `src/features/queue/PopularSongs.tsx`
- `tests/unit/popularSongs.test.tsx`

### Modified
- `src/lib/edgeApi.ts`: the new function name.
- `src/app/HomePage.tsx`: the card order and the stage line.
- `src/app/GuestRoomPage.tsx`, `src/app/HostRoomPage.tsx`: the strip in the add a song panel.
- `tests/integration/edgeRoomAuth.test.ts`: the authorization and the missing key.
- `tests/unit/homePage.test.tsx`: the new order and the stage line.

## 8. Verification

1. `npm test` passes with the new unit tests.
2. `npm run test:integration` passes with the new authorization test.
3. `npx tsc --noEmit` and `npm run build` pass.
4. The home screen at 390 pixels shows the join card first with the scan action on top. The
   home screen at 1440 pixels shows the start card first with the stage line.
5. The suggestions strip stays hidden while no key is configured, and the note in the
   search panel explains why.
6. With a key configured, the strip shows twelve songs and one tap queues a song.

### Results

- 162 unit tests pass and 13 integration tests pass. The typecheck is clean and the build
  succeeds.
- The home screen at 390 pixels leads with the join card and the scan action. At 1440
  pixels it leads with the start card and the line about playing the music.
- The strip was proven by answering the function call in the browser with a live shaped
  payload. The strip renders on the host console and on the phone remote, and one tap
  queues the song. The server answered with the real title for the video, which is the
  right owner for the metadata.
- The function itself was proven without a key: it answers that it is not configured and
  serves nothing. The path with a key needs a real key to run.
- The integration tests need the local stack, so they read the port from the environment:
  `LOCAL_SUPABASE_URL` and `LOCAL_SUPABASE_ANON_KEY`. The port is 55421 on this machine
  because the default range is reserved.
