# Racehorse mobile landscape redesign — master plan

**Status:** final architecture freeze, planning only. No production UI has been changed. This package records the September 25, 2026 mobile baseline and pre-implementation contracts. Read `REFERENCE_CONFORMANCE_SPECS.md`, `ASSET_SELECTION_MANIFEST.md`, `FIXTURE_AND_CSS_FREEZE.md`, `PRECHANGE_VALIDATION_AND_PERFORMANCE.md`, and `PR_1_2_3_CONTRACTS.md` before PR 1.

## Product decision

Treat this as a responsive platform redesign with four shell families and one shared navigation model, not seven screenshot implementations:

1. **Hub shell** — Home / Today’s Race, Multiplayer hub/lobby, Single Player, Tournament hub, Learn hub, Social feed. Persistent brand header and a compact five-item bottom navigation at phone widths. Home sits outside the five primary areas and has no selected tab. Feature content is composed per page within a shared viewport and safe-area contract.
2. **Immersive/Focused Content shell** — Daily Fritz, tournament bracket/result, social detail, profile/statistics, Learn article/lesson, Fritz/Ghost setup when task focus requires it, and focused Multiplayer sub-flows. Contextual back header and focused content; phone primary tabs are absent.
3. **Gameplay shell** — bot, Ghost, Daily Fritz, Learn guided game, tournament, and multiplayer matches share a match viewport/HUD contract and board/hand control system. No hub bottom tab bar. A visible, deliberate exit action opens a confirmable route back to the owning context.
4. **Utility/modal shell** — account/profile menu, auth, settings, result/review, invitations, and confirmation dialogs. Dialogs have their own bounded content scrolling and focus/back behavior; they do not create a competing page navigation system.

The exact shell selector belongs to route/surface metadata, not CSS class inference or duplicated page-level nav. Preserve existing domain routes and state owners; shell work must not migrate game rules, realtime transport, or server-backed state.

## Findings at a glance

- The application is a React single-page app whose route state is held in `client/src/routing/useAppRouteState.ts`, resolved by `appRoutePath.ts`, rendered through `AppRoutes.tsx` and route-family modules. It mirrors app modes to the History API rather than using route elements for every page.
- A five-area tab model exists in `components/nav/appPrimaryTabs.ts`: Multiplayer, Single Player, Tournament, Social, Learn. It remains the source of truth for phone bottom tabs and wide desktop links. Home `/` is a command center outside those areas: it shows the phone bar with no selected tab. The brand/logo is the Home affordance where shell context allows.
- The outer `.app` is a `100dvh` clipped flex column; `html/body/#root` also hide horizontal overflow and body hides all overflow. A screen that is not explicitly a flex participant or owns a scroll region can silently clip. Several screens satisfy containment, while Home, Daily Fritz, Tournament, and Learn show visible truncation at 844×390.
- Responsive signals conflict: CSS custom media and `docs/breakpoints.md` define `--phone` by width ≤768 and `--desk` by width ≥769, while Tailwind `desk:` uses width ≥769 **and** height ≥600. At 844×390 the Tailwind shell behaves phone-like, but `@media (--phone)` page rules do not run. This hybrid is a direct contributor to the observed clipping.
- Six requested landscape viewports were rendered against seven entry surfaces (42 captures) with zero uncaught page errors. At all six, document dimensions are clamped to the viewport, but that is not proof of reachability: screenshots at canonical 844×390 show major page content clipped by the fixed shell/tab chrome. See `baseline/` and `BASELINE_SUMMARY.md`.
- References share a landscape phone composition and a dark geometric brand system, but differ in whether desktop-like top tabs and bottom tabs are both present, whether there is a back button, and whether identity stats exist. Treat this as generation variation; retain a compact identity header and choose one primary-navigation location at a time.
- Existing Fritz/robot, puzzle, home, Learn, Ghost, and board art is substantial and mostly available as both WebP and PNG. It is not equivalent to all mockup compositions; new isolated assets are required for some Learn/compete/social/Ghost match placements. Exact gaps are in `ASSET_GAP_MATRIX.md`.
- Gameplay is already a separate viewport-locked layout family with camera fitting (`components/board/useBoardCamera.ts` and `boardLayout.ts`) and a horizontal hand tray. It needs an explicit mobile allocation and touch validation rather than inheritance from hub card layouts.

## Current baseline evidence

Canonical viewport is 844×390 CSS px. Current screenshots are in `baseline/` for Today’s Race (`/`), Single Player (`/solo`), Tournament (`/tournament`), Learn (`/learn`), Social (`/social`), Daily Fritz (`/daily-fritz`), and Ghost setup (`/solo/ghost`). Full six-size captures and DOM measurement JSON were generated outside the repository at `/private/tmp/racehorse-mobile-baseline/` during this audit.

At canonical size, the usual header is ~56 px and bottom tabs ~60 px, leaving ~274 px before internal route padding. Today’s Race shows only its header and upper portion of the first feature card; Solo shows title and top of one oversized art card; Daily Fritz shows the title and a thin portion of content; Tournament shows title and the top of trophy artwork; Learn shows title and tops of two cards; Social shows its intro/actions and only a sliver of following content. Ghost setup places the five-item primary tab bar immediately below the brand header at y=57–117 instead of at the bottom edge, then shows only the start of its opponent panel. No document horizontal overflow was observed in the capture set; body-level clipping hides the overrun instead.

This baseline is anonymous guest state. Signed-in profile/friends values, tournament registration states, result overlays, leaderboard rows, and actual Ghost match need fixture-backed visual states in the future screenshot harness. The current capture of Ghost is setup; a gameplay baseline is covered by existing `client/e2e/ghost-play-to-completion.spec.ts` only when a valid auth fixture exists, and must be separately captured at landscape sizes.

## Architectural recommendation

- Keep route/domain ownership. Add a small typed **surface presentation descriptor** at the route composition boundary: shell family, whether primary nav is visible, contextual title/back target, safe-area policy, scroll policy, and owning mode. Do not infer route identity from CSS or add a second router.
- Extract the visual shell responsibilities only after a first vertical slice proves the contract. Global header/account state should become one app-shell concern with route-provided context, not one independently mounted `GlobalNav` per route. Current route screens each mount their own nav; this resets local state and duplicates auth/friend fetch/subscription work on route changes.
- Use shared primitives for spacing/type/surfaces, header/account cluster, bottom nav, page frame, card/art frame, CTA, stats, and input states. Keep page composition and domain-specific loading/empty/error states local.
- Make width, height, and available container size all first-class. Use named width breakpoints only for structural navigation changes; use height bands and container dimensions to compress secondary content. Do not scale the whole UI.
- Preserve desktop composition above the responsive thresholds, and validate it against screenshot fixtures before merging each route family.
- Ship each route-family change in an independently reversible PR. Prefer direct breakpoint replacement in the existing route (desktop unchanged above the breakpoint) over flags: no second route/state model is justified. Use a feature flag only if a shell migration must be tested against production user cohorts without an immediate global switch.

## Ratified product decisions and readiness

1. Hubs, Social, account/settings, results, profiles and lessons support portrait. Active gameplay is landscape-preferred; a rotate recommendation appears only below measured board/hand thresholds, and rotation preserves match state. No global orientation lock. PR 7 replaces the existing portrait hard gate; PR 8 reconciles `manifest.json` orientation after device verification.
2. The five phone bottom tabs are **Multiplayer, Single Player, Tournament, Social, Learn**, matching the existing product hierarchy. Home/Today’s Race shows that bar with no active tab. Focused sub-flows and gameplay have no bottom primary bar; desktop retains horizontal navigation. No phone top and bottom primary nav simultaneously.
3. At signed-in 844×390, hub header displays rating, Friends and avatar. As room shrinks, Friends then rating collapse; avatar/account remains. Signed-out has no blank stat boxes.
4. Shell families are Hub, Immersive/Focused Content, Gameplay, Utility/Modal. Route/domain/state ownership remains unchanged; no universal page renderer.
5. Readiness is **GO for PR 0/PR 1 after review**, subject to the baseline test-runner issue documented in `PRECHANGE_VALIDATION_AND_PERFORMANCE.md`. The issue does not force shell redesign; PR 0 can migrate that script to the proven `tsx` loader or keep the direct command as the required behavior gate. PR 3 Solo visual approval is a hard gate before Learn/Tournament/Social migration.

### Exact gate before PR 1

| Required condition | Status / evidence |
|---|---|
| Ratified orientation, nav, identity and four shells | **Met** here and in `NAVIGATION_AND_SHELL_ARCHITECTURE.md`; Multiplayer remains phone tab 1, while Home shows no selected primary tab. |
| Seven conformance targets and acceptance tiers | **Met** in `REFERENCE_CONFORMANCE_SPECS.md`; derived crop previews in `reference-specs/`. |
| Home and Solo asset selection | **Met** in `ASSET_SELECTION_MANIFEST.md`; heavy Home alternatives rejected. |
| Home and Solo fixture approach | **Met as contract** in `FIXTURE_AND_CSS_FREEZE.md`; PR 0 must implement the guarded dev fixture seam before screenshot goldens. |
| One breakpoint policy and CSS deletion map | **Met** in `FIXTURE_AND_CSS_FREEZE.md`; PR 1 code will consume central query policy. |
| Current validation and performance baseline | **Met** in `PRECHANGE_VALIDATION_AND_PERFORMANCE.md`; one legacy npm behavior-script runner fails before assertions, while all equivalent test files pass under `node --import tsx`. |
| PR 1/2/3 contracts and dependency graph | **Met** in `PR_1_2_3_CONTRACTS.md` and `IMPLEMENTATION_ROADMAP_AND_RISKS.md`. |
| Fundamental shell/navigation/responsive unknown capable of rewrite | **None remaining.** Remaining art gaps belong to later Learn/Tournament pages; performance target gap and script runner are tracked execution issues. |

**GO means implementation may begin with PR 0 and then PR 1 after owner authorization; this document itself does not authorize production UI work.** PR 0’s fixture seam and PR 1’s shell are the first reviewable deliverables. No broad hub migration proceeds before PR 3 visual approval.

## Related documents

- [Approved source mockups](references/README.md)

- [Current architecture audit](CURRENT_ARCHITECTURE_AUDIT.md)
- [Reference design system](REFERENCE_DESIGN_SYSTEM.md)
- [Screen matrix](SCREEN_MATRIX.md)
- [Navigation and shell architecture](NAVIGATION_AND_SHELL_ARCHITECTURE.md)
- [Responsive strategy](RESPONSIVE_STRATEGY.md)
- [Asset gap matrix](ASSET_GAP_MATRIX.md)
- [Gameplay mobile specification](GAMEPLAY_MOBILE_SPEC.md)
- [App readiness and visual QA](APP_READINESS_AND_VISUAL_QA.md)
- [Implementation roadmap and risks](IMPLEMENTATION_ROADMAP_AND_RISKS.md)
- [Reference conformance specs](REFERENCE_CONFORMANCE_SPECS.md)
- [Authoritative asset selection](ASSET_SELECTION_MANIFEST.md)
- [Fixture, CSS and breakpoint freeze](FIXTURE_AND_CSS_FREEZE.md)
- [Pre-change validation and performance](PRECHANGE_VALIDATION_AND_PERFORMANCE.md)
- [PR 1/2/3 contracts](PR_1_2_3_CONTRACTS.md)
