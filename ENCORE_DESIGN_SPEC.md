# Encore — Modern Premium Design System

**Project:** Encore — "A shared stage for songs worth singing together."
**Figma file:** https://www.figma.com/design/486rg6uTECUG3piT0puGHc
**Session:** Premium System — UI Design
**Status:** Design spec complete. Figma file created with 1 hero AI image placed. Full UI build blocked by Figma MCP code-size limit in this session.

---

## About Encore

Encore is a karaoke web app with four screens:

| Screen | Path | Purpose |
|--------|------|---------|
| Home | `/` | Create or join a room |
| Join Room | `/join/:roomCode` | Enter a 16-char room code + name |
| Guest Room | `/room/:roomId` | Singer view: add songs, vote, remote controls |
| Host Room | `/room/:roomId/host` | Host view: YouTube player, queue, guest controls, QR invite |

Current codebase: React + Vite + Tailwind + Supabase, in `.worktrees/online-karaoke/`.

---

## Existing Design Foundation (from `src/styles.css`)

Encore already has a coherent warm dark aesthetic. The premium redesign elevates it, not replaces it.

**Colors:**
| Token | Hex | Role |
|-------|-----|------|
| `--ink` | `#f3efe4` | Primary text (warm off-white) |
| `--paper` | `#0c0f0d` | Page background |
| `--stage` | `#0a0a08` | Deepest dark, hero background |
| `--surface` | `#12120f` | Card/surface background |
| `--surface-raise` | `#1a1a14` | Raised surface on hover |
| `--muted` | `#9a9688` | Secondary text |
| `--amber` | `#f08a4b` | Primary accent (warm orange-amber) |
| `--amber-deep` | `#b35627` | Pressed/active accent |
| `--forest` | `#3ecf8e` | Online presence indicator |
| `--gold` | `#c9a227` | Brand accent |
| `--gold-pale` | `#eaddca` | Subtle gold text |
| `--gold-glow` | `rgba(201,162,39,0.40)` | Drop shadows/glow |
| `--panel` | `#141a16` | Panel background |
| `--hairline-gold` | `rgba(201,162,39,0.35)` | Subtle gold borders |

**Typography:**
- **Manrope** — UI text, labels, buttons (400–800)
- **DM Mono** — accents, monospace details, captions (400, 500)
- **Playfair Display** — headlines, display text (italic 600, 700)

**Existing motion:** Buttons translateY(-2px) on hover, 0.18s cubic-bezier transitions.

---

## Premium Design Direction

**Tone:** Warm dark luxury — obsidian base with amber spotlight accents, like a high-end lounge or jazz club. Not cold corporate dark mode; it's intimate, tactile, theatrical.

**One thing people remember:** The amber spotlight glow that follows interaction — buttons glow on hover, surfaces lift with gold rim light, the microphone icon pulses gently on the home page.

---

## Screen-by-Screen Premium Design

### 1. Home Page (`/`)

**Layout:** Split hero — copy left, art right (desktop); stacked (mobile).

**Eyebrow:** "YOUR LIVING ROOM, FRONT ROW" — DM Mono, 10px, letter-spaced, amber, with a small glowing dot.

**Headline:** "Every song deserves an encore." — Playfair Display, clamp(56–104px), white, italic "encore." in amber.

**Subhead:** "Pick a song. Pass the mic. Make a night of it. Your people are already halfway there." — Manrope, 14–17px, gold-pale, 1.9 line height.

**Two entry cards side by side:**
- **Create room** (primary): Host name input + gold-filled "Create room" button with arrow
- **Join room** (secondary): Room code input + Guest name input + outline "Join room" button

**Motion:**
- Page load: eyebrow fades in (400ms), headline slides up 20px (600ms), subhead fades (500ms), cards stagger in (700ms/800ms)
- Button hover: translateY(-2px), gold glow appears, scale 1.02
- Button pressed: scale 0.98, 150ms

**Hero art:** Dark obsidian with amber spotlight, microphone silhouette, sound wave lines, "LIVE" stamp in corner.

---

### 2. Join Room (`/join/:roomCode`)

**Layout:** Centered card, max-width 720px.

**Headline:** "Join the room" — Playfair Display, clamp(30–44px).

**Lead:** "Room code ABCD EFGH JKMN PQRS. Add your name to take the remote." — Manrope, muted.

**Form:** Two inputs (room code, your name) + primary "Join room" button.

**Motion:** Card fades in and slides up slightly on load. Inputs focus with gold ring.

---

### 3. Guest Room (`/room/:roomId`)

**Layout:** Two-column workspace — main (add song + queue), aside (roster + remote).

**Header:** "REMOTE" eyebrow + guest name + room code.

**Add a song panel:** Song search + paste YouTube URL form.

**Queue list:** Each entry shows thumbnail, title, votes, remove button (owner only). Vote buttons show count.

**Your remote panel:** Playback controls (play/pause, next, mode toggle).

**Participant roster:** Avatars with online presence dots (forest green when online).

**Motion:** Queue entries lift on hover (translateY -1px). Vote buttons glow amber when active. New songs slide into the queue.

---

### 4. Host Room (`/room/:roomId/host`)

**Layout:** YouTube player theater (top), queue + controls (below), aside with QR invite + roster + host controls.

**Header:** "HOST SCREEN" eyebrow + room code + lock/unlock banner.

**Theater mode:** Full-screen player option with 16:9 stage.

**Host controls:** Lock guest controls, unlock, clear queue, end room (primary, amber).

**QR code:** Large, scannable, with room code below it.

**Motion:** Theater mode expands smoothly. Controls fade in/out on hover. End room confirmation with amber accent.

---

## Component Library

### Button / Premium
| State | Fill | Text | Shadow | Scale |
|-------|------|------|--------|-------|
| Default | `--gold` (#c9a227) | `#100a06` | none | 1.0 |
| Hover | `#d9b94c` | `#100a06` | `0 0 34px var(--gold-glow)` | 1.02 |
| Pressed | `--amber-deep` (#b35627) | `#ffffff` | none | 0.98 |
| Disabled | `--surface` | `--muted` | none | 1.0 |

**Size:** min-height 56px, padding 0 24px, border-radius 14px, Manrope Semibold 13px.

### Input / Premium
- Background: `#0c0c0a`, border: 1px `--hairline-soft`, radius 12px
- Focus: 2px gold outline, border-color `--gold`
- Error: border-color `#ff7a5c`, background `rgba(255,106,77,0.10)`

### Card / Premium (Surface)
- Background: `--surface` (#12120f), border: 1px `--hairline-gold`, radius 16px
- Hover: border-color `--gold`, shadow `0 24px 48px rgba(201,162,39,0.12)`
- Shadow: `0 20px 40px rgba(0,0,0,0.45)`

### Panel / Premium
- Background: `--panel` (#141a16), border: 1px `--hairline`, radius 18px
- Inner shadow: `inset 0 1px 0 rgba(255,255,255,0.04)`

---

## Animation Spec

| Moment | Type | Duration | Easing |
|--------|------|----------|--------|
| Page load reveal | fade + slide-up | 400–800ms staggered | ease-out |
| Button hover | scale + translateY + glow | 180ms | cubic-bezier(.2,.7,.3,1) |
| Button press | scale down | 150ms | ease-in |
| Input focus | ring expand | 200ms | ease-out |
| Queue item add | slide-in | 300ms | ease-out |
| Hover card lift | translateY | 160ms | ease |
| Theater mode expand | width/height | 400ms | ease-out |
| Presence dot pulse | opacity | 2000ms infinite | ease-in-out |

**Reduced motion:** All transitions drop to 0.01ms per `prefers-reduced-motion`.

---

## Figma File Contents

| Item | Status |
|------|--------|
| File "Modern Premium System - UI Design" | Created |
| Session `b4b206cd-bcc3-4c6a-a4fa-c55a5cbee218` | Active |
| Hero AI image (node 13:2, 1264x848) | Placed — Encore karaoke stage lighting |
| Color styles | Partial (1 created before limit) |
| Text styles | Not created |
| Frames/components | Not built |

**Blocker:** `use_figma` (Figma Plugin API) cannot accept JavaScript with nested objects/braces in this session — JSON parsing fails on scripts beyond ~80 characters. The Figma MCP is currently rate-limited from repeated failed calls.

---

## Next Steps

1. **In Figma (manual or fresh session):** Build the Encore design system — color styles, text styles, button variants, card variants, and four screen frames using the spec above.
2. **Codebase (awaiting your approval):** Implement the design in React + Tailwind + Framer Motion. No edits made yet.
3. **Export:** Download the placed AI images from Figma for use as hero backgrounds.

**No codebase files have been modified.** Awaiting your instruction to proceed with implementation.
