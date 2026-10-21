# Encore Console: Frontend Redesign Spec

Date: 2026-10-22
Status: Approved by the user, ready for the implementation plan
Supersedes: the visual language in `ENCORE_DESIGN_SPEC.md` (root repository)

---

## 1. Purpose

Encore is a login-free karaoke app with a host screen that runs on a television and guest
remotes that run on phones. The current interface is a warm obsidian and gold jazz club
theme built on a Playfair Display serif headline, DM Mono labels and 488 lines of bespoke
CSS, with hand-drawn CSS artwork standing in for imagery.

This redesign replaces that visual language with a cooler, more technical direction that
reads as a premium console rather than a lounge. Every action carries an icon next to a
word, so the interface is scannable at a glance on a phone and legible on a wall sized
screen.

The redesign changes presentation only. Routes, edge function calls, data shapes and
permissions stay exactly as they are.

---

## 2. Scope

### In scope
- A new token layer for color, type, shape, spacing, motion and elevation.
- A new icon layer built on Phosphor Icons, replacing every text-only control.
- New component primitives shared by all four screens.
- Restructured markup for the home, join, guest room and host room screens.
- New self-hosted photography, replacing the hand-drawn CSS artwork.
- A rewritten stylesheet: Tailwind v4 tokens and utilities plus one small component layer.

### Out of scope
- Any change to edge functions, database schema, realtime behaviour or token handling.
- New features. No new screens, no settings, no history, no accounts.
- A light theme. The product is used at night, so one dark theme ships.
- An animation library. Motion stays in CSS transitions and keyframes.

---

## 3. Design direction

### 3.1 Rationale

The current design is warm, lettered and theatrical, which suits a poster but not a
utility screen that a guest opens under bad lighting while holding a drink. The new
direction treats Encore as an audio console: a cool graphite instrument panel, one
electric cobalt signal color for the things that matter right now, and a uniform row of
icon and label controls that a guest can learn in one screen.

### 3.2 What the current design gets right and keeps
- Dark theme for night use.
- Self-hosted fonts, no third-party font request.
- One shared queue as the visible center of gravity.
- The room code rendered in monospace so it can be read aloud.

### 3.3 What is removed
- Playfair Display, and the serif headline treatment.
- The warm gold and amber palette.
- The hand-drawn microphone, sound line, sun, floor and stamp artwork.
- The 488 line bespoke stylesheet and its bespoke class vocabulary.
- Text-only buttons such as `Play`, `Pause`, `Skip`, `Remove` and `Lock guest controls`.

---

## 4. Design tokens

Tokens live in a Tailwind v4 `@theme` block at the top of `src/styles.css`. The
`--color-*` and `--font-*` namespaces generate the matching utilities.

### 4.1 Color

| Token | Value | Role |
|---|---|---|
| `--color-graphite` | `#0A0B0E` | page background |
| `--color-graphite-soft` | `#0E1014` | alternate band background |
| `--color-surface` | `#14171D` | cards and panels |
| `--color-surface-2` | `#1B1F27` | inputs and raised rows |
| `--color-surface-3` | `#232833` | hover state |
| `--color-line` | `rgba(255,255,255,0.08)` | hairline borders |
| `--color-line-strong` | `rgba(255,255,255,0.14)` | focused and active borders |
| `--color-ink` | `#F5F7FA` | primary text, 17 to 1 on graphite |
| `--color-ink-2` | `#A6AFBD` | secondary text, 7 to 1 on surface |
| `--color-ink-3` | `#737C8B` | tertiary text and disabled labels |
| `--color-signal` | `#4E82FF` | icons, focus rings, links, 5.3 to 1 on graphite |
| `--color-signal-fill` | `#1F52D6` | primary button fill, white text 6.4 to 1 |
| `--color-signal-soft` | `rgba(78,130,255,0.14)` | selected and active row wash |
| `--color-live` | `#35D6A4` | semantic only: online presence, now playing |
| `--color-danger` | `#FF5C5C` | semantic only: remove, end room |

Rules:
- One accent color, cobalt. It appears on every screen in the same way.
- Green and red are semantic only. Green means a person is present or a song is playing.
  Red means an action destroys something.
- No gradients on text. The only gradient is the cobalt wash over photography and the
  stage glow behind the home hero.

### 4.2 Typography

| Role | Family | Weights | Source |
|---|---|---|---|
| Display | Space Grotesk | 500, 600, 700 | new, self-hosted woff2 |
| UI and body | Manrope | 400, 500, 600, 700 | already self-hosted |
| Data and labels | DM Mono | 400, 500 | already self-hosted |

Scale:

| Token | Size | Line height | Tracking | Use |
|---|---|---|---|---|
| display | `clamp(2.75rem, 7vw, 5.5rem)` | 1.02 | -0.03em | home headline only |
| title | `clamp(1.75rem, 3.4vw, 2.25rem)` | 1.15 | -0.02em | screen titles |
| heading | 1.0625rem | 1.4 | -0.01em | panel titles |
| body | 0.9375rem | 1.6 | 0 | paragraphs, list rows |
| small | 0.8125rem | 1.5 | 0 | secondary row metadata |
| label | 0.6875rem | 1.4 | 0.14em | uppercase mono section labels |
| data | 0.9375rem | 1.2 | 0 | room code, duration, vote count, mono |

The label size is the smallest text on any screen and is never used for content that a
guest must read at a distance.

### 4.3 Shape

One radius rule, applied everywhere:

| Element | Radius |
|---|---|
| Panels, cards, buttons, inputs | 14px |
| Badges and chips | 8px |
| Media, thumbnails, QR frame | 10px |
| Round icon buttons | 9999px |

### 4.4 Spacing

An 8 pixel base unit. Section padding moves from 20 to 24 pixels on panels, and screen
gutters become 24 pixels on desktop and 16 pixels on phones.

### 4.5 Motion

| Token | Value |
|---|---|
| `--ease-console` | `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| duration fast | 140ms |
| duration base | 200ms |
| duration slow | 320ms |

| Moment | Treatment |
|---|---|
| Screen entrance | fade plus 12 pixel rise, 40ms stagger per block |
| Button hover | 1 pixel rise plus a cobalt glow at 24 percent |
| Button press | scale 0.98 |
| Field focus | border and ring both reach `--color-signal` |
| Queue row arrival | 10 pixel rise, 200ms |
| Presence dot | opacity pulse, 2 seconds, infinite |
| Theater mode | player width and height animate, 320ms |

Every animation runs on `opacity` and `transform` only. A `prefers-reduced-motion: reduce`
block collapses all durations to 0.01ms and stops the presence pulse.

### 4.6 Elevation

| Level | Treatment |
|---|---|
| Page | `--color-graphite` with a cobalt radial wash at the top right |
| Panel | `--color-surface`, 1 pixel `--color-line` |
| Raised row | `--color-surface-2`, 1 pixel `--color-line` |
| Hover row | `--color-surface-3` |
| Player stage | 1 pixel `--color-line`, 0 30px 90px black at 55 percent |

---

## 5. Icon system

### 5.1 Rules
- Library: `@phosphor-icons/react`, installed as a runtime dependency.
- One family across the app. No mixing with another icon set.
- Default weight is `duotone`. `fill` marks an active or selected control. `bold` is
  reserved for a single add action.
- Every icon inherits `currentColor` so it follows the text color of its row.
- Every icon-only control carries an `aria-label` and a hover tooltip.
- Icon names are verified against the installed package during implementation, because the
  package renames icons between major versions.

### 5.2 Map

| Meaning | Icon | Weight | Visible word |
|---|---|---|---|
| Start a room | Broadcast | duotone | Start a room |
| Join a room | Key | duotone | Join a room |
| Play | Play | fill | none, tooltip |
| Pause | Pause | fill | none, tooltip |
| Skip | SkipForward | fill | none, tooltip |
| Vote | ThumbsUp | duotone, fill when voted | vote count only |
| Remove a song | TrashSimple | regular | Remove, on the host screen only |
| Clear the queue | Trash | duotone | Clear queue |
| Search songs | MagnifyingGlass | regular | search placeholder |
| Paste a YouTube link | Link | regular | Paste a link |
| Add to queue | Plus | bold | none, tooltip |
| Invite | QrCode | duotone | Invite |
| Copy the join link | Copy | regular | Copy link |
| Lock guest controls | LockSimple | duotone | Lock |
| Unlock guest controls | LockSimpleOpen | duotone | Unlock |
| People in the room | UsersThree | duotone | In the room |
| Theater mode | CornersOut | regular | Theater |
| End the room | Power | duotone | End room |
| Controls are locked | LockKey | duotone | banner |
| Song step marker | MusicNote | duotone | Sing |
| Wordmark mark | MicrophoneStage | fill | encore |

---

## 6. Component primitives

New folder `src/ui`. Each primitive is a small, single purpose file with a barrel export
at `src/ui/index.ts`.

| Primitive | Purpose | Notes |
|---|---|---|
| `Button` | labelled action | variants `primary`, `secondary`, `ghost`, `danger`; sizes `md`, `lg`; optional leading icon; loading state keeps the label and swaps the icon for a spinner |
| `IconButton` | icon only action | minimum 44 pixel target, round shape, `aria-label` required, optional tooltip, optional active state |
| `Field` | label, input, helper and error | error text sits below the input, input turns `--color-danger` |
| `Panel` | titled section | optional leading icon in the title |
| `Chip` | small status label | mono type, 8 pixel radius |
| `Tooltip` | hover and focus label | pure CSS, appears on hover and on keyboard focus |
| `QueueRow` | one queued song | thumbnail, title, added by, vote control, optional remove control |
| `TransportButton` | one transport action | round, 56 pixel on the host screen, 52 pixel on the guest remote |
| `RosterRow` | one participant | presence dot, display name, host tag |

---

## 7. Screens

### 7.1 Home at `/`

Asymmetric two column split on desktop, stacked on phones.

Top bar: the wordmark on the left, built from the MicrophoneStage icon in a rounded
square plus the word `encore`. On the right, a single quiet link that scrolls to the
how it works section.

Hero, left column:
- Display headline in Space Grotesk, two lines maximum: `One room. Every voice.`
- A sub line of at most 16 words.
- Two action cards side by side on desktop, stacked on phones.
  - Start a room card: Broadcast icon, the word `Start a room`, one host name input, and a
    primary button with the Broadcast icon and the words `Start a room`.
  - Join a room card: Key icon, the word `Join a room`, a room code input and a guest
    name input, and a secondary button with the Key icon and the words `Join a room`.

Hero, right column:
- The hero photograph, `public/images/hero-microphone.jpg`, in a 4 to 5 frame with the
  cobalt wash and a deep graphite gradient over it.
- Below the photograph, a single row of three step markers: Broadcast, QrCode and
  MusicNote, each with a short label.

How it works section: three icon and word blocks that explain start, invite and sing,
followed by the second photograph, `public/images/singer-stage.jpg`, in a wide band.

The error message renders in place, above the two cards. The footer carries one line and
three quiet facts with small icons.

### 7.2 Join at `/join/:roomCode`

A single centered card, maximum width 480 pixels.
- The wordmark, small, at the top.
- A title that names the room.
- The room code shown in mono type with the space separators intact.
- One name input and one primary button with the Key icon and the words `Join a room`.
- A quiet link back to the start screen.

### 7.3 Guest room at `/room/:roomId`

Phone first, because a guest uses this on a phone.

- Sticky header: the room code in a chip, the guest display name, and a lock banner when
  the host has locked controls.
- Now playing card: thumbnail, title, channel, and the live dot in `--color-live`.
- Search field with the MagnifyingGlass icon inside the field, then the paste a link
  field with the Link icon.
- Queue list of QueueRow items. The vote control shows the ThumbsUp icon and the count.
  The remove control appears only on the guest's own songs.
- Fixed transport dock at the bottom of the phone screen: three round TransportButtons,
  play or pause, skip, and a lock indicator. The dock sits above the safe area.
- The participant roster collapses into a single row of avatars and a count.

### 7.4 Host room at `/room/:roomId/host`

Television first.

- Top bar: wordmark, room code chip, a lock toggle button with the Lock icon and the
  word, and a theater toggle with the CornersOut icon.
- Main column: the 16 by 9 player, then a transport bar with three large round buttons
  and the current track title and channel.
- Right rail, stacked panels:
  - Up next: the queue, with vote counts and a remove control on every row.
  - Invite: the QR code in a 10 pixel radius frame, the room code in mono, and a copy
    link button with the Copy icon and the words `Copy link`.
  - In the room: the roster.
  - Host controls: lock, clear queue and end room, each an icon with a word, with end
    room in the danger treatment.
- Theater mode keeps the current behavior of expanding the player to the full width.

### 7.5 States

| State | Treatment |
|---|---|
| Loading | A skeleton block that matches the panel shape, not a spinner alone |
| Empty queue | An icon, one sentence that says what to do next, and no action button |
| Error | Inline, in place, in `--color-danger`, next to the control that failed |
| Locked | The lock banner with the LockKey icon, plus every control disabled with a reason |
| Room ended | A centered message and one action back to the start screen |

---

## 8. Imagery

| File | Source | Use |
|---|---|---|
| `public/images/hero-microphone.jpg` | Unsplash, vintage chrome microphone against warm bokeh | home hero, cobalt duotone |
| `public/images/singer-stage.jpg` | Unsplash, singer under teal stage smoke | how it works band, cobalt duotone |

Both are stored in the repository. No runtime third-party image request.

Duotone treatment: the photograph sits under a cobalt gradient wash at 35 percent with a
graphite gradient at the bottom, so both photographs read as one system.

---

## 9. Accessibility

- Every interactive control is reachable by keyboard with a visible focus ring, 2 pixels of
  `--color-signal` at 2 pixels offset.
- Every icon-only control carries an accessible name.
- Body text contrast meets WCAG AA. Primary button labels meet 4.5 to 1.
- Touch targets are at least 44 by 44 pixels. Transport buttons are 52 to 56 pixels.
- The lock state uses an icon and a word, never color alone.
- The guest screen keeps a 44 pixel clear band at the bottom for the home indicator.
- Animation respects `prefers-reduced-motion`.

---

## 10. Performance

- `@phosphor-icons/react` is tree shaken. The room screens are already lazy routes, and
  the icons follow them.
- Space Grotesk ships as two self-hosted woff2 files, latin and latin ext, preloaded like
  the existing families.
- The Playfair font files and the CSS artwork are deleted, so the payload drops.
- The hero photograph is the largest paint, so it is preloaded and given fixed dimensions
  to avoid layout shift.
- Target budgets: Largest Contentful Paint under 2.5 seconds, Interaction to Next Paint
  under 200 milliseconds, Cumulative Layout Shift under 0.1.

---

## 11. File plan

### Added
- `public/fonts/space-grotesk-latin.woff2` and the latin ext file.
- `public/images/hero-microphone.jpg` and `public/images/singer-stage.jpg`.
- `src/ui/Button.tsx`, `IconButton.tsx`, `Field.tsx`, `Panel.tsx`, `Chip.tsx`,
  `Tooltip.tsx`, `QueueRow.tsx`, `TransportButton.tsx`, `RosterRow.tsx`, `index.ts`.

### Rewritten
- `src/styles.css`: token layer, base reset, one component layer, keyframes.
- `src/app/HomePage.tsx`, `JoinRoomPage.tsx`, `GuestRoomPage.tsx`, `HostRoomPage.tsx`.
- `src/features/queue/QueueList.tsx`, `src/features/rooms/ParticipantRoster.tsx`,
  `src/features/playback/PlaybackControls.tsx`, `src/features/queue/SongSearch.tsx`,
  `src/features/queue/PasteSongForm.tsx`.
- `tests/unit/styles.test.ts`, `tests/unit/premiumDesign.test.ts`,
  `tests/unit/appShell.test.ts`: the design contract tests follow the new tokens.
- `index.html`: browser theme color and the font preloads.
- `supabase/config.toml`: local port remap so the stack starts on this machine.

### Deleted
- `public/fonts/playfair-*.woff2` and `public/fonts/playfairdisplay-OFL.txt`.
- The artwork component code in `HomePage.tsx`.

### Unchanged
- Every file under `src/lib`, `src/features/rooms/roomApi.ts`, `src/features/queue/queueApi.ts`,
  `src/features/queue/voteApi.ts`, `src/features/playback/playbackApi.ts`,
  `src/features/playback/youtubeIframe.ts`, `src/features/playback/YouTubePlayer.tsx`.
- Every file under `supabase`.

---

## 12. Verification

1. `npx tsc --noEmit` passes with no new errors.
2. `npm test` passes. The design contract tests in `tests/unit/styles.test.ts` and
   `tests/unit/premiumDesign.test.ts` are rewritten to assert the new tokens, the new
   display face, the new accent and the new motion rules. `tests/unit/appShell.test.ts`
   keeps its checks and updates the browser theme color.
3. `npm run build` succeeds and the entry chunk shrinks against the current build.
4. The local Supabase stack runs on port 55421, because the default port range is reserved
   on this machine. The port change lives in `supabase/config.toml` and `.env`.
5. Playwright drives the running dev server through home, join, guest and host, and
   captures screenshots at 1440 by 900 and 390 by 844.
6. Every screenshot is checked for contrast, clipping, icon and label balance, and
   horizontal overflow.
7. A keyboard pass confirms that every control receives focus in order and that every
   icon-only control announces a name.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| The queue and search components carry the most behavior, so a redesign can break them | The API layer is untouched, and the existing tests cover the reducers and the queue commands |
| Phosphor renames icons between major versions | Every name is checked against the installed package type definitions before use |
| Space Grotesk has no italics, so emphasis needs a different treatment | Emphasis uses weight and color, never a synthetic oblique |
| The cobalt wash over warm photography can look muddy | Both photographs are checked against the wash before the layout is signed off |

---

## 14. Confirmed decisions

- **Direction:** graphite with an electric cobalt signal. Approved by the user.
- **Icon system:** Phosphor Icons, duotone, icon and word on every action, icon only for
  transport. Approved by the user.
- **Depth:** tokens, primitives and screen layout all rebuilt. Approved by the user.
- **Theme:** one dark theme. The product runs at night.
- **Motion:** CSS only, no animation dependency.
- **Assets:** two self-hosted photographs replace the CSS artwork.
