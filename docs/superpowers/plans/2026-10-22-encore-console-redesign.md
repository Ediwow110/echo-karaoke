# Encore Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the Encore frontend with a graphite and cobalt console design where every action carries an icon beside its word.

**Architecture:** A Tailwind v4 token layer in `src/styles.css` holds the whole design system. A new `src/ui` folder holds the shared primitives that own their Tailwind class strings. The four screens are rebuilt on those primitives. The data layer, edge functions and routes do not change.

**Tech Stack:** React 19, Vite 8, Tailwind v4, Phosphor Icons 2.1, TypeScript 7, Vitest, Playwright.

**Status:** All seven tasks are complete and committed on `feature/online-karaoke`. The
suite holds 145 passing unit tests, the typecheck is clean and the production build
succeeds. The verification pass fixed four things: the QR frame overflowed the invite
card, the pause button carried a false active state, the application shell fallback used
retired class names, and the queue row was too cramped on a phone.

## Global Constraints

- Write in English, present tense, active voice. No emojis in code, comments or commits.
- No em dashes and no en dashes. Use a colon, a comma, parentheses or two sentences.
- No Latin abbreviations. Write "for example", "that is", "and so forth".
- Do not change routes, edge function calls, data shapes, token handling or permissions.
- Do not add an animation library. Motion stays in CSS transitions and keyframes.
- One accent color only: cobalt. Green is semantic for presence, red is semantic for destructive actions.
- Every icon-only control carries an accessible name and a tooltip.
- Every touch target is at least 44 by 44 pixels.
- Contrast meets WCAG AA for body text and 4.5 to 1 for button labels.
- Commit after every task with a conventional commit message.

## File Structure

| File | Responsibility |
|---|---|
| `src/styles.css` | Font faces, the Tailwind theme tokens, the base layer, keyframes, the tooltip and skeleton helpers, the reduced motion block |
| `src/ui/Button.tsx` | Labelled button with an optional leading icon and a busy state |
| `src/ui/IconButton.tsx` | Round icon only button with an accessible name and a tooltip |
| `src/ui/Field.tsx` | Label, input, optional leading icon, helper text and error text |
| `src/ui/Panel.tsx` | Titled surface with an optional leading icon |
| `src/ui/Chip.tsx` | Small monospace status label |
| `src/ui/QueueRow.tsx` | One queued song row with vote and remove controls |
| `src/ui/TransportButton.tsx` | One transport action in the round and the bar shapes |
| `src/ui/RosterRow.tsx` | One participant with a presence dot |
| `src/ui/LockBanner.tsx` | Banner that explains the locked state |
| `src/ui/index.ts` | Barrel export for the primitives |
| `src/app/HomePage.tsx` | Landing screen with the two action cards and the hero photograph |
| `src/app/JoinRoomPage.tsx` | Join screen with the room code and the name field |
| `src/app/GuestRoomPage.tsx` | Phone first guest remote with the fixed transport dock |
| `src/app/HostRoomPage.tsx` | Host console with the player, the queue, the invite card and the host controls |
| `src/features/queue/QueueList.tsx` | Maps queue entries onto `QueueRow` |
| `src/features/rooms/ParticipantRoster.tsx` | Maps roster entries onto `RosterRow` |
| `src/features/playback/PlaybackControls.tsx` | Play, pause and skip in the dock and the bar shapes |
| `src/features/queue/SongSearch.tsx` | Search field and results, restyled |
| `src/features/queue/PasteSongForm.tsx` | Paste a link field, restyled |
| `src/features/playback/YouTubePlayer.tsx` | Player stage, restyled, mode buttons become icon buttons |

---

### Task 1: The token layer and the stylesheet

**Files:**
- Modify: `src/styles.css` (full rewrite)
- Modify: `index.html` (theme color and font preloads)
- Modify: `tests/unit/styles.test.ts` (rewrite)
- Modify: `tests/unit/premiumDesign.test.ts` (rename to `tests/unit/consoleDesign.test.ts` and rewrite)
- Delete: `public/fonts/playfair-latin.woff2`, `public/fonts/playfair-latin-ext.woff2`, `public/fonts/playfair-italic-latin.woff2`, `public/fonts/playfair-italic-latin-ext.woff2`, `public/fonts/playfairdisplay-OFL.txt`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--color-*`, `--font-*`, `--radius-*`, `--duration-*`, `--ease-console`, the keyframes `console-in`, `queue-in`, `presence-pulse`, `skeleton-pulse`, the helper classes `.tooltip`, `.skeleton`, and the utilities that Tailwind generates from the theme.

- [x] **Step 1: Write the failing design contract tests**

Replace `tests/unit/styles.test.ts` with:

```ts
declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const css = require('node:fs').readFileSync(process.cwd() + '/src/styles.css', 'utf8');

function color(name: string): string {
  const value = css.match(new RegExp('--color-' + name + ':\\s*(#[0-9a-fA-F]{6})'))?.[1];
  if (!value) throw new Error('Missing --color-' + name + ' token');
  return value;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('console design tokens', () => {
  it('defines the graphite palette', () => {
    for (const name of ['graphite', 'surface', 'surface-2', 'ink', 'ink-2', 'signal', 'signal-fill', 'live', 'danger']) {
      expect(color(name)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('keeps body text above the AA threshold', () => {
    expect(contrast(color('ink'), color('graphite'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('ink-2'), color('surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color('ink-3'), color('surface'))).toBeGreaterThanOrEqual(3);
  });

  it('keeps the primary button label readable', () => {
    expect(contrast('#ffffff', color('signal-fill'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the accent readable on graphite', () => {
    expect(contrast(color('signal'), color('graphite'))).toBeGreaterThanOrEqual(4.5);
  });

  it('uses the Space Grotesk display face and drops the serif', () => {
    expect(css).toContain('Space Grotesk');
    expect(css).not.toContain('Playfair');
  });

  it('self-hosts every font', () => {
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).not.toContain('fonts.gstatic.com');
    expect(css).toContain('/fonts/');
  });

  it('never hides text while a font loads', () => {
    const faces = css.split('@font-face').slice(1);
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toContain('font-display: swap');
    }
  });

  it('defines one radius scale', () => {
    expect(css).toMatch(/--radius-panel:\s*14px/);
    expect(css).toMatch(/--radius-badge:\s*8px/);
    expect(css).toMatch(/--radius-media:\s*10px/);
  });

  it('declares motion as tokens', () => {
    expect(css).toMatch(/--duration-fast:\s*140ms/);
    expect(css).toMatch(/--duration-base:\s*200ms/);
    expect(css).toMatch(/--duration-slow:\s*320ms/);
    expect(css).toMatch(/--ease-console:\s*cubic-bezier\(/);
  });

  it('halts every animation for visitors who ask for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation-duration: .01ms');
    expect(reduced).toContain('animation-iteration-count: 1');
  });

  it('renders native controls in the dark palette', () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });
});
```

Run `git mv tests/unit/premiumDesign.test.ts tests/unit/consoleDesign.test.ts`, then replace its contents with:

```ts
declare const require: (specifier: string) => { readFileSync(path: string, encoding: 'utf8'): string };
declare const process: { cwd(): string };
import { describe, expect, it } from 'vitest';

const css = require('node:fs').readFileSync(process.cwd() + '/src/styles.css', 'utf8');

function keyframeBlocks(): string[] {
  const blocks: string[] = [];
  const pattern = /@keyframes\s+([\w-]+)\s*\{/g;
  let match = pattern.exec(css);
  while (match !== null) {
    let depth = 1;
    let index = match.index + match[0].length;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push(css.slice(match.index + match[0].length, index - 1));
    match = pattern.exec(css);
  }
  return blocks;
}

describe('console design system', () => {
  it('animates only compositor friendly properties', () => {
    const allowed = new Set(['opacity', 'transform']);
    for (const block of keyframeBlocks()) {
      const properties = [...block.matchAll(/([a-z-]+)\s*:/g)].map((entry) => entry[1]);
      for (const property of properties) {
        expect([...allowed]).toContain(property);
      }
    }
  });

  it('reveals a screen in a staggered sequence', () => {
    expect(css).toContain('@keyframes console-in');
    expect(css).toMatch(/--animate-console-in/);
  });

  it('slides a new queue row into place', () => {
    expect(css).toContain('@keyframes queue-in');
  });

  it('marks live presence with a slow pulse', () => {
    expect(css).toContain('@keyframes presence-pulse');
  });

  it('gives the tooltip a hover and a focus state', () => {
    expect(css).toContain('.tooltip:hover::after');
    expect(css).toContain('.tooltip:focus-within::after');
  });

  it('draws a skeleton that matches the panel shape', () => {
    expect(css).toContain('.skeleton');
    expect(css).toContain('@keyframes skeleton-pulse');
  });

  it('keeps a visible focus ring on every control', () => {
    expect(css).toMatch(/focus-visible[^{]*\{[^}]*outline:\s*2px solid var\(--color-signal\)/);
  });
});
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/unit/styles.test.ts tests/unit/consoleDesign.test.ts`
Expected: FAIL, because the current stylesheet still declares `--gold`, Playfair and the old class vocabulary.

- [x] **Step 3: Rewrite the stylesheet**

Replace `src/styles.css` with:

```css
@import 'tailwindcss';

/* ---------------------------------------------------------------------------
   Self-hosted typefaces
   Each family ships as a subset woff2 so the browser only downloads the
   ranges a page actually renders. Nothing here reaches a third-party host.
   --------------------------------------------------------------------------- */

@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 300 700;
  font-display: swap;
  src: url('/fonts/space-grotesk-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Space Grotesk';
  font-style: normal;
  font-weight: 300 700;
  font-display: swap;
  src: url('/fonts/space-grotesk-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url('/fonts/manrope-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'Manrope';
  font-style: normal;
  font-weight: 200 800;
  font-display: swap;
  src: url('/fonts/manrope-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'DM Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/dm-mono-400-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'DM Mono';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url('/fonts/dm-mono-400-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'DM Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/dm-mono-500-latin.woff2') format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

@font-face {
  font-family: 'DM Mono';
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url('/fonts/dm-mono-500-latin-ext.woff2') format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}

/* ---------------------------------------------------------------------------
   Design tokens
   The color and font namespaces generate the matching Tailwind utilities.
   --------------------------------------------------------------------------- */

@theme {
  --color-graphite: #0A0B0E;
  --color-graphite-soft: #0E1014;
  --color-surface: #14171D;
  --color-surface-2: #1B1F27;
  --color-surface-3: #232833;
  --color-line: rgba(255, 255, 255, 0.08);
  --color-line-strong: rgba(255, 255, 255, 0.14);
  --color-ink: #F5F7FA;
  --color-ink-2: #A6AFBD;
  --color-ink-3: #737C8B;
  --color-signal: #4E82FF;
  --color-signal-fill: #1F52D6;
  --color-signal-fill-hover: #2A63E8;
  --color-signal-fill-press: #1A47BC;
  --color-signal-soft: rgba(78, 130, 255, 0.14);
  --color-live: #35D6A4;
  --color-danger: #FF5C5C;

  --font-display: "Space Grotesk", "Manrope", sans-serif;
  --font-sans: "Manrope", system-ui, sans-serif;
  --font-mono: "DM Mono", ui-monospace, monospace;

  --radius-panel: 14px;
  --radius-badge: 8px;
  --radius-media: 10px;

  --ease-console: cubic-bezier(0.2, 0.8, 0.2, 1);
  --duration-fast: 140ms;
  --duration-base: 200ms;
  --duration-slow: 320ms;

  --animate-console-in: console-in var(--duration-slow) var(--ease-console) backwards;
  --animate-queue-in: queue-in var(--duration-base) var(--ease-console) backwards;
  --animate-presence-pulse: presence-pulse 2s ease-in-out infinite;
}

/* ---------------------------------------------------------------------------
   Motion
   Every keyframe animates opacity or transform only, so the browser runs the
   whole system on the compositor without touching layout.
   --------------------------------------------------------------------------- */

@keyframes console-in {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes queue-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes presence-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.85; }
}

/* ---------------------------------------------------------------------------
   Base
   --------------------------------------------------------------------------- */

@layer base {
  html {
    color-scheme: dark;
  }

  body {
    margin: 0;
    min-width: 320px;
    min-height: 100dvh;
    background-color: var(--color-graphite);
    color: var(--color-ink);
    font-family: var(--font-sans);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :focus-visible {
    outline: 2px solid var(--color-signal);
    outline-offset: 2px;
  }

  ::selection {
    background: var(--color-signal);
    color: #ffffff;
  }
}

/* ---------------------------------------------------------------------------
   Helpers
   --------------------------------------------------------------------------- */

@layer components {
  .tooltip {
    position: relative;
  }

  .tooltip::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    z-index: 60;
    transform: translateX(-50%);
    padding: 4px 9px;
    border: 1px solid var(--color-line);
    border-radius: 6px;
    background: var(--color-surface-2);
    color: var(--color-ink);
    font-family: var(--font-mono);
    font-size: 0.6875rem;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-console);
  }

  .tooltip:hover::after,
  .tooltip:focus-within::after {
    opacity: 1;
  }

  .skeleton {
    background-color: var(--color-surface-2);
    animation: skeleton-pulse 1.6s ease-in-out infinite;
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [x] **Step 4: Update the document shell**

In `index.html`, replace the theme color and the preload block with:

```html
    <meta name="theme-color" content="#0A0B0E" />
    <meta name="description" content="A shared stage for songs worth singing together." />
    <title>Encore | sing together</title>
    <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/space-grotesk-latin.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/dm-mono-500-latin.woff2" as="font" type="font/woff2" crossorigin />
```

- [x] **Step 5: Delete the retired typeface**

Run:

```bash
git rm public/fonts/playfair-latin.woff2 public/fonts/playfair-latin-ext.woff2 public/fonts/playfair-italic-latin.woff2 public/fonts/playfair-italic-latin-ext.woff2 public/fonts/playfairdisplay-OFL.txt
```

- [x] **Step 6: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/styles.test.ts tests/unit/consoleDesign.test.ts`
Expected: PASS, 22 tests.

- [x] **Step 7: Confirm the theme compiles**

Run: `npm run build`
Expected: the build succeeds. If a `duration-(--duration-fast)` shorthand fails to compile, replace it with the literal `duration-[140ms]` in the component that uses it.

- [x] **Step 8: Commit**

```bash
git add src/styles.css index.html tests/unit/styles.test.ts tests/unit/consoleDesign.test.ts tests/unit/premiumDesign.test.ts public/fonts
git commit -m "feat: replace the stylesheet with the console token layer"
```

---

### Task 2: The icon layer and the shared primitives

**Files:**
- Create: `src/ui/Button.tsx`
- Create: `src/ui/IconButton.tsx`
- Create: `src/ui/Field.tsx`
- Create: `src/ui/Panel.tsx`
- Create: `src/ui/Chip.tsx`
- Create: `src/ui/QueueRow.tsx`
- Create: `src/ui/TransportButton.tsx`
- Create: `src/ui/RosterRow.tsx`
- Create: `src/ui/LockBanner.tsx`
- Create: `src/ui/index.ts`
- Create: `tests/unit/uiPrimitives.test.tsx`

**Interfaces:**
- Consumes: the theme tokens from Task 1, the `@phosphor-icons/react` package.
- Produces:
  - `Button(props: ButtonProps)` where `ButtonProps` extends `ButtonHTMLAttributes<HTMLButtonElement>` with `variant?: 'primary' | 'secondary' | 'ghost' | 'danger'`, `size?: 'sm' | 'md' | 'lg'`, `icon?: ReactNode`, `busy?: boolean`.
  - `IconButton(props: IconButtonProps)` where `IconButtonProps` extends `ButtonHTMLAttributes<HTMLButtonElement>` with `icon: ReactNode`, `label: string`, `active?: boolean`, `tone?: 'default' | 'signal' | 'danger'`, `size?: 'md' | 'lg'`.
  - `Field(props: FieldProps)` where `FieldProps` extends `InputHTMLAttributes<HTMLInputElement>` with `id: string`, `label: string`, `hint?: string`, `error?: string | null`, `icon?: ReactNode`.
  - `Panel(props: PanelProps)` with `title: string`, `icon?: ReactNode`, `action?: ReactNode`, `children: ReactNode`, `className?: string`.
  - `Chip(props: ChipProps)` with `children: ReactNode`, `tone?: 'default' | 'live' | 'signal'`.
  - `QueueRow(props: QueueRowProps)` with `song: QueueRowData`, `onVote?: (songId: string) => void`, `votingDisabled?: boolean`, `onRemove?: (songId: string) => void`, `canRemove?: boolean`, `removingDisabled?: boolean`.
  - `QueueRowData` with `songId: string`, `title: string`, `channelTitle: string | null`, `thumbnailUrl: string | null`, `position: number`, `addedBy: string`, `voteCount: number`.
  - `TransportButton(props: TransportButtonProps)` with `icon: ReactNode`, `label: string`, `onClick: () => void`, `disabled?: boolean`, `active?: boolean`, `shape?: 'dock' | 'bar'`.
  - `RosterRow(props: RosterRowProps)` with `name: string`, `online: boolean`, `isHost?: boolean`.
  - `LockBanner(props: { text: string })`.

- [x] **Step 1: Write the failing primitive tests**

Create `tests/unit/uiPrimitives.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { PlayIcon } from '@phosphor-icons/react';
import { Button, Chip, Field, IconButton, Panel, QueueRow, RosterRow, TransportButton } from '../../src/ui';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

describe('ui primitives', () => {
  it('pairs an icon with the label of a button', () => {
    render(createElement(Button, { icon: createElement(PlayIcon, { 'aria-hidden': true }), size: 'md' }, 'Start a room'));
    const button = screen.getByRole('button', { name: 'Start a room' });
    expect(button).toBeInTheDocument();
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('gives an icon only button an accessible name and a tooltip', () => {
    render(createElement(IconButton, { icon: createElement(PlayIcon, { 'aria-hidden': true }), label: 'Play' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' }).closest('.tooltip')).toHaveAttribute('data-tooltip', 'Play');
  });

  it('keeps the label of a field above the input and the error below it', () => {
    render(createElement(Field, { id: 'name', label: 'Host name', error: 'That name is taken.' }));
    expect(screen.getByLabelText('Host name')).toBeInTheDocument();
    expect(screen.getByText('That name is taken.')).toBeInTheDocument();
  });

  it('marks an invalid field for assistive technology', () => {
    render(createElement(Field, { id: 'code', label: 'Room code', error: 'That code is wrong.' }));
    expect(screen.getByLabelText('Room code')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders a panel title with its icon', () => {
    render(createElement(Panel, { title: 'Up next', icon: createElement(PlayIcon, { 'aria-hidden': true }) }, 'body'));
    expect(screen.getByRole('heading', { name: /up next/i })).toBeInTheDocument();
  });

  it('shows the vote count and the attribution of a queue row', () => {
    render(createElement(QueueRow, {
      song: { songId: 's1', title: 'Dancing Queen', channelTitle: 'ABBA', thumbnailUrl: null, position: 1, addedBy: 'Ana', voteCount: 3 },
      onVote: () => {},
    }));
    expect(screen.getByText('Dancing Queen')).toBeInTheDocument();
    expect(screen.getByText(/added by Ana/i)).toBeInTheDocument();
    expect(screen.getByLabelText('3 votes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /vote for dancing queen/i })).toBeInTheDocument();
  });

  it('shows the presence of a participant and marks the host', () => {
    render(createElement(RosterRow, { name: 'Ana', online: true, isHost: true }));
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
  });

  it('gives a transport button an accessible name', () => {
    render(createElement(TransportButton, { icon: createElement(PlayIcon, { 'aria-hidden': true }), label: 'Play', onClick: () => {} }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('renders a chip with its text', () => {
    render(createElement(Chip, null, 'ABCD EFGH'));
    expect(screen.getByText('ABCD EFGH')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run tests/unit/uiPrimitives.test.tsx`
Expected: FAIL with a module resolution error for `../../src/ui`.

- [x] **Step 3: Write the primitives**

Create `src/ui/Button.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  busy?: boolean;
};

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-signal-fill text-white hover:bg-signal-fill-hover active:bg-signal-fill-press',
  secondary: 'border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-[0.8125rem]',
  md: 'min-h-11 px-4 text-[0.875rem]',
  lg: 'min-h-[3.25rem] px-5 text-[0.9375rem]',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled === true || busy}
      aria-busy={busy}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-panel font-semibold',
        'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
        'hover:-translate-y-px active:translate-y-0 active:scale-[0.98]',
        'disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
        variants[variant],
        sizes[size],
        className,
      ].join(' ')}
    >
      {icon === undefined ? null : <span aria-hidden="true" className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
```

Create `src/ui/IconButton.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  label: string;
  active?: boolean;
  tone?: 'default' | 'signal' | 'danger';
  size?: 'md' | 'lg';
};

const tones = {
  default: 'border border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
  signal: 'border border-signal/40 bg-signal-soft text-signal hover:bg-signal/20',
  danger: 'border border-danger/40 text-danger hover:bg-danger/10',
} as const;

const sizes = {
  md: 'size-11',
  lg: 'size-14',
} as const;

export default function IconButton({
  icon,
  label,
  active = false,
  tone = 'default',
  size = 'md',
  className = '',
  ...rest
}: IconButtonProps) {
  return (
    <span className="tooltip inline-flex" data-tooltip={label}>
      <button
        {...rest}
        type="button"
        aria-label={label}
        aria-pressed={active === true ? true : undefined}
        className={[
          'grid place-items-center rounded-full',
          'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
          'hover:-translate-y-px active:translate-y-0 active:scale-95',
          'disabled:pointer-events-none disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          active === true ? 'border border-signal bg-signal-soft text-signal' : tones[tone],
          sizes[size],
          className,
        ].join(' ')}
      >
        <span aria-hidden="true" className="grid place-items-center">{icon}</span>
      </button>
    </span>
  );
}
```

Create `src/ui/Field.tsx`:

```tsx
import type { InputHTMLAttributes, ReactNode } from 'react';

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | null;
  icon?: ReactNode;
};

export default function Field({ id, label, hint, error, icon, className = '', ...rest }: FieldProps) {
  const invalid = typeof error === 'string' && error.length > 0;
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink-3">
        {label}
      </label>
      <div className="relative mt-2">
        {icon === undefined ? null : (
          <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            {icon}
          </span>
        )}
        <input
          {...rest}
          id={id}
          aria-invalid={invalid ? 'true' : undefined}
          aria-describedby={invalid === true ? id + '-error' : hint === undefined ? undefined : id + '-hint'}
          className={[
            'min-h-11 w-full rounded-panel border bg-surface-2 px-3.5 text-[0.9375rem] text-ink',
            'placeholder:text-ink-3',
            'transition-[border-color,box-shadow] duration-(--duration-fast) ease-(--ease-console)',
            'focus:outline-none focus-visible:outline-none',
            invalid === true ? 'border-danger focus:border-danger' : 'border-line focus:border-signal',
            icon === undefined ? '' : 'pl-10',
            className,
          ].join(' ')}
        />
      </div>
      {invalid === true ? (
        <p id={id + '-error'} role="alert" className="mt-2 text-[0.8125rem] text-danger">{error}</p>
      ) : hint === undefined ? null : (
        <p id={id + '-hint'} className="mt-2 text-[0.8125rem] text-ink-3">{hint}</p>
      )}
    </div>
  );
}
```

Create `src/ui/Panel.tsx`:

```tsx
import type { ReactNode } from 'react';

export type PanelProps = {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function Panel({ title, icon, action, children, className = '' }: PanelProps) {
  return (
    <section className={['rounded-panel border border-line bg-surface p-6', className].join(' ')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[0.9375rem] font-semibold tracking-tight text-ink">
          {icon === undefined ? null : <span aria-hidden="true" className="text-signal">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
```

Create `src/ui/Chip.tsx`:

```tsx
import type { ReactNode } from 'react';

export type ChipProps = {
  children: ReactNode;
  tone?: 'default' | 'live' | 'signal';
};

const tones = {
  default: 'border-line bg-surface-2 text-ink-2',
  live: 'border-live/30 bg-live/10 text-live',
  signal: 'border-signal/30 bg-signal-soft text-signal',
} as const;

export default function Chip({ children, tone = 'default' }: ChipProps) {
  return (
    <span className={['inline-flex items-center gap-1.5 rounded-badge border px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.12em]', tones[tone]].join(' ')}>
      {children}
    </span>
  );
}
```

Create `src/ui/QueueRow.tsx`:

```tsx
import { ThumbsUpIcon, TrashSimpleIcon } from '@phosphor-icons/react';

export type QueueRowData = {
  songId: string;
  title: string;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  position: number;
  addedBy: string;
  voteCount: number;
};

export type QueueRowProps = {
  song: QueueRowData;
  onVote?: (songId: string) => void;
  votingDisabled?: boolean;
  onRemove?: (songId: string) => void;
  canRemove?: boolean;
  removingDisabled?: boolean;
};

export default function QueueRow({
  song,
  onVote,
  votingDisabled = false,
  onRemove,
  canRemove = false,
  removingDisabled = false,
}: QueueRowProps) {
  return (
    <li className="flex items-center gap-3 rounded-panel border border-line bg-surface-2 p-2.5 transition-colors duration-(--duration-fast) ease-(--ease-console) hover:border-line-strong hover:bg-surface-3">
      <span className="w-5 shrink-0 font-mono text-[0.75rem] text-ink-3">{song.position}</span>
      {song.thumbnailUrl !== null ? (
        <img className="h-10 w-[4.5rem] shrink-0 rounded-media object-cover" src={song.thumbnailUrl} alt="" width={72} height={40} loading="lazy" />
      ) : (
        <span aria-hidden="true" className="h-10 w-[4.5rem] shrink-0 rounded-media bg-surface-3" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-semibold text-ink">{song.title}</span>
        <span className="block truncate text-[0.8125rem] text-ink-3">
          {song.channelTitle ?? 'YouTube'} · added by {song.addedBy}
        </span>
      </span>
      {onRemove !== undefined && canRemove ? (
        <button
          type="button"
          onClick={() => onRemove(song.songId)}
          disabled={removingDisabled}
          aria-label={'Remove ' + song.title}
          className="grid size-9 shrink-0 place-items-center rounded-full text-danger transition-colors duration-(--duration-fast) hover:bg-danger/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40"
        >
          <TrashSimpleIcon size={18} weight="regular" />
        </button>
      ) : null}
      {onVote !== undefined ? (
        <button
          type="button"
          onClick={() => onVote(song.songId)}
          disabled={votingDisabled}
          aria-label={'Vote for ' + song.title + ', ' + song.voteCount + ' votes'}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 font-mono text-[0.8125rem] text-ink-2 transition-colors duration-(--duration-fast) hover:border-signal/50 hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-40"
        >
          <ThumbsUpIcon size={16} weight="duotone" />
          <span className="tabular-nums">{song.voteCount}</span>
        </button>
      ) : (
        <span aria-label={song.voteCount + ' votes'} className="inline-flex min-h-9 shrink-0 items-center gap-1.5 px-2.5 font-mono text-[0.8125rem] text-ink-3">
          <ThumbsUpIcon size={16} weight="duotone" aria-hidden="true" />
          <span className="tabular-nums">{song.voteCount}</span>
        </span>
      )}
    </li>
  );
}
```

Create `src/ui/TransportButton.tsx`:

```tsx
import type { ReactNode } from 'react';

export type TransportButtonProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  shape?: 'dock' | 'bar';
};

export default function TransportButton({
  icon,
  label,
  onClick,
  disabled = false,
  active = false,
  shape = 'dock',
}: TransportButtonProps) {
  if (shape === 'bar') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={[
          'inline-flex min-h-11 items-center gap-2 rounded-panel border px-4 text-[0.875rem] font-semibold',
          'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
          'hover:-translate-y-px active:translate-y-0 active:scale-[0.98]',
          'disabled:pointer-events-none disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          active === true
            ? 'border-signal bg-signal-soft text-signal'
            : 'border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
        ].join(' ')}
      >
        <span aria-hidden="true" className="grid place-items-center">{icon}</span>
        {label}
      </button>
    );
  }

  return (
    <span className="tooltip inline-flex" data-tooltip={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={[
          'grid size-14 place-items-center rounded-full border',
          'transition-[transform,background-color,border-color] duration-(--duration-fast) ease-(--ease-console)',
          'hover:-translate-y-px active:translate-y-0 active:scale-95',
          'disabled:pointer-events-none disabled:opacity-40',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal',
          active === true
            ? 'border-signal bg-signal-soft text-signal'
            : 'border-line bg-surface-2 text-ink hover:border-line-strong hover:bg-surface-3',
        ].join(' ')}
      >
        <span aria-hidden="true" className="grid place-items-center">{icon}</span>
      </button>
    </span>
  );
}
```

Create `src/ui/RosterRow.tsx`:

```tsx
export type RosterRowProps = {
  name: string;
  online: boolean;
  isHost?: boolean;
};

export default function RosterRow({ name, online, isHost = false }: RosterRowProps) {
  return (
    <li className="flex items-center gap-2.5 rounded-full border border-line bg-surface-2 px-3 py-1.5">
      <span
        aria-hidden="true"
        className={['size-2 shrink-0 rounded-full', online === true ? 'animate-presence-pulse bg-live' : 'bg-ink-3'].join(' ')}
      />
      <span className="truncate text-[0.875rem] text-ink">{name}</span>
      {isHost === true ? (
        <span className="rounded-badge bg-signal-soft px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-signal">Host</span>
      ) : null}
      <span className="sr-only">{online === true ? 'Online' : 'Away'}</span>
    </li>
  );
}
```

Create `src/ui/LockBanner.tsx`:

```tsx
import { LockKeyIcon } from '@phosphor-icons/react';

export type LockBannerProps = {
  text: string;
};

export default function LockBanner({ text }: LockBannerProps) {
  return (
    <p role="status" className="flex items-center gap-2 border-t border-line bg-surface-2 px-4 py-2.5 text-[0.8125rem] text-ink-2 sm:px-6">
      <LockKeyIcon size={18} weight="duotone" className="shrink-0 text-signal" aria-hidden="true" />
      {text}
    </p>
  );
}
```

Create `src/ui/index.ts`:

```ts
export { default as Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';
export { default as Chip } from './Chip';
export type { ChipProps } from './Chip';
export { default as Field } from './Field';
export type { FieldProps } from './Field';
export { default as IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';
export { default as LockBanner } from './LockBanner';
export type { LockBannerProps } from './LockBanner';
export { default as Panel } from './Panel';
export type { PanelProps } from './Panel';
export { default as QueueRow } from './QueueRow';
export type { QueueRowData, QueueRowProps } from './QueueRow';
export { default as RosterRow } from './RosterRow';
export type { RosterRowProps } from './RosterRow';
export { default as TransportButton } from './TransportButton';
export type { TransportButtonProps } from './TransportButton';
```

- [x] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/unit/uiPrimitives.test.tsx`
Expected: PASS, 9 tests.

- [x] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `duration-(--duration-fast)` fails to typecheck, it is a class string and typecheck stays quiet. Confirm the build compiles it.

- [x] **Step 6: Commit**

```bash
git add src/ui tests/unit/uiPrimitives.test.tsx package.json package-lock.json
git commit -m "feat: add the console icon layer and shared primitives"
```

---

### Task 3: The landing screen

**Files:**
- Modify: `src/app/HomePage.tsx` (full rewrite)
- Create: `tests/unit/homePage.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Field` from `src/ui`, the room API helpers `createRoom` and `joinRoom` (unchanged).
- Produces: the landing screen at `/`.

- [x] **Step 1: Write the failing landing test**

Create `tests/unit/homePage.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../../src/app/HomePage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };

function renderHome() {
  return render(
    createElement(
      RoomApiProvider,
      { api },
      createElement(MemoryRouter, { children: createElement(HomePage) }),
    ),
  );
}

describe('landing page', () => {
  it('states what the product does', () => {
    renderHome();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/one room/i);
  });

  it('offers both ways in with an icon and a word', () => {
    renderHome();
    expect(screen.getByRole('button', { name: /start a room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join a room/i })).toBeInTheDocument();
  });

  it('asks for a host name and a room code', () => {
    renderHome();
    expect(screen.getByLabelText(/host name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/guest name/i)).toBeInTheDocument();
  });

  it('shows the hero photograph with a description', () => {
    renderHome();
    const image = screen.getByRole('img', { name: /microphone/i });
    expect(image).toHaveAttribute('src', '/images/hero-microphone.jpg');
  });

  it('explains the three steps with icons and words', () => {
    renderHome();
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Invite')).toBeInTheDocument();
    expect(screen.getByText('Sing')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/homePage.test.tsx`
Expected: FAIL, because the current page has no "Start a room" button and no hero image.

- [x] **Step 3: Rewrite the landing screen**

Replace `src/app/HomePage.tsx` with:

```tsx
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BroadcastIcon,
  KeyIcon,
  ListIcon,
  MicrophoneStageIcon,
  MusicNoteIcon,
  QrCodeIcon,
} from '@phosphor-icons/react';
import { useRoomApi } from './RoomApiProvider';
import { createRoom, joinRoom } from '../features/rooms/roomApi';
import { Button, Field } from '../ui';

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

const steps = [
  { icon: BroadcastIcon, label: 'Start', note: 'Open a room on the big screen' },
  { icon: QrCodeIcon, label: 'Invite', note: 'Send the code or the link' },
  { icon: MusicNoteIcon, label: 'Sing', note: 'Queue a song from any phone' },
];

export default function HomePage() {
  const api = useRoomApi();
  const navigate = useNavigate();
  const [createName, setCreateName] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy('create');
    try {
      const created = await createRoom({ api }, createName);
      navigate('/room/' + created.roomId + '/host');
    } catch (caught) {
      setError(describeError(caught));
      setBusy(null);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setBusy('join');
    try {
      const joined = await joinRoom({ api }, joinCode, joinName);
      navigate('/room/' + joined.roomId);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(null);
    }
  }

  return (
    <main className="min-h-dvh bg-graphite text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-graphite/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-media bg-signal-fill text-white">
              <MicrophoneStageIcon size={20} weight="fill" aria-hidden="true" />
            </span>
            <span className="font-display text-xl font-bold tracking-tight">encore</span>
          </a>
          <a href="#how" className="inline-flex items-center gap-2 text-[0.875rem] text-ink-2 transition-colors hover:text-ink">
            <ListIcon size={18} weight="duotone" aria-hidden="true" />
            How it works
          </a>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1400px] gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
        <div className="max-w-[42rem]">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-signal">Live on YouTube</p>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
            One room. Every voice.
          </h1>
          <p className="mt-5 max-w-[46ch] text-[0.9375rem] leading-relaxed text-ink-2">
            Open a room, send the code, and everyone sings from their own phone. One shared queue, one screen for the music.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <form onSubmit={handleCreate} className="rounded-panel border border-line bg-surface p-6" aria-label="Start a room">
              <span className="grid size-10 place-items-center rounded-media bg-signal-soft text-signal">
                <BroadcastIcon size={22} weight="duotone" aria-hidden="true" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold tracking-tight">Start a room</h2>
              <p className="mt-1 text-[0.8125rem] text-ink-3">You host on the big screen.</p>
              <Field
                id="create-name"
                label="Host name"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                placeholder="Ana"
                autoComplete="nickname"
                maxLength={32}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="mt-4 w-full"
                icon={<BroadcastIcon size={18} weight="duotone" />}
                busy={busy === 'create'}
              >
                {busy === 'create' ? 'Starting the room' : 'Start a room'}
              </Button>
            </form>

            <form onSubmit={handleJoin} className="rounded-panel border border-line bg-surface p-6" aria-label="Join a room">
              <span className="grid size-10 place-items-center rounded-media bg-signal-soft text-signal">
                <KeyIcon size={22} weight="duotone" aria-hidden="true" />
              </span>
              <h2 className="mt-4 font-display text-lg font-semibold tracking-tight">Join a room</h2>
              <p className="mt-1 text-[0.8125rem] text-ink-3">Type the code the host shared.</p>
              <Field
                id="join-code"
                label="Room code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="ABCD EFGH JKMN PQRS"
                autoComplete="off"
                spellCheck={false}
                maxLength={24}
              />
              <Field
                id="join-name"
                label="Guest name"
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                placeholder="Sam"
                autoComplete="nickname"
                maxLength={32}
              />
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                className="mt-4 w-full"
                icon={<KeyIcon size={18} weight="duotone" />}
                busy={busy === 'join'}
              >
                {busy === 'join' ? 'Joining the room' : 'Join a room'}
              </Button>
            </form>
          </div>

          {error === null ? null : (
            <p role="alert" className="mt-4 rounded-media border-l-2 border-danger bg-danger/10 px-3.5 py-2.5 text-[0.875rem] text-danger">
              {error}
            </p>
          )}
        </div>

        <div className="lg:pl-4">
          <div className="relative overflow-hidden rounded-panel border border-line">
            <img
              src="/images/hero-microphone.jpg"
              alt="A vintage chrome microphone on a lit stage"
              width={1600}
              height={2000}
              fetchPriority="high"
              className="aspect-[4/5] w-full object-cover"
            />
            <span aria-hidden="true" className="absolute inset-0 bg-signal/25 mix-blend-color" />
            <span aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,11,14,0.1),rgba(10,11,14,0.92))]" />
          </div>

          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {steps.map((step) => (
              <li key={step.label} className="rounded-panel border border-line bg-surface p-4">
                <step.icon size={22} weight="duotone" className="text-signal" aria-hidden="true" />
                <p className="mt-3 font-display text-[0.9375rem] font-semibold">{step.label}</p>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-3">{step.note}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="how" className="border-t border-line bg-graphite-soft">
        <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 lg:py-20">
          <h2 className="font-display text-[clamp(1.75rem,3.4vw,2.25rem)] font-semibold tracking-tight">
            The host owns the screen. The guests own the queue.
          </h2>
          <div className="mt-8 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-ink-2">
              The host screen plays the music and shows the queue. Every guest searches YouTube from their own phone, votes for the next track and holds the remote. No account, no install, one room code.
            </p>
            <div className="overflow-hidden rounded-panel border border-line">
              <img
                src="/images/singer-stage.jpg"
                alt="A singer on stage under blue light"
                width={1600}
                height={1067}
                loading="lazy"
                className="aspect-[3/2] w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-[0.8125rem] text-ink-3 sm:px-6">
          <p>Encore. A shared stage for songs worth singing together.</p>
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em]">No accounts. No install. One code.</p>
        </div>
      </footer>
    </main>
  );
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/homePage.test.tsx`
Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add src/app/HomePage.tsx tests/unit/homePage.test.tsx
git commit -m "feat: rebuild the landing screen on the console primitives"
```

---

### Task 4: The join screen

**Files:**
- Modify: `src/app/JoinRoomPage.tsx` (full rewrite)
- Create: `tests/unit/joinRoomPage.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Field`, `MicrophoneStageIcon`, the room API helper `joinRoom` (unchanged).
- Produces: the join screen at `/join/:roomCode`.

- [x] **Step 1: Write the failing join test**

Create `tests/unit/joinRoomPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import JoinRoomPage from '../../src/app/JoinRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});

const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };

function renderJoin(code = 'ABCDEFGHJKMNPQRS') {
  return render(
    createElement(
      RoomApiProvider,
      { api },
      createElement(
        MemoryRouter,
        { initialEntries: ['/join/' + code] },
        createElement(
          Routes,
          { children: createElement(Route, { path: '/join/:roomCode', element: createElement(JoinRoomPage) }) },
        ),
      ),
    ),
  );
}

describe('join screen', () => {
  it('names the room the guest is joining', () => {
    renderJoin();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/join the room/i);
    expect(screen.getByText('ABCDEFGHJKMNPQRS')).toBeInTheDocument();
  });

  it('asks for the guest name and offers the join action', () => {
    renderJoin();
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join a room/i })).toBeInTheDocument();
  });

  it('keeps the room code visible', () => {
    renderJoin();
    expect(screen.getByLabelText(/room code/i)).toHaveValue('ABCDEFGHJKMNPQRS');
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/joinRoomPage.test.tsx`
Expected: FAIL, because the current screen has no "Join a room" button and no room code display.

- [x] **Step 3: Rewrite the join screen**

Replace `src/app/JoinRoomPage.tsx` with:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KeyIcon, MicrophoneStageIcon } from '@phosphor-icons/react';
import { useRoomApi } from './RoomApiProvider';
import { joinRoom } from '../features/rooms/roomApi';
import { isValidRoomCode, normalizeRoomCode } from '../features/rooms/roomCode';
import { Button, Field } from '../ui';

type JoinStatus = 'idle' | 'joining' | 'failed';

export default function JoinRoomPage() {
  const api = useRoomApi();
  const navigate = useNavigate();
  const params = useParams<{ roomCode: string }>();
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<JoinStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = params.roomCode ?? '';
    setCode(normalizeRoomCode(raw));
  }, [params.roomCode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus('joining');
    try {
      const joined = await joinRoom({ api }, code, displayName);
      navigate('/room/' + joined.roomId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That room could not be joined.');
      setStatus('failed');
    }
  }

  const canSubmit = isValidRoomCode(code) && status !== 'joining';

  return (
    <main className="grid min-h-dvh place-items-center bg-graphite px-4 py-12 text-ink">
      <div className="w-full max-w-[30rem]">
        <a href="/" className="inline-flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-media bg-signal-fill text-white">
            <MicrophoneStageIcon size={20} weight="fill" aria-hidden="true" />
          </span>
          <span className="font-display text-xl font-bold tracking-tight">encore</span>
        </a>

        <div className="mt-8 rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-[clamp(1.75rem,3.4vw,2.25rem)] font-semibold tracking-tight">Join the room</h1>
          <p className="mt-2 text-[0.9375rem] text-ink-2">
            Room code <span className="font-mono text-ink">{code}</span>. Add your name to take the remote.
          </p>

          <form onSubmit={handleSubmit} aria-label="Join this room">
            <Field
              id="code"
              label="Room code"
              value={code}
              onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
              placeholder="ABCD EFGH JKMN PQRS"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              icon={<KeyIcon size={18} weight="duotone" />}
              error={code.length > 0 && !isValidRoomCode(code) ? 'That code is not sixteen characters.' : null}
            />
            <Field
              id="name"
              label="Your name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Sam"
              autoComplete="nickname"
              maxLength={32}
            />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-5 w-full"
              icon={<KeyIcon size={18} weight="duotone" />}
              busy={status === 'joining'}
              disabled={!canSubmit}
            >
              {status === 'joining' ? 'Joining the room' : 'Join a room'}
            </Button>
          </form>

          {error === null ? null : (
            <p role="alert" className="mt-4 rounded-media border-l-2 border-danger bg-danger/10 px-3.5 py-2.5 text-[0.875rem] text-danger">
              {error}
            </p>
          )}
          {status === 'failed' ? (
            <a href="/" className="mt-4 inline-block text-[0.8125rem] text-signal hover:underline">Try another room</a>
          ) : null}
        </div>
      </div>
    </main>
  );
}
```

- [x] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/joinRoomPage.test.tsx`
Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add src/app/JoinRoomPage.tsx tests/unit/joinRoomPage.test.tsx
git commit -m "feat: rebuild the join screen on the console primitives"
```

---

### Task 5: The guest remote

**Files:**
- Modify: `src/features/queue/QueueList.tsx`
- Modify: `src/features/rooms/ParticipantRoster.tsx`
- Modify: `src/features/playback/PlaybackControls.tsx`
- Modify: `src/features/queue/SongSearch.tsx`
- Modify: `src/features/queue/PasteSongForm.tsx`
- Modify: `src/app/GuestRoomPage.tsx` (full rewrite)
- Modify: `tests/unit/playbackControls.test.tsx` (the transport shape is now a prop)

**Interfaces:**
- Consumes: `QueueRow`, `RosterRow`, `TransportButton`, `Panel`, `Chip`, `LockBanner`, `Button`, `Field` from `src/ui`.
- Produces: `PlaybackControls` gains the prop `shape?: 'dock' | 'bar'` and `QueueList` keeps its current props.

- [x] **Step 1: Update the playback control test**

In `tests/unit/playbackControls.test.tsx`, replace the render helper with one that accepts a shape, and add a case for the dock shape:

```tsx
function renderControls(api: EdgeApi, playback: { isPlaying: boolean }, disabled = false, shape: 'dock' | 'bar' = 'bar') {
  localStorage.setItem('karaoke.guest.' + roomId, 'guest-pass');
  return render(
    createElement(RoomApiProvider, {
      api,
      children: createElement(PlaybackControls, {
        roomId,
        playback: {
          currentSongId: 's1',
          currentVideoId: 'dQw4w9WgXcQ',
          positionSeconds: 12,
          isPlaying: playback.isPlaying,
          updatedAt: null,
        },
        disabled,
        shape,
      }),
    }),
  );
}
```

Add at the end of the describe block:

```tsx
  it('keeps the dock shape on one line with round buttons', () => {
    const api: EdgeApi = { invoke: (async () => ({})) as unknown as EdgeApi['invoke'] };
    const { container } = renderControls(api, { isPlaying: false }, false, 'dock');
    expect(container.querySelectorAll('button')).toHaveLength(3);
    expect(screen.getByRole('button', { name: /^play$/i }).className).toContain('rounded-full');
  });
```

- [x] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/playbackControls.test.tsx`
Expected: FAIL, because `PlaybackControls` has no `shape` prop.

- [x] **Step 3: Rewrite the playback controls**

Replace `src/features/playback/PlaybackControls.tsx` with:

```tsx
import { useState } from 'react';
import { PauseIcon, PlayIcon, SkipForwardIcon } from '@phosphor-icons/react';
import { useRoomApi } from '../../app/RoomApiProvider';
import { RoomApiError } from '../../lib/edgeApi';
import { sendPlaybackCommand, type PlaybackState } from './playbackApi';
import { TransportButton } from '../../ui';

type Props = {
  roomId: string;
  playback: PlaybackState | undefined;
  disabled?: boolean;
  shape?: 'dock' | 'bar';
  onChanged?: () => void;
};

function describeError(error: unknown): string {
  if (error instanceof RoomApiError) {
    if (error.code === 'GUEST_CONTROLS_LOCKED') return 'The host locked guest controls.';
    if (error.code === 'ROOM_ENDED') return 'This room has ended.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'That playback action failed.';
}

export default function PlaybackControls({ roomId, playback, disabled = false, shape = 'bar', onChanged }: Props) {
  const api = useRoomApi();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isPlaying = playback?.isPlaying === true;

  async function run(action: 'play' | 'pause' | 'next'): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await sendPlaybackCommand(api, roomId, action);
      onChanged?.();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className={shape === 'dock' ? 'flex items-center justify-center gap-3' : 'flex flex-wrap items-center gap-2'}>
        <TransportButton
          shape={shape}
          label="Play"
          icon={<PlayIcon size={20} weight="fill" />}
          active={isPlaying}
          disabled={disabled || busy || isPlaying}
          onClick={() => void run('play')}
        />
        <TransportButton
          shape={shape}
          label="Pause"
          icon={<PauseIcon size={20} weight="fill" />}
          active={!isPlaying}
          disabled={disabled || busy || !isPlaying}
          onClick={() => void run('pause')}
        />
        <TransportButton
          shape={shape}
          label="Skip"
          icon={<SkipForwardIcon size={20} weight="fill" />}
          disabled={disabled || busy}
          onClick={() => void run('next')}
        />
      </div>
      {error === null ? null : (
        <p role="alert" className="rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [x] **Step 4: Rewrite the queue list and the roster**

Replace `src/features/queue/QueueList.tsx` with:

```tsx
import { MusicNoteIcon } from '@phosphor-icons/react';
import type { QueueEntry } from '../rooms/useRoomData';
import { QUEUE_ELEMENT_ID } from './queueAnchor';
import { Panel, QueueRow } from '../../ui';

type Props = {
  queue: QueueEntry[];
  onVote?: (songId: string) => void;
  votingDisabled?: boolean;
  onRemove?: (songId: string) => void;
  canRemove?: (song: QueueEntry) => boolean;
  removingDisabled?: boolean;
};

export default function QueueList({
  queue,
  onVote,
  votingDisabled = false,
  onRemove,
  canRemove,
  removingDisabled = false,
}: Props) {
  if (queue.length === 0) {
    return (
      <Panel title="Up next" icon={<MusicNoteIcon size={18} weight="duotone" />}>
        <p id={QUEUE_ELEMENT_ID} className="text-[0.875rem] text-ink-3">
          No songs yet. Search for a track or paste a YouTube link to start the queue.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Up next" icon={<MusicNoteIcon size={18} weight="duotone" />}>
      <ol id={QUEUE_ELEMENT_ID} className="flex flex-col gap-2">
        {queue.map((song) => (
          <QueueRow
            key={song.songId}
            song={{
              songId: song.songId,
              title: song.title,
              channelTitle: song.channelTitle,
              thumbnailUrl: song.thumbnailUrl,
              position: song.position,
              addedBy: song.addedBy,
              voteCount: song.voteCount,
            }}
            onVote={onVote}
            votingDisabled={votingDisabled}
            onRemove={onRemove}
            canRemove={canRemove === undefined ? false : canRemove(song)}
            removingDisabled={removingDisabled}
          />
        ))}
      </ol>
    </Panel>
  );
}
```

Replace `src/features/rooms/ParticipantRoster.tsx` with:

```tsx
import { UsersThreeIcon } from '@phosphor-icons/react';
import type { RosterEntry } from './useRoomData';
import { Panel, RosterRow } from '../../ui';

export default function ParticipantRoster({ roster }: { roster: RosterEntry[] }) {
  return (
    <Panel title="In the room" icon={<UsersThreeIcon size={18} weight="duotone" />}>
      <ul className="flex flex-wrap gap-2">
        {roster.map((member) => (
          <RosterRow
            key={member.memberId}
            name={member.displayName}
            online={member.online}
            isHost={member.role === 'host'}
          />
        ))}
      </ul>
    </Panel>
  );
}
```

- [x] **Step 5: Restyle the search and the paste form**

Replace the return block of `src/features/queue/SongSearch.tsx` with the block below and add the two imports. Keep every function, the state and the `watchUrl` export exactly as they are.

```tsx
  return (
    <div className="flex flex-col gap-3">
      <Field
        id="song-search"
        label="Find a song on YouTube"
        value={typeahead.query}
        onChange={(event) => typeahead.setQuery(event.target.value)}
        placeholder="Start typing a song or artist"
        autoComplete="off"
        maxLength={100}
        disabled={disabled}
        icon={<MagnifyingGlassIcon size={18} weight="regular" />}
        role="combobox"
        aria-expanded={results.length > 0 || typeahead.suggestions.length > 0}
        aria-controls="song-options"
        aria-autocomplete="list"
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<MagnifyingGlassIcon size={16} weight="bold" />} disabled={disabled || searching || !typedEnough} onClick={() => void searchNow(typeahead.query)}>
          {searching ? 'Looking' : 'Show songs'}
        </Button>
        <Button variant="ghost" size="sm" icon={<QueueIcon size={16} weight="duotone" />} onClick={() => scrollToQueue()}>
          View queue
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{error}</p>
      )}
      {message === null ? null : (
        <p role="status" className="text-[0.8125rem] text-ink-3">{message}</p>
      )}
      {!songSearchReady && typedEnough ? (
        <p role="status" className="text-[0.8125rem] text-ink-3">
          Songs from YouTube need a data API key. Suggestions below still come from YouTube.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul id="song-options" aria-label="Songs" className="flex flex-col gap-2">
          {results.map((result) => (
            <li key={result.videoId} className="flex items-center gap-3 rounded-panel border border-line bg-surface-2 p-2.5">
              {result.thumbnailUrl !== null ? (
                <img className="h-10 w-[4.5rem] shrink-0 rounded-media object-cover" src={result.thumbnailUrl} alt="" width={72} height={40} loading="lazy" />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.9375rem] font-semibold">{result.title}</span>
                <span className="block truncate text-[0.8125rem] text-ink-3">{result.channelTitle ?? 'YouTube'}</span>
              </span>
              <a
                href={watchUrl(result.videoId)}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={'Open ' + result.title + ' on YouTube'}
                className="hidden text-[0.75rem] text-ink-3 underline hover:text-signal sm:inline"
              >
                YouTube
              </a>
              <Button
                variant="primary"
                size="sm"
                icon={<PlusIcon size={16} weight="bold" />}
                disabled={disabled || addingId !== null}
                onClick={() => void handleAdd(result.videoId)}
              >
                {addingId === result.videoId ? 'Adding' : 'Queue'}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {results.length === 0 && typeahead.suggestions.length > 0 ? (
        <ul id="song-options" aria-label="Song suggestions" className="flex flex-col gap-1.5">
          {typeahead.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => void searchNow(suggestion)}
                disabled={disabled}
                className="w-full rounded-panel border border-line bg-surface-2 px-3.5 py-2.5 text-left text-[0.875rem] text-ink transition-colors hover:border-signal/40 hover:bg-surface-3 disabled:opacity-40"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
```

Add these imports at the top of `SongSearch.tsx`:

```tsx
import { MagnifyingGlassIcon, PlusIcon, QueueIcon } from '@phosphor-icons/react';
import { Button, Field } from '../../ui';
```

Replace `src/features/queue/PasteSongForm.tsx` with:

```tsx
import { useState, type FormEvent } from 'react';
import { LinkIcon, PlusIcon } from '@phosphor-icons/react';
import { RoomApiError } from '../../lib/edgeApi';
import { parseYouTubeVideoId } from './youtubeVideo';
import { addSong } from './queueApi';
import { scrollToQueue } from './queueAnchor';
import { useRoomApi } from '../../app/RoomApiProvider';
import { Button, Field } from '../../ui';

type Props = {
  roomId: string;
  disabled?: boolean;
  onAdded?: () => void;
};

function describeError(error: unknown): string {
  if (error instanceof RoomApiError) {
    if (error.code === 'RATE_LIMITED') return 'That is five songs this minute. Wait a moment.';
    if (error.code === 'GUEST_CONTROLS_LOCKED') return 'The host locked guest controls.';
    if (error.code === 'METADATA_UNAVAILABLE') return 'That video could not be read. Check the link.';
    if (error.code === 'ROOM_ENDED') return 'This room has ended.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'That song could not be added.';
}

export default function PasteSongForm({ roomId, disabled = false, onAdded }: Props) {
  const api = useRoomApi();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const videoId = parseYouTubeVideoId(value);
    if (videoId === null) {
      setError('Paste a YouTube link or an eleven character video id.');
      return;
    }

    setBusy(true);
    try {
      const song = await addSong(api, roomId, videoId);
      setValue('');
      setNotice(song.title + ' is in the queue');
      onAdded?.();
      scrollToQueue();
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Add a song by link">
      <Field
        id="song-link"
        label="Paste a YouTube link"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="https://youtu.be/..."
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        icon={<LinkIcon size={18} weight="regular" />}
        error={error}
      />
      <Button
        type="submit"
        variant="secondary"
        size="md"
        className="mt-3"
        icon={<PlusIcon size={16} weight="bold" />}
        disabled={disabled || busy}
        busy={busy}
      >
        {busy ? 'Adding' : 'Add to queue'}
      </Button>
      {notice === null ? null : (
        <p role="status" className="mt-2 text-[0.8125rem] text-ink-3">{notice}</p>
      )}
    </form>
  );
}
```

- [x] **Step 6: Rebuild the guest screen**

Replace `src/app/GuestRoomPage.tsx` with:

```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { LockKeyIcon, MagnifyingGlassIcon, MusicNoteIcon } from '@phosphor-icons/react';import { useRoomData } from '../features/rooms/useRoomData';
import ParticipantRoster from '../features/rooms/ParticipantRoster';
import QueueList from '../features/queue/QueueList';
import PasteSongForm from '../features/queue/PasteSongForm';
import SongSearch from '../features/queue/SongSearch';
import PlaybackControls from '../features/playback/PlaybackControls';
import { toggleVote } from '../features/queue/voteApi';
import { removeSong } from '../features/queue/queueApi';
import { useRoomApi } from './RoomApiProvider';
import { Chip, LockBanner, Panel } from '../ui';

export default function GuestRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const { data, error, loading, refresh } = useRoomData(roomId, 'guest');
  const [voteError, setVoteError] = useState<string | null>(null);

  async function handleRemove(songId: string): Promise<void> {
    setVoteError(null);
    try {
      await removeSong(api, roomId, songId);
      await refresh();
    } catch (caught) {
      setVoteError(caught instanceof Error ? caught.message : 'That song could not be removed.');
    }
  }

  async function handleVote(songId: string): Promise<void> {
    setVoteError(null);
    try {
      await toggleVote(api, roomId, songId);
      await refresh();
    } catch (caught) {
      setVoteError(caught instanceof Error ? caught.message : 'That vote failed.');
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-graphite px-4 py-6 text-ink">
        <div className="skeleton h-14 w-full rounded-panel" />
        <div className="skeleton mt-4 h-32 w-full rounded-panel" />
        <div className="skeleton mt-4 h-64 w-full rounded-panel" />
      </main>
    );
  }

  if (error !== null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Room unavailable</h1>
          <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3.5 py-2.5 text-[0.875rem] text-danger">{error}</p>
          <a href="/" className="mt-4 inline-block text-[0.875rem] text-signal hover:underline">Back to start</a>
        </div>
      </main>
    );
  }

  if (data === null || data.status === 'ended') {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">This room has ended</h1>
          <p className="mt-2 text-[0.875rem] text-ink-3">The host closed the session. Thanks for singing.</p>
          <a href="/" className="mt-4 inline-block text-[0.875rem] text-signal hover:underline">Start another room</a>
        </div>
      </main>
    );
  }

  const roster = data.roster ?? [];
  const queue = data.queue ?? [];
  const locked = data.room?.guestControlLocked === true;
  const nowPlaying = queue.find((song) => song.status === 'playing');

  return (
    <main className="min-h-dvh bg-graphite pb-32 text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-graphite/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <MusicNoteIcon size={22} weight="duotone" className="shrink-0 text-signal" aria-hidden="true" />
            <h1 className="truncate font-display text-lg font-semibold tracking-tight">
              {data.viewer?.displayName ?? 'Guest'}
            </h1>
          </div>
          <Chip>{data.room?.code ?? ''}</Chip>
        </div>
        {locked ? <LockBanner text="Guest controls are locked by the host" /> : null}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {nowPlaying === undefined ? null : (
            <Panel title="Now playing" icon={<MusicNoteIcon size={18} weight="duotone" />}>
              <div className="flex items-center gap-3">
                {nowPlaying.thumbnailUrl !== null ? (
                  <img className="h-14 w-24 shrink-0 rounded-media object-cover" src={nowPlaying.thumbnailUrl} alt="" width={96} height={56} loading="lazy" />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] font-semibold">{nowPlaying.title}</p>
                  <p className="truncate text-[0.8125rem] text-ink-3">{nowPlaying.channelTitle ?? 'YouTube'}</p>
                </div>
                <span aria-hidden="true" className="ml-auto flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-live">
                  <span className="size-2 animate-presence-pulse rounded-full bg-live" />
                  Live
                </span>
              </div>
            </Panel>
          )}

          <Panel title="Add a song" icon={<MagnifyingGlassIcon size={18} weight="duotone" />}>
            <SongSearch roomId={roomId} disabled={locked} onAdded={() => { void refresh(); }} />
            <div className="mt-4 border-t border-line pt-4">
              <PasteSongForm roomId={roomId} disabled={locked} onAdded={() => { void refresh(); }} />
            </div>
          </Panel>

          <QueueList
            queue={queue}
            onVote={(songId) => { void handleVote(songId); }}
            votingDisabled={locked}
            onRemove={(songId) => { void handleRemove(songId); }}
            canRemove={(song) => song.memberId === data.viewer?.memberId}
            removingDisabled={locked}
          />
          {voteError === null ? null : (
            <p role="alert" className="rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{voteError}</p>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <ParticipantRoster roster={roster} />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-graphite/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-center gap-3 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <PlaybackControls
            roomId={roomId}
            playback={data.playback}
            disabled={locked}
            shape="dock"
            onChanged={() => { void refresh(); }}
          />
        </div>
      </div>
    </main>
  );
}
```

- [x] **Step 7: Run the affected tests**

Run: `npx vitest run tests/unit/playbackControls.test.tsx tests/unit/queueList.test.tsx tests/unit/songSearch.test.tsx tests/unit/guestRoomPage.test.tsx tests/unit/queueRemove.test.tsx`
Expected: PASS with no test changes outside the playback control test.

- [x] **Step 8: Commit**

```bash
git add src/app/GuestRoomPage.tsx src/features/queue/QueueList.tsx src/features/rooms/ParticipantRoster.tsx src/features/playback/PlaybackControls.tsx src/features/queue/SongSearch.tsx src/features/queue/PasteSongForm.tsx tests/unit/playbackControls.test.tsx
git commit -m "feat: rebuild the guest remote on the console primitives"
```

---

### Task 6: The host console

**Files:**
- Modify: `src/app/HostRoomPage.tsx` (full rewrite)
- Modify: `src/features/playback/YouTubePlayer.tsx` (restyle the stage and the mode buttons)
- Create: `tests/unit/hostRoomPage.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Chip`, `IconButton`, `LockBanner`, `Panel` from `src/ui`, `PlaybackControls` with `shape="bar"`.
- Produces: the host console at `/room/:roomId/host`.

- [x] **Step 1: Write the failing host test**

Create `tests/unit/hostRoomPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HostRoomPage from '../../src/app/HostRoomPage';
import { RoomApiProvider } from '../../src/app/RoomApiProvider';
import type { EdgeApi } from '../../src/lib/edgeApi';
import '@testing-library/jest-dom/vitest';

const roomId = '3a1ee27f-a539-4190-9250-bdc14ff631e0';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const liveRoom = {
  roomId,
  status: 'live',
  room: { id: roomId, code: 'ABCDEFGHJKMNPQRS', status: 'live', guestControlLocked: false, createdAt: '2026-10-18T00:00:00Z' },
  viewer: { memberId: 'm1', displayName: 'Ana', role: 'host' },
  roster: [{ memberId: 'm1', displayName: 'Ana', role: 'host', online: true }],
  queue: [],
  playback: { currentSongId: null, currentVideoId: null, positionSeconds: 0, isPlaying: false, updatedAt: null },
  events: [],
};

function renderHost() {
  localStorage.setItem('karaoke.host.' + roomId, 'host-pass');
  const api: EdgeApi = {
    invoke: (async () => liveRoom) as unknown as EdgeApi['invoke'],
  };
  return render(
    createElement(
      RoomApiProvider,
      { api },
      createElement(
        MemoryRouter,
        { initialEntries: ['/room/' + roomId + '/host'] },
        createElement(
          Routes,
          { children: createElement(Route, { path: '/room/:roomId/host', element: createElement(HostRoomPage) }) },
        ),
      ),
    ),
  );
}

describe('host console', () => {
  it('shows the room code and the invite tools', async () => {
    renderHost();
    expect(await screen.findByText('ABCDEFGHJKMNPQRS')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('offers the host controls with an icon and a word', async () => {
    renderHost();
    expect(await screen.findByRole('button', { name: /^lock$/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /clear queue/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /end room/i })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/hostRoomPage.test.tsx`
Expected: FAIL, because the current host screen has no "Copy link" button and no "Lock" button with that name.

- [x] **Step 3: Restyle the player**

In `src/features/playback/YouTubePlayer.tsx`, replace the returned markup with:

```tsx
  return (
    <section ref={panelRef} className={'rounded-panel border border-line bg-surface p-4' + (mode === 'theater' ? ' lg:col-span-2' : '')} aria-label="Karaoke player">
      <div className="relative aspect-video overflow-hidden rounded-media bg-black" data-mode={mode}>
        {videoId === null ? (
          <p className="grid h-full place-items-center text-[0.9375rem] text-ink-3">Add a song to start the night.</p>
        ) : (
          <div className="h-full w-full" ref={hostRef} data-video-id={videoId} />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Player view">
        <IconButton icon={<CornersOutIcon size={18} weight="regular" />} label="Theater" active={mode === 'theater'} onClick={() => onModeChange?.('theater')} />
        <IconButton icon={<CornersInIcon size={18} weight="regular" />} label="Normal" active={mode === 'normal'} onClick={() => onModeChange?.('normal')} />
        <IconButton icon={<ArrowsOutIcon size={18} weight="regular" />} label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} active={isFullscreen} onClick={() => void toggleFullscreen()} />
      </div>

      {needsTap ? (
        <Button variant="primary" size="md" className="mt-3" icon={<PlayIcon size={18} weight="fill" />} onClick={() => {
          try {
            playerRef.current?.play();
            setNeedsTap(false);
          } catch {
            setNeedsTap(true);
          }
        }}>
          Tap to start audio
        </Button>
      ) : null}

      {error === null ? null : (
        <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{error}</p>
      )}
      {videoId !== null && playback?.currentVideoId !== undefined ? (
        <p className="mt-3 font-mono text-[0.75rem] text-ink-3">Now playing {videoId}</p>
      ) : null}
    </section>
  );
```

Add these imports at the top of the file:

```tsx
import { ArrowsOutIcon, CornersInIcon, CornersOutIcon, PlayIcon } from '@phosphor-icons/react';
import { Button, IconButton } from '../../ui';
```

- [x] **Step 4: Rebuild the host screen**

Replace `src/app/HostRoomPage.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  CopyIcon,
  LockKeyIcon,
  LockSimpleIcon,
  LockSimpleOpenIcon,
  MicrophoneStageIcon,
  MusicNoteIcon,
  PowerIcon,
  QrCodeIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useRoomData } from '../features/rooms/useRoomData';
import { useRoomApi } from './RoomApiProvider';
import { sendHostCommand } from '../features/rooms/roomApi';
import { removeSong } from '../features/queue/queueApi';
import { buildJoinUrl } from '../features/rooms/roomUrl';
import ParticipantRoster from '../features/rooms/ParticipantRoster';
import QueueList from '../features/queue/QueueList';
import PasteSongForm from '../features/queue/PasteSongForm';
import SongSearch from '../features/queue/SongSearch';
import PlaybackControls from '../features/playback/PlaybackControls';
import YouTubePlayer, { type PlayerViewMode } from '../features/playback/YouTubePlayer';
import { youtubePlayerFactory } from '../features/playback/youtubeIframe';
import { reportPlaybackPosition, sendPlaybackCommand } from '../features/playback/playbackApi';
import { Button, Chip, IconButton, LockBanner, Panel } from '../ui';

// The code is read aloud, so it groups into blocks of four.
function groupCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1 ');
}

export default function HostRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId ?? '';
  const api = useRoomApi();
  const { data, error, loading, refresh } = useRoomData(roomId, 'host');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [commandError, setCommandError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<PlayerViewMode>('normal');
  const [copied, setCopied] = useState(false);

  const code = data?.room?.code ?? '';
  const joinUrl = code.length > 0 ? buildJoinUrl(window.location.origin, code) : '';

  useEffect(() => {
    if (joinUrl.length === 0) {
      setQrSvg('');
      return;
    }
    let cancelled = false;
    void QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 220 })
      .then((svg) => {
        if (!cancelled) setQrSvg(svg);
      })
      .catch(() => {
        if (!cancelled) setQrSvg('');
      });
    return () => {
      cancelled = true;
    };
  }, [joinUrl]);

  async function runPlayback(action: 'play' | 'pause' | 'next'): Promise<void> {
    try {
      await sendPlaybackCommand(api, roomId, action);
      await refresh();
    } catch {
      // The player retries on the next invalidation.
    }
  }

  async function runCommand(action: 'lock' | 'unlock' | 'end' | 'clear_queue'): Promise<void> {
    setCommandError(null);
    try {
      await sendHostCommand(api, roomId, action);
      await refresh();
    } catch (caught) {
      setCommandError(caught instanceof Error ? caught.message : 'That command failed.');
    }
  }

  async function copyJoinLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
    } catch {
      setCommandError('The link could not be copied. Select it and copy by hand.');
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-graphite px-4 py-6 text-ink">
        <div className="skeleton h-16 w-full rounded-panel" />
        <div className="skeleton mt-4 h-96 w-full rounded-panel" />
      </main>
    );
  }

  if (error !== null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Host controls unavailable</h1>
          <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3.5 py-2.5 text-[0.875rem] text-danger">{error}</p>
          <a href="/" className="mt-4 inline-block text-[0.875rem] text-signal hover:underline">Back to start</a>
        </div>
      </main>
    );
  }

  if (data === null || data.status === 'ended') {
    return (
      <main className="grid min-h-dvh place-items-center bg-graphite px-4 text-ink">
        <div className="w-full max-w-[30rem] rounded-panel border border-line bg-surface p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">This room has ended</h1>
          <p className="mt-2 text-[0.875rem] text-ink-3">Nobody can join a room after it ends.</p>
          <a href="/" className="mt-4 inline-block text-[0.875rem] text-signal hover:underline">Start another room</a>
        </div>
      </main>
    );
  }

  const roster = data.roster ?? [];
  const queue = data.queue ?? [];
  const locked = data.room?.guestControlLocked === true;

  return (
    <main className="min-h-dvh bg-graphite text-ink">
      <header className="sticky top-0 z-40 border-b border-line bg-graphite/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-media bg-signal-fill text-white">
              <MicrophoneStageIcon size={20} weight="fill" aria-hidden="true" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">encore</span>
            <Chip tone="signal">{code}</Chip>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={locked ? <LockSimpleOpenIcon size={16} weight="duotone" /> : <LockSimpleIcon size={16} weight="duotone" />}
              onClick={() => void runCommand(locked ? 'unlock' : 'lock')}
            >
              {locked ? 'Unlock controls' : 'Lock controls'}
            </Button>
          </div>
        </div>
        {locked ? <LockBanner text="Guest controls are locked" /> : null}
      </header>

      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <YouTubePlayer
            playback={data.playback}
            mode={viewMode}
            onModeChange={setViewMode}
            onEnded={() => { void runPlayback('next'); }}
            onProgress={(seconds) => {
              void reportPlaybackPosition(api, roomId, seconds).catch(() => undefined);
            }}
            playerFactory={youtubePlayerFactory}
          />

          <Panel title="Playback" icon={<MusicNoteIcon size={18} weight="duotone" />}>
            <PlaybackControls
              roomId={roomId}
              playback={data.playback}
              shape="bar"
              onChanged={() => { void refresh(); }}
            />
          </Panel>

          <QueueList
            queue={queue}
            onRemove={(songId) => {
              void removeSong(api, roomId, songId).then(() => refresh()).catch(() => undefined);
            }}
            canRemove={() => true}
          />
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title="Invite your singers" icon={<QrCodeIcon size={18} weight="duotone" />}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="w-[11rem] shrink-0 rounded-media bg-white p-2.5" aria-label="QR code for joining this room" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <div className="min-w-0">
                <p className="font-mono text-lg tracking-[0.1em] text-signal">{groupCode(code)}</p>
                <p className="mt-1 break-all text-[0.8125rem] text-ink-3">{joinUrl}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  icon={<CopyIcon size={16} weight="regular" />}
                  onClick={() => void copyJoinLink()}
                >
                  {copied ? 'Link copied' : 'Copy link'}
                </Button>
              </div>
            </div>
          </Panel>

          <ParticipantRoster roster={roster} />

          <Panel title="Add a song as host" icon={<MusicNoteIcon size={18} weight="duotone" />}>
            <SongSearch roomId={roomId} onAdded={() => { void refresh(); }} />
            <div className="mt-4 border-t border-line pt-4">
              <PasteSongForm roomId={roomId} onAdded={() => { void refresh(); }} />
            </div>
          </Panel>

          <Panel title="Host controls" icon={<LockKeyIcon size={18} weight="duotone" />}>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<LockSimpleIcon size={16} weight="duotone" />} onClick={() => void runCommand('lock')}>
                Lock
              </Button>
              <Button variant="secondary" size="sm" icon={<TrashIcon size={16} weight="duotone" />} onClick={() => void runCommand('clear_queue')}>
                Clear queue
              </Button>
              <Button variant="danger" size="sm" icon={<PowerIcon size={16} weight="duotone" />} onClick={() => void runCommand('end')}>
                End room
              </Button>
            </div>
            {commandError === null ? null : (
              <p role="alert" className="mt-3 rounded-media border-l-2 border-danger bg-danger/10 px-3 py-2 text-[0.8125rem] text-danger">{commandError}</p>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  );
}
```

- [x] **Step 5: Run the host and player tests**

Run: `npx vitest run tests/unit/hostRoomPage.test.tsx tests/unit/youtubePlayer.test.tsx`
Expected: PASS with no test changes.

- [x] **Step 6: Commit**

```bash
git add src/app/HostRoomPage.tsx src/features/playback/YouTubePlayer.tsx tests/unit/hostRoomPage.test.tsx
git commit -m "feat: rebuild the host console on the console primitives"
```

---

### Task 7: The verification pass

**Files:**
- Modify: any file that the verification pass finds broken.

**Interfaces:**
- Consumes: every screen from Tasks 3 to 6.
- Produces: screenshots and a clean build.

- [x] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS with no failing test.

- [x] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit` then `npm run build`
Expected: both pass with no error.

- [x] **Step 3: Start the local stack and the dev server**

Run the Supabase stack in the background:

```bash
npx supabase start
```

Then start the dev server:

```bash
npm run dev
```

- [x] **Step 4: Capture the screens**

Use the Playwright MCP browser tools against the dev server. Open these routes and capture a screenshot at 1440 by 900 and at 390 by 844:

| Route | What to check |
|---|---|
| `/` | The headline fits in two lines, both action cards sit side by side, the hero photograph carries the cobalt wash, the step cards read as icons with words |
| `/join/ABCDEFGHJKMNPQRS` | The card centers, the room code shows in mono, the button carries the key icon |
| `/room/<roomId>` | The sticky header, the now playing card, the queue rows, the fixed transport dock at the bottom of the phone view |
| `/room/<roomId>/host` | The player, the right rail with the QR card, the roster and the host controls, the transport bar |

Create a room through the home screen to get a real room id, then open the guest and host routes with it.

- [x] **Step 5: Check the details**

For every screenshot check:
- No horizontal overflow at 390 pixels wide.
- Every icon only control shows a tooltip on hover and announces a name.
- Body text and button labels pass the contrast check.
- The accent color is the same cobalt on every screen.
- No serif type remains anywhere.
- The queue rows show the thumbnail, the title, the attribution, the vote count and the remove control.

- [x] **Step 6: Fix what the pass found**

Change the smallest file that holds the problem, then re-run `npm test`, `npx tsc --noEmit` and `npm run build`, then re-capture the affected screenshot.

- [x] **Step 7: Commit the fixes**

```bash
git add -A
git commit -m "fix: correct the console layout after the visual pass"
```
