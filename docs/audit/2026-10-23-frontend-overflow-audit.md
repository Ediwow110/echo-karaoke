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
- Automation: `tests/e2e/switch.spec.ts` passed against the local build.
- Screenshots: `docs/audit/assets/switch-before.png`, `switch-after.png`, and
  `switch-mid.png`.

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

### Minor, open: the switch hit area is 44x24px

- The track is 44x24 and the button shares that box. It meets the WCAG 2.5.8 minimum
  of 24x24, but not the 44px touch-target floor used by the app's mobile tests.
- Recommendation: wrap the 24px track in a 44px-high transparent button, or add a
  vertical hit area, without changing the visual track.
- Owner: design decision; the visual size is unchanged in this fix.

### Needs design decision: OFF-state thumb contrast

- OFF thumb `#0a0a0d` against track `#3b3846` is **1.73:1**; ON is **8.66:1**;
  track against surface is 1.56:1.
- The adjacent ON/OFF text provides a state label, but the knob itself is low-contrast.
  Changing the token would alter the approved palette, so this was not changed without
  the Figma source.

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

The fix is deployed at `https://echo-karaoke-mocha.vercel.app` (CI run 39875426170
passed verify, database, and integration). The live host-settings switch was measured
at five widths after the deployment; all thumb insets are positive.

## Recommended Next Steps

1. Decide the 44px hit-area and OFF-contrast changes with the design source.
2. Add the browser suite to CI once a reliable preview server is chosen.
