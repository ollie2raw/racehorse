# Native surface audit (iOS 1.0)

What a **non-admin** player can reach in the iOS build, i.e.
`Capacitor.isNativePlatform() === true`, `VITE_ENABLE_TOURNAMENTS=false`,
`VITE_ENABLE_SPECTATOR_MODE` unset, no `VITE_E2E_*` / `VITE_DEBUG_*` flags (the
store-build guard refuses them). Audited 2026-10-12 against `origin/main`
26cb14e2 plus the 5B.3 changes.

The app has no deep-link handler (no `@capacitor/app` `appUrlOpen` listener)
and no address bar, so a route is reachable only through in-app navigation.
The policy for hiding unfinished features is `hidesComingSoonSurfaces()` in
`client/src/config/nativeAppSurface.ts`: web unchanged, native hides.

## 1. Routes and modes

Sources: `AppMode` (`client/src/types.ts`), `STATIC_PATHS`
(`client/src/routing/appRoutePath.ts`), `client/src/AppRoutes.tsx`,
`client/src/routes/*`, nav tabs (`client/src/components/nav/appPrimaryTabs.ts`,
`HomeScreen.tsx` `getHomeTabs`).

| Mode / path | How reached in native | Classification | Notes |
|---|---|---|---|
| `home` `/` | Launch | Live | Daily Fritz + Daily Puzzles cards, streak strip. Home tabs: Multiplayer, Single Player, Social, Learn (no Tournament: `getHomeTabs`; no Live Now: spectator off) |
| `multiplayer` `/multiplayer`, `/multiplayer/private` | Tab | Live | Quick Match, private rooms. **Fixed in 5B.3:** match-found head-to-head panel hidden (see §2) |
| `singlePlayerHub` `/solo` | Tab | Live | Play vs Fritz + Ghost. Journey card hidden for non-admins in native (`SinglePlayerHubScreen.tsx`, since #350) |
| `botSetup` / `bot` `/solo/fritz` | Solo hub | Live | Tiers Rookie / Standard / Elite / Master; 7 or 14 tiles |
| `ghostSetup` / `ghost` `/solo/ghost` | Solo hub | Live | |
| `dailyFritz` `/daily-fritz` | Home card | Live | "Locked" labels here are set progression (game 2/3), not placeholders. Post-game review structurally excluded (`POST_GAME_REVIEW_DEFERRED_DAILY_FRITZ`) |
| `dailyFritzLeaderboard` | Daily Fritz | Live | |
| `puzzleRush` `/puzzle-rush` | Home "Daily Puzzles" card | Live | |
| `learn` `/learn`, `/learn/how-to-play` | Tab | Live | How to Play, Guided Match, The Lab. **Fixed in 5B.3:** locked Lesson Library card hidden (see §2). How to Play is always open (`App.tsx` `canOpenHowToPlayPreview = true`) |
| `noBrainer` `/practice` | Learn → The Lab | Live | |
| `feed` `/social` | Tab | Live | "Recent Tournament Winners" widget only renders when tournaments are on (`ActivityFeedScreen.tsx`) |
| `friends`, `leaderboard`, `profile` `/players/:u`, `stats`, `ratingHistory` | Social | Live | Profile Block/Report controls (`PlayerSafetyActions.tsx`) |
| `settings` `/settings` | Nav menu | Live | Not audited for edits here (5B.2 owns it); no debug controls found |
| `journey` `/journey` | **No in-app entry** for non-admins (card hidden; Home doesn't render the command-center journey action) | Admin-only | Direct navigation would show `JourneyComingSoonScreen`, but nothing navigates there for non-admins |
| `tournament` `/tournament…` | **No in-app entry** (tab hidden; feed widget hidden; tournament session hooks only fire for assigned tournament matches, which can't exist with the server flag off) | Disabled | Route renders "Tournaments are unavailable right now" without fetches if reached |
| `live` | Not reachable: spectator off; route and Home tab both gated by `isSpectatorModeEnabled()` | Disabled (unfinished) | **Fixed in 5B.3:** store-build guard now refuses `VITE_ENABLE_SPECTATOR_MODE` (see §2) |
| `guidedMatchRecorder` `/learn/recorder`, `guidedMatchAnnotator` `/learn/guided-annotator` | Only from the Learn **admin** view (`isAdmin && showLearnAdminView`) | Admin / authoring | Routes themselves are not admin-gated (`AppRoutes.tsx`), but unreachable without an in-app link. Low risk; left as is |
| `dailyFritzHealthAdmin` `/admin/daily-fritz-health` | No in-app link | Admin | Data needs the `x-admin-secret` header the player doesn't have. Left as is |

## 2. Specific checks

| Check | Result |
|---|---|
| "Coming Soon" / "Soon" / locked cards and pills | Tournament tab and Journey card already hidden (#350). **Found and fixed:** Learn → "Lesson Library" locked card with a disabled "Coming Soon" button (`client/src/learn/LearnHome.tsx`); Quick Match found overlay "Head-to-head / Last meeting / Avg margin" panel, every value an em-dash, hint "Per-match stats coming soon" and a hard-coded "No prior ranked meetings" (`client/src/matchmaking/MatchFoundOverlay.tsx`). Both now take `hideComingSoon = hidesComingSoonSurfaces()`; web unchanged. With three Learn cards, the compact-landscape grid becomes one row of three (`learn-hub-grid--trio`, `client/src/learn/learn.css`) |
| Post-game analysis / review | Not exposed to non-admins. Every surface ANDs `isPostGameReviewAudience(email)` = `import.meta.env.DEV \|\| isAdminUser(email)` (`client/src/training/pivotalReview/postGameReviewPolicy.ts`): Play vs Fritz "Review game" (`useReviewRuntime.ts` → `botPostGameReviewEligible`), multiplayer "Analyze Game" (`LiveMatchScreen.tsx`, `MultiplayerGameShell.tsx`). `DEV` is false in `vite build --mode ios`. `HistoricalGameReviewPortal` has no production mount |
| Spectator (`VITE_ENABLE_SPECTATOR_MODE`) | Off. Documented as "preview only, not wired" (`docs/server-feature-flags.md`). `build:ios` also reads `client/.env` / `.env.local`, so a dev value could have leaked into a store build; the guard now refuses it (`client/scripts/iosReleaseGuard.mjs`, test in `iosReleaseGuard.test.ts`) |
| Admin UI | `isAdminUser` needs `VITE_ADMIN_EMAIL` to match the signed-in email (or `VITE_E2E_ADMIN_BYPASS`, refused by the guard). Admin-only: Learn authoring view, guided-match candidate capture, Journey, post-game review |
| Debug controls | `devtools/handLifecycleDebug.ts`, `devtools/dailyFritzDebugIngest.ts` (127.0.0.1 ingest) only run under `VITE_DEBUG_*` flags, refused by the guard |
| Dev / localhost wording | The only user-visible localhost string (Ghost "Start the server on http://localhost:3001") is behind `import.meta.env.DEV` (`client/src/ghost/api.ts`). `gameServerUrl.ts` localhost default is DEV-only; the bundle guard fails a build containing a configured localhost URL |
| Tournament "TBD" | Only on the bracket screen, unreachable with tournaments off |

## 3. Font audit (Part 17)

`client/index.html` loads Barlow Condensed 600–900 and Outfit 400–900 from
`fonts.googleapis.com` / `fonts.gstatic.com` (`display=swap`). Both families
are published on Google Fonts under the **SIL Open Font License 1.1**, which
permits bundling and self-hosting (keep the OFL text alongside the files).

**Decision: deferred, not done in 5B.3.**

- The font files are **not available offline**: no `@fontsource/*` package in
  `node_modules`, no local copies. Getting them means adding a dependency or
  downloading binaries, which this phase does not do.
- Doing it properly is not a one-liner: choose subsets (Google serves
  per-`unicode-range` files: latin, latin-ext, vietnamese), write `@font-face`
  rules matching today's weights, and visually diff the app.
- Current behaviour is acceptable for TestFlight: with no network the WebView
  falls back to the system sans (`font-display: swap`); with network the fonts
  arrive after first paint.

Why it is still worth doing before public launch: native cold start without a
font fetch, no player IP sent to Google (the privacy policy must otherwise
mention Google Fonts), and identical rendering offline.

Recipe for the follow-up PR: add `@fontsource/barlow-condensed` (600, 700,
800, 900) and `@fontsource-variable/outfit` (or `@fontsource/outfit` 400, 600,
700, 800, 900) as dependencies, import their latin CSS from `main.tsx`, remove
the three Google `<link>` tags from `client/index.html`, compare screenshots of
Home, Play vs Fritz and a leaderboard. After that ships, the CSP in
`vercel.json` can drop `https://fonts.googleapis.com` from `style-src` and
`https://fonts.gstatic.com` from `font-src` (`'self'` already covers bundled
fonts). Not edited here.
