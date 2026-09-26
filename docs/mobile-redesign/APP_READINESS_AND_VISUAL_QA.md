# App readiness, accessibility, performance and visual QA

## Web architecture that helps later packaging

### Must solve in this redesign

- Single safe-area owner for top/bottom/left/right; retain the existing `viewport-fit=cover` metadata and validate browser Safari/Chrome and notch/cutout geometry.
- Explicit route/history and back policy for modal stacks, detail routes, and active games. Current app mode `pushState` exists, but Fritz/Ghost trial match is intentionally root-path until it can hydrate. Deep links and history behavior must be defined before a WebView shell.
- On active match background/resume: preserve match session, reconnect, clear stale visual selection safely, show network state and revalidate state before interaction. Reconnect hooks exist; lifecycle behavior must be verified on phone.
- Touch-sized controls, page overscroll containment, accessible text selection policy, button semantics, focus restoration, viewport-constrained dialogs, stable scroll areas, and reduced motion.
- Route-level lazy loading and bounded art loading; no all-pages mega-bundle or simultaneous decoded hero imagery.
- Screen-reader labels for icon-only controls and game tile/placement actions; visible focus; WCAG contrast for small text.

Already present: `client/index.html` includes `viewport-fit=cover`, an app manifest, Apple touch icon, and iOS standalone/status-bar metadata. `client/public/manifest.json` sets `display: standalone` and currently `orientation: portrait`. `client/src/lib/supabase.ts` enables `persistSession` and `autoRefreshToken`; `useNetworkStatus.ts` observes browser `online`/`offline`; `App.tsx` composes the offline banner and multiplayer reconnect/socket state. Daily Fritz session persistence and standalone Fritz session hooks listen to `pagehide`. No service-worker registration was found. These are foundations to validate under installed/resumed browser state, not proof that cutout, generic lifecycle, and reconnect UX already satisfy native behavior.

### Can wait for native app packaging

- Native project/capacitor wrapper, store metadata/screenshots, signing, entitlement, native push, native in-app purchase, native orientation APIs and platform-specific system-bar styling.
- Native offline database/outbox beyond current graceful reconnect. Offline match rules are not implied by the current service model and should not be fabricated during a UI redesign.
- Native file/share APIs. The web share/download fallback can remain until a concrete product requirement.
- Full offline boot for account-dependent/social/tournament modes; define separately when app packaging scope is approved.

Do not set a global orientation lock. Recommend hubs, social, settings, results and learning articles support both orientations; active gameplay is landscape-preferred. In portrait gameplay, show an unobtrusive rotate suggestion only when actual board/hand layout violates a defined usability threshold. This preserves accessibility, tablet support and app switching while recognizing the reference target. On rotation, use measured container resize, preserve match state, recalculate camera and layout, avoid reload/reset, and announce only if a rotate prompt changes. Current `rotate-overlay.css` hides the game in portrait at ≤768px and `client/public/manifest.json` requests portrait orientation; this mismatch must be explicitly resolved before coding, and the proposed policy requires replacing the current hard game gate with a measured threshold.

## Safe-area ownership

`.app`/root app shell owns viewport sizing and reads all four inset values once. Hub header consumes top, Hub content consumes horizontal, and Hub bottom tabs consume bottom. Focused shell consumes top/horizontal and gives its bounded content the bottom inset. Gameplay shell owns all four because there is no app chrome. Modal portal/backdrop covers viewport, while modal content applies inset-aware max bounds. Child pages receive safe content bounds and must not add raw `env()` padding again. `client/index.html` already includes `viewport-fit=cover`; retain it. Test Dynamic Island/notched iPhone landscape, rounded corners, Android camera cutout (both orientations), Safari browser chrome and standalone/PWA. Values may be zero in browser tests; test with emulation and real devices.

## Accessibility contracts

- Landmark order: app header/navigation, main, optional secondary nav, footer/tab nav. Navigation is a `<nav>` with distinct accessible labels and real buttons/links.
- Selected tab is conveyed with `aria-current`, not color alone. All focus states remain clearly visible against dark background.
- Aim for 44×44 CSS pixel controls for primary actions and game controls. For compact controls, use padding/hit area; if not, document and test the WCAG spacing exemption.
- Minimum AA text contrast, especially 11–13px metadata, disabled copy, active/inactive tab labels and art scrims. Use text shadow only to aid image contrast, not replace a scrim.
- Respect `prefers-reduced-motion`; maintain nonanimated status change and selected/legal state. Do not auto-scroll/zoom without a user action.
- Use semantic button/link, native input/select where appropriate, keyboard tab/enter/space, escape to close, focus trap/return for modal and sheet. On-route back has explicit text/accessibility label.
- Use labels for rating, friends count, timer, score, boneyard, open ends, legal placements, selected domino, draw/pass. Announce state changes via purposeful `aria-live`, not every animation tick.

## Performance budget (proposed release guardrails)

These are release targets. The pre-change measurements and existing over-budget JS are recorded in `PRECHANGE_VALIDATION_AND_PERFORMANCE.md`; do not treat the target as a claim about current performance.

| Measure | Budget / policy |
|---|---|
| Initial JS transferred (compressed, route shell plus home) | target ≤250 KB; investigate every added chunk above 50 KB; feature route chunks lazy-loaded |
| Critical visible art | ≤180 KB compressed each; total initial home art ≤350 KB |
| Any single non-game feature screen's requested art | ≤500 KB compressed, lazy-load lower rows |
| CLS | <0.1; reserve media/card aspect ratios and stable skeleton geometry |
| Animation | 60fps target on midrange phone; no repeated full-page layout/paint; main-thread long tasks >50ms investigated on route entry and move animation |
| Texture/memory | no huge global bitmaps; measure decoded peak by route; unload/allow GC for prior route art |
| Image sizing | 1×/2× candidates, no >2× device CSS target for simple card art without reason |
| Interaction | first visible CTA and selected tile respond without waiting for noncritical art; route setup is code-split |

Use existing `client/scripts/check-bundle-size.mjs` and lazy route architecture as baseline; collect bundle and mobile traces before visual implementation. Playwright CPU/network throttling is useful for QA but doesn't replace real-device profiling.

## Visual regression architecture

Playwright is already installed and owns browser E2E (`client/playwright.config.ts`). Use it for screenshot capture and route flows; Vitest/jsdom cannot verify layout. The current reachability tests already produce h-overflow/tap matrices but are not a pixel-diff suite.

- Add a dedicated `client/e2e/mobile-landscape-visual.spec.ts` once fixture architecture is approved; don't overload reachability test or change E2E stateful serial groups without auditing server-state coupling.
- Canonical viewport: **844×390 CSS px, DPR 1** for stable image size; secondary set: 667×375, 740×360, 852×393, 915×412, 932×430. At minimum canonical screenshots all seven surfaces; compact/tall boundaries sample 667×375 and 932×430, with full geometry/tap checks at all six.
- Stable screenshot names: `mobile-landscape/{screen}/{state}-{width}x{height}.png`, e.g. `single-player/default-844x390.png`, `ghost-gameplay/legal-move-844x390.png`.
- Create fixtures for rating/friends, names, date, rankings, tournament slots, timers, scores, streak, daily state, online feed, and live game state. Freeze `Date`, stub API/socket responses or use isolated fixtures. Do not freeze app code paths in ways that bypass the real screen components.
- Mask only true volatile regions (timer digits or live presence); prefer fixed test data. Avoid masking title/action/status areas. Store before/after baseline and Playwright trace on failure.
- Start with strict structural checks and a small antialiasing tolerance. Candidate image threshold: ≤0.5% changed pixels per screen for stable geometry, but baseline calibration must show this doesn't hide layout regressions; define per-page/art tolerance and review artifact on any diff.
- CI captures Chromium at canonical viewport on changed relevant route CSS/components; full six viewport run nightly or release gate. WebKit/Safari smoke is a separate local/device matrix because CI browser installation differs.
- Retain failure artifacts at least 14 days; passing gold baselines are repository assets and reviewed with code. Update baseline only with explicit screenshot diff review.
- In addition to screenshots assert no document/page horizontal overflow, all primary actions visible/reachable, tab/header nonoverlap, safe-area inset, scroll ownership, `document.activeElement`/focus behavior, and target bounds.
- Keep gameplay deterministic by storing a fixed opening/live board fixture and mock opponent timing; do not run a random match or wall-clock Fritz search to produce expected screenshots.

The existing `mobile-reachability.spec.ts`, `mobile-390-hub-containment.spec.ts`, route tests and game behavior tests remain complementary gates.
