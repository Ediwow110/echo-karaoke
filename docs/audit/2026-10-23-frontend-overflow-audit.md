# Frontend Overflow and Motion Audit

Date: 2026-10-23
Scope: switch geometry and motion, page-level overflow on the host and public
screens, text scaling, and switch accessibility.
Verdict: **Pass with warnings**. The reported overflow is fixed; the design source
needed for a full fidelity verdict is not in the repository.

## Summary

The switch thumb had no horizontal anchor. Its absolute static position resolved to
`left: 22px` inside the 44px button, and the checked `translate-x-6` moved it to 46px,
18px outside the track. The state label also changed width between `ON` and `OFF`,
shifting the label group by 4.2px. The thumb now has `left-0`, the state label has a
fixed 24px box, and a browser regression test guards both settled and mid-transition
containment.

## Evidence Reviewed

- Design contract: no `DESIGN.md`, `SCREEN_SPEC.md`, or Figma export is present. The
  audit used the color and motion tokens in `src/styles.css` and the rendered UI.
- Source visual truth: unavailable; the verdict is an implementation-quality verdict,
  not a Figma fidelity approval.
- Rendered implementation: production `https://echo-karaoke-mocha.vercel.app`, host
  settings at 1440, 1024, 768, 390, and 320px before and after the fix; local Vite
  build for the fixed source.
- Automation: `tests/e2e/switch.spec.ts` checks containment, the 44px target, and a
  minimum 3:1 thumb/track contrast in both states; it passed against the local build
  and the measurements were repeated on the live host settings screen.
- Screenshots: `docs/audit/assets/switch-before.png`, `switch-after.png`,
  `switch-mid.png`, `switch-target-focus.png`, and `switch-off-contrast.png`.

## Findings

### Major, fixed: the checked switch thumb overflows the track

- Evidence: computed thumb `left: 22px`; checked thumb inset `left 46px / right -18px`
  in the production build at every tested viewport. The track is 44px wide and the
  thumb 16px.
- Cause: an absolutely positioned thumb with only `top` set. The button's centered
  text alignment supplied a 22px static `left`; `translate-x-6` added 24px.
- Fix: `left-0` on the thumb. Settled insets are now `24/4` checked and `4/24`
  unchecked; every sampled mid-transition frame stays inside the track.
- Impact: the control looked broken and the thumb could overlap neighboring content.
- Verification: browser test at both states plus a mid-transition sample; local
  screenshots; 200% root text size keeps the thumb contained. After deployment on
  2026-10-23, production host settings measured checked `24/4` and unchecked `4/24`
  at 1440, 1024, 768, 390, and 320 with every frame contained.

### Minor, fixed: the ON/OFF label shifts the group

- Evidence: `ON` measured 15.23px and `OFF` 19.45px; the group origin shifted 4.2px
  on toggle.
- Fix: a fixed `w-6` right-aligned state box. The label now stays 24px wide in both
  states and at 200% text size.
- Impact: small horizontal jitter next to the switch during the state change.

### Minor, fixed: the switch hit area is now 44x44px

- The visual track remains 44x24, but the focusable button is 44x44 with the track at
  the top. The target meets the app's 44px mobile floor and WCAG 2.5.8.
- The focus ring surrounds the 44px target; the visual track is unchanged.
- The state label uses a 24px line box so ON/OFF stays aligned with the track.

### Minor, fixed: OFF-state thumb contrast

- OFF thumb is now `ink-2` (`#99959f`) against the `line-strong` track (`#3b3846`):
  **3.89:1**. ON remains **8.66:1** (dark thumb on the lavender fill).
- The token comes from the existing palette; no new color was introduced.
- The track against the card surface is 1.56:1, but the adjacent ON/OFF label
  provides a non-color state indicator. A stricter track boundary would require a
  design-system decision on `line-strong`.

## Page-Level Checks

- Host settings: no horizontal document overflow at 1440, 1024, 768, 390, or 320px.
- Home: no horizontal document overflow at 1440, 1024, 390, or 320px.
- The YouTube iframe extends to its container by design. The 320px "Recent" link
  extends inside a clipped horizontal strip, while the document itself does not
  scroll horizontally. Both are acceptable.
- No other absolute child with only a `top` anchor was found; other overlays set
  `left`, `right`, or a centering translate.

## Test Gap

`tests/e2e/switch.spec.ts` is the new regression gate, but the CI workflow does not
run Playwright. The browser suite needs `vercel dev`; the current CI jobs cover type,
unit, database, and the operation integration suite only.

## Deployment

The overflow fix is deployed at `https://echo-karaoke-mocha.vercel.app` (CI run
39875426170). The accessibility follow-up is also deployed (CI run 39877317874 passed
verify, database, and integration). Live host-settings checks at 1440 and 390px
measure a 44x44 target, a 44x24 track, 4px thumb insets in both states, contrast
8.66:1 ON and 3.89:1 OFF, and both switches toggled successfully.

## Recommended Next Steps

1. Add the browser suite to CI once a reliable preview server is chosen.
2. If a stricter track-boundary contrast is required, change `line-strong` at the
   token level rather than overriding it in the component.
