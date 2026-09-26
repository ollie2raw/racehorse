# First three implementation contracts

These contracts are frozen before code. PR 0 lands the fixture and asset setup in `IMPLEMENTATION_ROADMAP_AND_RISKS.md`; the work below begins only after PR 0 is reviewable. No implementation is in this document.

## PR 1 — shell contract

**Purpose.** Establish a single route presentation policy without visually rebuilding any page. Preserve `App.tsx` runtime, `useAppRouteState.ts`, route-family modules, game state and existing URL behavior.

**Surface metadata.** Add one typed descriptor resolved at the `AppRoutes.tsx`/route-family boundary, with shape equivalent to:

```ts
type SurfacePresentation = {
  shell: 'hub' | 'focused' | 'gameplay' | 'utility';
  primaryArea: 'multiplayer' | 'solo' | 'tournament' | 'social' | 'learn' | null;
  chrome: 'hub-tabs' | 'contextual' | 'none';
  parentMode?: AppMode;            // explicit back fallback, never guessed as Home
  scroll: 'bounded-page' | 'named-content' | 'none';
  account: 'compact' | 'avatar' | 'hidden';
};
```

Descriptor is based on mode/route plus active match state where current routing uses transient root path. It is presentation metadata only: no new router, path or duplicate domain state. Hub descriptors: `home`, `multiplayer`, `singlePlayerHub`, `tournament`, `feed`, `learn`. Home is `{ primaryArea: null, chrome: 'hub-tabs' }`; Multiplayer hub/lobby has `primaryArea: 'multiplayer'`. Focused: `dailyFritz`, bracket/result, profile/detail, lesson/article, Ghost/Fritz setup and Multiplayer sub-flows where task focus applies, leaderboard. Gameplay: all active matches. Utility: auth/settings/modal/result overlays as appropriate. Ambiguous modes get an explicit map entry and test; no CSS inference from URL or heading.

**Chrome ownership.** One app-level presentation provider owns descriptor, breakpoint, safe-area variables and account data. Existing `GlobalNav` call sites can remain as presentation adapters during migration, but their account fetch/cache and primary tab visibility must consume the provider; no independent per-page nav policy or second primary bar. `AppBottomTabBar` and desktop `GlobalNav` use the existing Multiplayer/Solo/Tournament/Social/Learn area order. On Home, no tab is active and none has `aria-current`; on `/multiplayer`, Multiplayer is active for the hub/lobby. Hub phone header contains brand and identity, **no horizontal primary links**; the brand/logo is the Home affordance where context allows. Focused header gets contextual back and no bottom tabs; gameplay no global chrome. On back: use explicit `parentMode` when directly loaded, otherwise normal browser history; gameplay exit follows existing confirmation/state owner.

**Identity.** At signed-in 844×390, render rating, Friends count and avatar/account in one compact header cluster. Hide Friends first, rating second on measured space pressure; avatar never disappears outside gameplay. Signed-out shows Sign In/avatar action only, no empty stat boxes. Move friend/profile fetching to shared provider or retain one shared cache service; no extra Supabase calls per route mount. Existing sign-out remains `App.tsx` callback. Account menu anchor/focus and Escape behavior remain.

**Safe area and responsive.** `.app` remains viewport height/overflow owner; it reads all four `env(safe-area-inset-*)` once into CSS variables. Compact Hub shell applies horizontal safe inset to content and top inset to header; bottom tab owns bottom inset. Focused shell applies top/horizontal safe inset, and its bounded content owns bottom inset. Gameplay shell owns all four with no extra child padding. Portal backdrop covers viewport; modal content uses safe max bounds. `viewport-fit=cover` is **already present** in `client/index.html`; do not add duplicate metadata. Replace width-only `--desk` with the exact 769×600 wide-shell policy; import central policy into Tailwind and PostCSS custom-media source; migrate shell/nav uses of `--phone`, `PHONE_TAB_MAX_WIDTH_PX` and inline `rh-mobile-chrome.css` query. `--below-wide` stays content-only. Add invariant test comparing compiled conditions.

**Expected source areas.** `client/src/App.tsx`, `AppRoutes.tsx`, `appRouteTypes.ts` or a small new route-presentation module, `routing/appRoutePath.ts` only if metadata needs an existing mode mapping; `components/GlobalNav.tsx`, `components/nav/appPrimaryTabs.ts`, `components/nav/AppBottomTabBar.tsx/.css`, `styles/rh-mobile-chrome.css`, `styles/tokens.css`, `App.css`, `tailwind.config.js`, `postcss.config.js`, `client/config/responsivePolicy.js`, focused/Hub wrapper adapters and their tests. Avoid creating a universal page renderer. If touched route screens need only remove duplicate chrome props/imports, do so; page content/art remains intact.

**Tests/acceptance.** Typed metadata unit table covers all modes, including Home `primaryArea:null` with visible hub tabs and Multiplayer hub selection; route history/deep link/back tests; phone 844×390 and 390×844 assertion of one primary nav and five exact areas; 667/740/932 phone shell classification; signed-in identity cluster and collapse order; signed-out no placeholders; safe-inset emulation; account menu focus/Escape; focused/gameplay no bottom nav; desktop 1280×720 and 1440×900 screenshot parity and horizontal tabs unchanged. Existing mobile-390 tests expecting Daily Fritz/setup bottom tabs or portrait hard gate are intentionally updated only where policy changes; no broad screenshot rebaselining. Pass typecheck, lint, architecture, build and relevant E2E.

**Non-goals/rollback.** No Home/Solo card redesign, no new artwork, no game logic, no route-path rewrite, no manifest orientation change yet (PR 8 after device QA), no global portrait lock. Revert shell/provider/config/nav changes as one bounded PR if chrome contract fails; route content stays on original implementation.

## PR 2 — Today’s Race architecture vertical slice

**Purpose/composition.** Apply Hub content contract to `HomeScreen.tsx` only. At 844×390: 50–56 header, 43–51 title, two 165–175 px equal panels, 42–50 px streak strip, 52–58 px tabs; 10–14 px panel gap and 12–18 px outer gutter. Both cards’ CTAs align and remain ≥44 px. The header keeps brand left, open center space and identity/account right; it adds no Multiplayer action. Home shows all five bottom tabs without a selected area. Card internals use CSS grid/text+art frame and bounded panel height; `minmax(0,1fr)` prevents copy overflow. Home remains the identity anchor: matte navy, gold Daily Fritz, blue Daily Puzzle, green streak, thin borders, local glow. No desktop geometry changes above wide-shell query.

**Shared primitives allowed.** Extract only semantic `HubPageFrame`, `FeaturePanel` surface frame, `ArtworkFrame`, `MobileCTA` and `StatStrip` if Home needs them **and** they have a known Solo/Learn use. API is slot/content based (`accent`, `art`, `action`, `status`), not a data-driven universal card renderer. Home controls action/state rendering. Avoid forcing a generic panel over streak behavior.

**Assets and fixtures.** Use selected `newHOMEdailyfritz.webp` and `homefinalpuzzle.webp` (see manifest), not heavy alternates. Fix focal crop with a 667 comparison. Fixture IDs `home/not-played` and `home/completed` use frozen date, deterministic auth/profile/friends, `/api/home/daily-summary`, `/api/daily-fritz/today` and other `useHomeCommandCenter` sources; no screenshot fake values. CTA clicks navigate to the actual Daily Fritz/Puzzle routes; completion state offers real results path.

**Acceptance.** Human review of T1 conformance at 844×390 against `(1)` with hardware ignored; Playwright canonical screenshots both states; geometry at all six widths (667×375, 740×360, 844×390, 852×393, 915×412, 932×430); 390×844 portrait reflow; both CTAs and streak reachable, no document horizontal overflow, named scroll only if needed; account/tabs safe; desktop 1280×720/1440×900 screenshots materially unchanged; image transfer ≤350 KB for two visible Home assets and no new long task >50 ms from decorative work. Existing routing/status tests pass.

**Files/non-goals/rollback.** `HomeScreen.tsx`, `RacehorseHomeArt.css`, `styles/home-hub.css`, Home-specific primitive files/CSS, Home fixtures and screenshots. Remove old fixed 268px card content and conflicting Home `@media (--phone)`/`desk:` layers rather than appending overrides. No Solo/Learn/Tournament changes, no Homepage data model changes. Revert Home composition/fixture screenshot commit; PR 1 shell remains.

## PR 3 — Single Player visual-fidelity vertical slice

**Purpose/composition.** Prove the shell can reproduce `(7)` at approved quality before broad hubs. `SinglePlayerHubScreen.tsx` keeps its modes, stats hook, Journey gating and route callbacks. At 844×390: centered title/subtitle 50–58 high, three equal ~260–267×211–221 cards with 10–14 gutters/gaps, text and approved character art in each, compact two-stat row, one full-width ≥44 CTA at aligned bottom. Gold Fritz, blue Ghost, purple Journey accents follow source design; Play vs Fritz matte treatment is the baseline. No additional nested borders.

**Artwork/crop.** `fritzwave1.webp` and `fritzghost2.webp` use transparent cutout positioning right/bottom with `object-fit:contain`; never apply `cover` to faces. `fritzjourney.webp` is framed right/bottom with focal face near 70% x. Test the actual 844 and 667 rendered card frames against `reference-specs/` previews and approved mockup. Stats remain live hook-derived, with deterministic empty/populated fixture responses. Mode titles, descriptions, stat labels/values and CTA text remain DOM text.

**Small width.** At 740×360, keep three columns only if text zone ≥142 px and 44 px CTA all pass. Otherwise use a horizontal snap rail with first card whole and next-card affordance; at 667×375 rail is expected. Preserve card order, keyboard scroll/focus and tab nav. Do not compress CTA or title to fit three cards. Portrait uses stacked or 1–2 column reflow inside named content scroll. At 844 signed-in account rating/Friends/avatar fit as shell contract requires.

**Tests/visual gate.** Fixture IDs `solo/empty`, `solo/populated`, `solo/journey-locked`; mock rating-history, Ghost profile and local progress, freeze week/date. Canonical screenshots at 844 and 667 plus six-size geometry, card actions/locks via pointer and keyboard, focus ring, art containment, contrast, no horizontal document overflow, desktop 1280×720/1440×900 parity. Human review must approve T1 composition, art focal regions, stats density, CTA baseline, type scale and restrained glow. **PR 4 Learn and PR 5 hub migration do not start until this gate passes.** Structural tests passing without visual approval is insufficient.

**Files/non-goals/rollback.** `SinglePlayerHubScreen.tsx`, `SinglePlayerModes.css`, narrowly proven shared card/art/CTA primitives, Solo fixtures/screenshots. Remove hard 268px content and obsolete inherited Home/phone overrides. Do not touch `LearnHome.tsx`/`learn.css`, bot/ghost game logic, scoring, Journey data or APIs. Revert Solo route presentation independently of PR 1/2.
