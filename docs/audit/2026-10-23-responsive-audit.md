# Responsive Design Audit

Date: 2026-10-23
Scope: the public, guest, and host screens at 320, 390, 768, 1024, and 1440px.
Verdict: **Pass for layout overflow, with warnings for host touch controls.**

## Summary

Ten routes were checked at five widths: home, join, scan, host discover, host queue,
host settings, host stage, host party, the guest room, and guest search. No route
produced horizontal document overflow. The intentional offenders are the YouTube
iframe, decorative images, and the host section strip, which scrolls inside
`overflow-x-auto`.

Two host-control warnings remain: the range sliders have no visible thumb and only a
4–6px hit area, and several host navigation/icon controls are 32–40px rather than the
project's 44px floor.

## Evidence

- Routes: `/`, `/join`, `/scan`, `/room/:id/host`, `/queue`, `/settings`, `/stage`,
  `/party`, `/room/:id`, `/room/:id/search`.
- Viewports: 320×568, 390×844, 768×1024, 1024×900, 1440×1000.
- Every route returned `scrollWidth - clientWidth = 0`.
- `min-h-dvh` is used throughout; no `100vh` mobile-height issue was found.
- Screenshot: `docs/audit/assets/range-slider.png`.

## Findings

### Major, open: the host range sliders have no visible thumb

- Evidence: `input[type=range]` uses `appearance-none`; the computed
  `::-webkit-slider-thumb` is the full 220×6px track with a transparent background,
  and the input itself is only 4–6px high.
- Affected: host stage and party playback position and volume.
- Impact: no draggable affordance, and a very small touch target for seeking or
  changing volume.
- Recommended fix: a shared range control with a 24–44px hit area and a visible
  14–16px signal-colored thumb; keep the thin track visually inside it.

### Minor, open: host navigation and icon controls are 32–40px

- Evidence: host section links are 36px high, host icon buttons are 32×32, and the
  scan/join controls are 25–36px high. These meet WCAG 2.5.8's 24px minimum but not
  the app's earlier 44px mobile floor.
- Affected: host header/section navigation and transport icon buttons.
- Recommended fix: add vertical hit padding or expand the targets to 44px where the
  layout allows; do not shrink the visual icons.

### Info, acceptable: clipped horizontal strip and iframes

- The 320px "Recent" host link extends beyond the viewport but lives inside an
  `overflow-x-auto` section strip; the document does not overflow.
- The YouTube iframe and party image extend to their containers by design.

## Not Covered

- A physical-phone camera run.
- Screen-reader and keyboard-only traversal of every new page.
- Visual comparison to Figma; no design source is present in the repository.

## Recommended Next Steps

1. Build the shared range control with a visible thumb and 44px hit area.
2. Decide the host nav/icon 44px target treatment.
3. Add the responsive route sweep to the browser suite once the preview server is
   reliable.
