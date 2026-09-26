# Current architecture audit

Read-only audit of the current implementation. File links are repository-relative.

## Composition and route ownership

`client/src/App.tsx` owns auth bootstrap, app mode, socket/reconnect lifecycle, shared tournament hook, multiplayer runtime, overlays, and route-state integration. It composes props via `useAppRoutesProps.tsx` / `AppRoutesGamePropsHost.tsx`. This is a deliberately centralized runtime with extracted route families, not a page-router architecture.

`client/src/routing/appRoutePath.ts` maps pathname ↔ `AppMode`; `useAppRouteState.ts` synchronizes `pushState`/`popstate`. `client/src/AppRoutes.tsx` branches on modes. Route trees:

| Surface | Route | Route/component chain | Important shared/runtime dependencies |
|---|---|---|---|
| Today’s Race/home | `/` | `AppRoutes → HomeRoute → HomeScreen` | `GlobalNav`, `HomeStreakStrip`, `HomeNextMoveBar`, daily Fritz/puzzle/solo entry cards, tournament upcoming data |
| Single Player | `/solo` | `AppRoutes → SinglePlayerHubRoute → SinglePlayerHubScreen` | `GlobalNav`, mode cards for Play vs Fritz, Ghost, Journey, streak/stats; `useSinglePlayerHubStats` |
| Ghost setup | `/solo/ghost` | `GhostSetupRoute → GhostSetupScreen` | shares Play vs Fritz setup CSS/theme, opponent/profile API, account auth; successful start switches app mode to `ghost` |
| Ghost match | transient `/` mode | `GhostMatchRoute → BotMatchScreen(mode="ghost") → LiveMatchScreen → MatchLiveLayout/InGameBoardShell` | shared bot match session, board camera, ghost profile and standard game data. `buildAppPath` intentionally does not deep-link active Fritz/Ghost trials. |
| Daily Fritz | `/daily-fritz` | `DailyFritzRoute → DailyFritzScreen → DailyFritzHubView` and embedded match/result layers | daily session hooks, verified result path, shared bot match view, socket/social props, Daily Fritz leaderboard route |
| Tournament | `/tournament`, `/tournament/:id`, `/result` | `TournamentRoute → TournamentHubScreen / TournamentBracketScreen / TournamentResultScreen` | `useTournament` hoisted in `App`, tournament socket registrars, attached multiplayer match runtime |
| Learn | `/learn`, `/learn/how-to-play` | `LearnRoute → LearnHome / LearnHowToPlayRacehorse / LearnPlayer` | guided mode flags and bot session; Learn setup routes share `BotMatchScreen`; lesson and article content is lazy-loaded |
| Social | `/social` | `FeedRoute → ActivityFeedLobbyBridge → ActivityFeedScreen` (also friends, leaderboard, profiles) | `GlobalNav`, friends socket, challenge/invite state, public profiles and shared hub shell |
| Account/profile | `/settings`, `/stats`, `/friends`, `/rating-history`, `/players/:name` | `SettingsRoute`, `StatsRoute`, `FriendsRoute`, `RatingHistoryRoute`, `ProfileRoute` | same mode state; auth actions; some surfaces mount modal-like bridges but are route modes |
| Result/review | mode-specific overlays and route states | `BotMatchScreen` result → post-game review; Daily Fritz result overlay; `TournamentResultScreen`; `GameReviewer` | review engine, saved match/result data, and original mode callbacks remain domain-owned |

Primary screen and route source files: `client/src/AppRoutes.tsx`, `client/src/routes/{soloPlayRoutes,dailyRoutes,tournamentRoutes,socialRoutes}.tsx`, `client/src/routing/{appRoutePath,useAppRouteState}.ts`.

## Shell, global and reused pieces

- **Global today:** `.app` in `App.css`; route mode/history and runtime in `App`; shared CSS tokens in `styles/tokens.css`; `GlobalNav`; `AppBottomTabBar`; global auth/network/error overlays.
- **Shared among hubs:** `GlobalNav` + `AppBottomTabBar`; `HubViewportPage` / `hubViewportPage.css`; page hero primitives; home image-card families. Social has its own shared hub token/filter/panel CSS.
- **Shared among setup pages:** Play vs Fritz (`pvf-root`) layout is reused by Ghost setup and Learn/coach entry, with feature-root selectors overriding it. This couples Ghost to Fritz setup density and card geometry.
- **Gameplay-specific:** `BotMatchScreen`, `LiveMatchScreen`, `MatchLiveLayout`, `MatchBoardCanvas`, `InGameBoardFrame`, `InGameBoardShell`, `InGameBoardHud`, `Board`, board camera/layout, hand/placement overlays. Daily Fritz and tournament flow bridge into gameplay without moving server/domain owners.
- **Desktop-specific assumptions:** desktop `GlobalNav` exposes horizontal named tabs and rating/friends; many page grids retain fixed min widths and broad desktop art. Tailwind `desk:` adds the horizontal tabs only above both 769px width and 600px height, so the 844×390 baseline correctly stays on bottom tabs. But width-only custom media still skips phone page overrides, producing the observed mixed shell/content behavior.
- **Already responsive:** bottom tabs, Home/Solo/Learn CSS, Social hub, Daily Fritz, Tournament hub, and gameplay each have responsive rules. Their thresholds and height rules are inconsistent; “responsive” often means narrow portrait, not landscape phone.
- **Incorrect/fragile reuse:** GlobalNav is mounted by individual route screens, resetting its state and repeating its fetch lifecycle. Ghost setup shows the five-item hub tab bar as a second chrome row immediately below the brand/account header (at y=57–117 in the 844×390 capture); a focused setup route should declare its primary-nav policy centrally and keep chrome placement consistent.
- **Duplicated systems:** separate `home-hub.css`, `RacehorseHomeArt.css`, `SinglePlayerModes.css`, `learn.css`, `dailyFritz.css`, `tournamentHub.css`, social hub CSS and legacy responsive overrides style cards, headlines, back controls, and nav-adjacent layouts separately. Reuse is often selector-level rather than primitive-level.

## Global viewport, overflow, and safe areas

- `App.css`: `html, body` use `height:100%`, `min-height:100dvh`, `overflow:hidden`; `#root` is full height; `.app` uses `height/min-height:100dvh`, `overflow:hidden`, column flex. A screen has to participate in that flex chain and own any internal scrolling.
- `App.css .layout-screen`: default `min-height:100dvh`, `height:auto`, `overflow-y:auto`; at ≤900 it remains auto-height. This conflicts with viewport-contained hub screens if composed without a bounded flex parent.
- `components/hub/hubViewportPage.css`: uses explicit viewport containment and app-child selectors; its 1080px rules allow some overflow/scroll behavior. Settings deliberately opts out (documented in `SettingsScreen.tsx` and settings CSS) so long forms can scroll.
- `styles/responsive.css`: old mobile match layout includes `height/min/max-height:100dvh`; modal uses `max-height:calc(100dvh - 48px)`; bottom nav applies `env(safe-area-inset-bottom)`; `AppBottomTabBar.css` also includes bottom safe area. Safe-area ownership is therefore distributed and can double-count when nested.
- Other safe-area usage appears in `home-hub.css` top fixed header, `SinglePlayerModes.css`/Daily Fritz rules, journey, lesson host and private lobby. No root-level safe-area contract or explicit left/right policy is visible.
- `rotate-overlay.css`: hides `.game-screen` and displays a full-screen rotate overlay at ≤768 and portrait. This is an existing gameplay-only portrait gate; hubs remain portrait-capable. `client/public/manifest.json` separately declares portrait orientation while the approved targets are landscape, so installed-app behavior and web CSS disagree. Do not extend it globally; reconcile/remove the manifest restriction when the owner ratifies orientation policy.
- `client/index.html` already sets `width=device-width, initial-scale=1.0, viewport-fit=cover`, links a web manifest/apple touch icon, and declares Apple standalone capability/status-bar style. Safe areas are therefore available in installed/display modes, but ownership is distributed across CSS and needs consolidation.
- `client/public/manifest.json` provides `display: standalone`, app icons and theme colors. It declares portrait orientation. No service-worker registration was found in the source/public search, so the manifest alone does not provide offline caching or background/resume guarantees.
- Browser chrome is not modeled consistently. `100dvh` is used, but stable/large viewport variants (`svh/lvh`) are absent from shell policy. WebView standalone, notch/cutout testing is not represented by desktop Chromium screenshots.

## Breakpoints and what changes

The documented system is in `docs/breakpoints.md`; custom media are declared in `styles/tokens.css` and expanded by `client/postcss.config.js`. There is a critical mismatch: `--desk` is width ≥769 in custom media/docs, but Tailwind `desk:` in `client/tailwind.config.js` is `(min-width: 769px) and (min-height: 600px)`. So at 844×390 `desk:` utilities choose the phone/base layout while `@media (--phone)` route CSS does not run. The rendered page gets a hybrid of two breakpoint systems. `rh-mobile-chrome.css` comments document the height-aware Tailwind fix, but the published breakpoint guide and CSS custom media have not been aligned to it.

| Threshold | Meaning/documented use | Actual behavior and concern |
|---|---|---|
| ≤360 | Home extra-small override | isolated art/card tuning; not global |
| ≤520 | Single Player nested padding cleanup | local adjustment only |
| ≤600 | `App.css .layout-screen` compact padding | generic page padding changes |
| ≤640 | HUD polish | some match HUD styles |
| ≤768 `--phone` | phone: bottom tab bar, one-column/full bleed | `GlobalNav` placement and many hub rules; landscape handset at 844–932 misses this |
| ≥769 `--desk` custom media | desktop | documented as complement of phone, but width-only and therefore does not match Tailwind's `desk:` |
| Tailwind `desk:` ≥769 width and ≥600 height | desktop hub styling | landscape phones under 600px use base/phone layout; this is why bottom tabs remain at 844×390 |
| ≤900 `--below-wide` | collapse multi-column grids | broad reflow for hub layouts; some pages retain desktop shell chrome |
| 920 / 1020 / 1024 / 1080 / 1100 / 1120 / 1180 / 1279 / 1280 / 1360 | local legacy breakpoints | grid collapse, density and sidebar behavior; no common orientation/height model |
| gameplay ≤900px + landscape | explicit legacy game rule | separate board/HUD fitting rules |
| height ≤920 / 860 / 600 in select CSS | content compression / landscape match | inconsistent coverage; many hub pages have no height-specific compact rules |

Audit with `rg '@media' client/src --glob '*.css'` before implementation because numerous page-local rules remain outside `docs/breakpoints.md`'s three-name new-code contract. Do not mechanically replace the literal gameplay query until board owners approve equivalent behavior.

## Fixed dimensions / desktop assumptions

High-impact examples: `.app` and route screen roots are viewport-fixed; nav bars have fixed heights; tokens set 60px bottom bar and 64px tray; HUD has a 72px score header; private lobby CSS has fixed panel dimensions and 1180/1100/1024/phone breakpoints; route modals use fixed insets and max-height; board nodes are positioned from measured canvas extents. These are not intrinsically wrong, but must be budgeted from available height. The page capture demonstrates that fitting document width does not guarantee reachable content.

Absolute/fixed placement is appropriate for board overlays, art within clipped card frames, global chrome, and dialogs. Risk appears when card art can escape `overflow:visible` parents or a page stacks fixed header + fixed bottom navigation over an unconstrained content area.

## Current interaction and testing evidence

`client/e2e/mobile-reachability.spec.ts` already checks 21 routes at 390×844, 834×1112 and 844×390 for h-overflow and target size (44px unless WCAG spacing exemption); it is opt-in and guest/auth coverage differs. `mobile-390-hub-containment.spec.ts` verifies portrait and 844×390 reachability/art containment for five hubs. `mobile-390.spec.ts` has phone screenshots in portrait. Existing test screenshot output contains chromium/webkit variants.

These tests are valuable groundwork but do not provide six requested widths, gold-screen state fixtures, visual diffs, touch gesture/keyboard/accessibility contracts, or reliable signed-in profile data across all screen states. They also don't capture a fully live landscape Ghost match.

### Touch-specific findings from gameplay source

`components/Board.tsx` attaches `onWheel`, `onMouseDown`, `onMouseMove`, `onMouseUp`, `onMouseLeave`, and `onDoubleClick`; `useBoardPointerControls.ts` uses React mouse-event handlers, ignores non-left mouse buttons for pan, wheel-zooms and double-click-fits. There is a separate on-screen zoom/reset tray, which is the touch alternative for zoom/reset, but no pinch path is evident in this camera hook. `.placement-zone` in `styles/match-gameplay.css` uses `touch-action:none`; verify this does not interfere with adjacent board gestures or scroll. Tile selection/placement needs a tap-only test at real mobile hit sizes. Current CSS `:hover` rules found on feature cards and filters are presentation-only in the inspected families; ensure no explanatory content is hover-only in the full route audit.
