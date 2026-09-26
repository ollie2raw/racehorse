# Mobile landscape current-state baseline

**Captured:** September 25, 2026, local Vite client and local development server, Chromium headless, DPR 1. The requested viewports were all exercised: 667×375, 740×360, 844×390, 852×393, 915×412 and 932×430 CSS px. Each route started in anonymous guest state with welcome dismissed. Seven route entry surfaces × six sizes = 42 viewport captures, plus one active Fritz match at 844×390.

Canonical screenshots are stored beside this report. The other 35 route captures and full measurements were kept in `/private/tmp/racehorse-mobile-baseline/` during the audit. This is forensic evidence, not a visual-test baseline for future CI: fixtures, stability, and approval are still needed.

## 844×390 viewport findings

`document.scrollWidth` and `scrollHeight` equal viewport dimensions on each page. The app body is clipped, so page sections can exist below the viewport without changing document dimensions. Element bounds below are measured in CSS pixels from the top of the viewport:

| Surface | Measured bounds / visible affordance | Actual failure |
|---|---|---|
| Today’s Race | title y=67–99. Daily Fritz CTA y=277–327, just above bottom bar at y=330. Puzzle CTA y=557–607. | second feature CTA and streak/week strip are below fold and unreachable through document scrolling; only first feature card reaches its CTA. |
| Single Player | title y=124–182. Card Play CTA y=507–557. Bottom tab starts y=330. | cards are in a tall stack/large fixed natural sizes; no card CTA appears in viewport, content root clips. At 932 wide the CTA remains y=507. |
| Tournament | title y=145–183; Register y=839–878. | the first feature/trophy panel is only partly visible by the fold; tournament schedule/countdown and action are far below viewport. |
| Learn | title y=124–182; first two CTA positions y=552–602; following CTA y=933–983. | 2×2 card stack begins below title but is clipped by bottom tabs at y=330; no card CTA is visible. At width 915+, first row action still y=552. |
| Social | title y=118–156; Find Players y=201–235; View All Friends y=379–423. | first action is visible, second action overlaps/crosses the bottom tab bar which starts y=330; activity content follows below. At widths ≥915, a distinct compact breakpoint improves title/action bounds, but social follow-on content remains a scroll/reachability concern. |
| Daily Fritz | title y=177–215; primary “Play Today’s Set” y=1730–1778. | title/context is visible but action/progression is ~1,730 px down a clipped screen; no intended scroll region connects it to the user. |
| Ghost setup | page mode title y=218–254; Play Ghost y=412–460; a “Back to Home” action y=470–499. | the five-item primary tab bar appears as a second chrome row at y=57–117 under the brand header instead of at the bottom edge; focused setup also should not expose hub primary navigation. Primary play action and back affordance are below the 390px viewport. The setup captures signed-out guest state, so play is not actually enabled. |
| Core gameplay | 7-tile hand and central board fit 844×390; top HUD and controls render. See `core-gameplay-844x390.png`. | board/HUD fits visually at first hand but player labels are terse, main interaction controls are compact (zoom/audio/home icons have small visual boxes), score race-track signature is not obvious, and target-size/selected/legal-move touch behavior needs measured audit. This is standard Fritz mode, not authenticated Ghost gameplay. |

## Viewport pattern across all 42 hub captures

- All documents report no horizontal overflow and no uncaught page errors in the anonymous route captures.
- Home first card CTA was at y=277 in all six widths; second at y=557. Width changes did not recompose the captured content.
- Solo primary CTA stayed at y=507 across widths; 915/932 showed a slightly different number of CTA controls, but the first remains below the viewport.
- Tournament registration action remained ~y=839 at all widths.
- Learn first-row CTAs ranged y=519–552, still below all viewport bottoms; the card stack does not scale down enough with height.
- Daily Fritz CTA remained y=1730 at all widths. This is a high-confidence structural height/reachability bug, not a breakpoint edge case.
- Social has a meaningful local behavior change at 915px (top content shifts from y≈118 to y≈18, primary action from y≈201 to y≈101), indicating the ≤900 “below-wide” treatment; at 667–852 it still collides with bottom navigation.
- Ghost setup stays vertically over-budget; its primary tab bar is placed immediately under the brand header. Its play CTA remains ~y=412–416.

These numbers are a starting point. Re-capture with deterministic signed-in and server fixtures, full browser chrome/device safe areas, and a stable match-state harness before using images as pass/fail comparisons.
