# Chess.com-parity roadmap

The single execution list. Sources: `launch-audit-2026-11-01.md` (UI, App Store, ops) and `code-health-audit-2026-11-01.md` (code structure). Each item is its own PR, merged by the owner. Update the checkbox and the "PR" column as work lands.

## Rules of execution

- **One item = one branch from `origin/main` = one PR.** Small, reviewable, reversible.
- **Server freeze:** no server code changes until the first tournament week has run (events Mon 2026-11-02 18:00 and 21:00 ET). Items marked `SERVER` wait for Phase 3. Client-only items proceed.
- **Gates before every PR touching app code:** `tsc -b`, vitest from `client/` (and `server/` when touched), lint (warning budget 50), `lint:css`, `check:architecture`, `npx vite build`, `node scripts/check-bundle-size.mjs`, `npm run check:bot-match-lazy`. UI changes also get screenshots (phone, native landscape 844x390, desktop).
- **Never change gameplay behaviour in a refactor.** Refactors keep the existing oracle, parity and e2e tests green and add tests first when coverage is thin.
- **Definition of done for an item:** gates green, tests added or extended for the changed logic, the audit finding closed with evidence, and this file updated.

## Phase 0: before Monday's first event (client only, small)

| # | Item | Evidence | PR |
|---|---|---|---|
| [x] 0.1 | Tournament bracket refetches on reconnect and tab return; stale-data strip with retry when a refresh fails. (The screen already polled every 20 s while visible; the real gap was the throttled-tab and recovery case.) | `useTournament.ts`; `TournamentBracketScreen.tsx` | #409 merged |

## Phase 1: event week, client only (no server)

| # | Item | Notes | PR |
|---|---|---|---|
| [x] 1.1 | Delete dead Learn v1 code, dead CSS files, deprecated shims | 9 files, about 2,770 lines; `tsc -b` is the proof | #410 merged |
| [ ] 1.2 | Purge unreferenced selectors from the four big Learn/Journey stylesheets | review the diff by screenshot; dynamic class names are the risk | |
| [~] 1.3 | Loader and storage half merged (#411). Guided-match loader no longer rejects the module on a failed fetch; `saveLearnProgress` write guarded. **Still open: gate the recorder/annotator tools out of the production bundle** (separate PR, needs its own size check) | `guidedMatchLessonLoader.ts`, `learn/progress/storage.ts` | #411 merged; recorder gating still open |
| [x] 1.4 | Client geometry copy replaced by game-core's open-ends functions. The scoring code was byte-identical, so no behaviour change; the client file now re-exports core and keeps only its dev diagnostics. A test pins every shared export to the core function | `client/src/game/openEndsGeometry.ts`, `openEndsSingleSource.test.ts` | #412 merged |
| [ ] 1.5 | Remove `Math.random` defaults from game-core (rng/deck required); callers inject | `engine.ts:38`, `pregameDraw.ts:17`; server call sites change in 3.x | |
| [-] 1.6 | **Assessed, not built.** A move-parity test would be false: the two bots already differ. The server's `standard` / `elite` tiers use pick probabilities 0.82 / 0.94 (decay 0.58 / 0.50), the client's `standard` / `hard` use 0.86 / 0.97 (decay 0.55 / 0.50), the tier names do not match (`elite` has no client counterpart), the states have different shapes, both sample randomly, and the client search is wall-clock bounded. The constants are not exported, so a drift guard would mean editing both files. The fix is 4.2 (one shared engine), then a parity test is meaningful. Decide whether the tournament tiers are meant to differ before 4.2 | `server/src/bot/serverBot.ts:28-32`, `client/src/modules/fritz/botHeuristics.ts:85-90` | none |
| [x] 1.7 | CSS ratchet: per-file `!important`, hex outside `tokens.css` and gradients may never increase; new files start at zero. Baseline today: 2,803 / 993 / 406 across 110 files. Run `node scripts/checkCssRatchet.mjs --update` in the same PR whenever a CSS count drops | `client/scripts/checkCssRatchet.mjs`, `css-ratchet-baseline.json`, CI step | #413 merged |
| [~] 1.8 | Tests for untested logic. **Done (#414):** `coachMessaging` (1,440-case copy-rule grid, decision tables) and `learningStore`. **Still open:** `lessonV2` start/restore, then `useHandLifecycle` | `learning/coachMessaging.test.ts`, `learning/learningStore.test.ts` | #414 merged |
| [x] 1.9 | Guest first impression (#415 merged). Daily Fritz: the main button reads "Sign in to play" and opens sign-in, the duplicate alert is gone, and the set tiles show today's Pacific date, "Best of 3" and the Elite tier instead of dashes. Games: an explanation and a real Sign in button. **Not done:** letting a guest actually play Daily Fritz; decided on 2026-11-01 and designed in `guest-play-design.md` (items 1.14, 2.7, 3.12, 3.13) | `dailyFritzHubViewModel.ts`, `DailyFritzHubView.tsx`, `GamesPage.tsx` | #415 merged |
| [x] 1.10 | Accessibility and polish batch, split into three PRs. **(a) Headings and titles, this PR:** `LayoutScreen` takes `headingLevel` (Games and Rating History pass 1; the default stays 2 so pages with their own h1 are unchanged), Friends title is an h1, Practice has a screen-reader h1 in every state, new `usePageTitle` names Puzzle Rush, Practice, Friends, Stats, Games and Rating History. **(b) Tap targets to 44px, this PR (a2):** an invisible 44x44 hit area (`styles/touch-slop.css`) for the compact menu and hub controls, real height where a control already uses both pseudo-elements or is clipped (how-to-play jump link, private-lobby tabs, native hub filters, Social Retry), a padded support email link, and `e2e/touch-targets-menus.spec.ts`, which sweeps `elementFromPoint` over a 44x44 box around 18 control groups at native landscape and phone portrait. Documented limit: the 8 how-to-play progress markers share about 310px, so their hit area is the full 44 tall but only about 39 wide. Merged as #418; the support email link was checked on the production deploy (203x51, rule live). **(c) This PR:** `useAsyncData` now maps server codes and JSON bodies to a sentence (the screen's own copy, or a default), which fixes nine screens at once including the Social feed and Rating History; the ghost-rating failure message uses the same mapper; the Daily Fritz leaderboard no longer asks `/api/daily-fritz/today` for a signed-out visitor (it only returned 401). Also noticed: Rating History as a guest shows red "Sign in to view your rating history." with no button (same fix as Games in 1.9); `/learn`, `/daily-fritz`, `/solo` and the home page still use the default tab title | launch audit P2 5-9 | (a) this PR |
| [~] 1.11 | Client dependency updates. **Done in this PR:** `dompurify` 3.4.14 to 3.4.17 (critical, reached through `posthog-js`), `react-router(-dom)` 7.18.1 to 7.18.5 (high; the advisory is RSC mode, which the app does not use, but it is now clear), and `@capacitor/cli` moved to `devDependencies` (it only runs in `cap sync ios`; clears six moderate findings that were never shipped). Production audit 11 findings to 1. **Held for 3.2:** `socket.io-parser` (high), because the lockfile is shared with the server's `socket.io` and a bump would change the server's resolved dependencies during the freeze. `brace-expansion` is ESLint-only (dev) | `npm audit --omit=dev`, `client/package.json`, `package-lock.json` | this PR |
| [ ] 1.12 | Consolidate raw `fetch` callers onto `api/client.ts` | 15 files | |
| [ ] 1.13 | Client half of the versioned wire protocol: event maps, ack types and `PROTOCOL_VERSION` in `match-protocol` (not yet enforced) | enforcement is 3.x | |
| [~] 1.14 | Guest play, phase G1: client auth groundwork behind `VITE_ENABLE_GUEST_PLAY` (off). **Done in this PR (G1a, the auth layer):** the flag (`config/guestPlayFeature.ts`, also in `.env.ios.example`), `useAuth().isAnonymous`, `ensureGuestSession()` (lazy, one shared in-flight request, hands a returning guest their stored session back, never replaces a signed-in player), `signUp` upgrades the guest user in place when the flag is on (handle first, then `updateUser`), and the username prompt is suppressed for guests. **Still open (G1b):** guest wording in the sign-in and sign-out screens ("this replaces your guest session"), a `guest` property on the PostHog and Sentry identity, and anonymous users in the e2e fake backend | `docs/guest-play-design.md` | this PR |

## Phase 2: owner-side and decisions (not code)

- [ ] 2.1 App icon artwork (1024x1024) and asset catalog
- [ ] 2.2 Apple Developer team, signing, App Store Connect record, privacy questionnaire
- [ ] 2.3 TestFlight pass on a real device; resolve old PRs #352 / #353
- [ ] 2.4 Decision: turn clock / idle-forfeit for casual and rated games
- [ ] 2.5 Decision: node-budgeted Fritz (changes bot strength; needs calibration rerun)
- [ ] 2.6 Play one signed-in game and run Analyze from Games; run the event-night monitor on Monday
- [ ] 2.7 Guest play, phase G0 (owner, Supabase dashboard): enable anonymous sign-ins; pick a captcha provider (Turnstile preferred) and add its secret; review the anonymous sign-in rate limit. Decisions already made: upgraded guests may appear on the same day's leaderboard, a captcha guards guest creation, Play vs Fritz guests are recorded too

## Phase 3: after the first tournament week (server unfrozen)

| # | Item | PR |
|---|---|---|
| [ ] 3.1 | Shared HTTP error handler (no raw error text) and request-id middleware; replace `console.*` with the logger | |
| [ ] 3.2 | Server dependency updates (`proxy-addr`, `body-parser`, `engine.io`, `socket.io-parser`, `compression`) | |
| [ ] 3.3 | Zod validation at every socket event and HTTP route, shadow mode first, money paths first | |
| [ ] 3.4 | Protocol version enforced in the handshake with explicit `upgrade_required` | |
| [ ] 3.5 | Turn clock for casual and rated games (per 2.4) | |
| [ ] 3.6 | Crash-restart test: kill mid-hand, assert timers, receipts, turn state recover | |
| [ ] 3.7 | Rush leaderboard: best-run-per-user in SQL, pagination, own rank; per-puzzle solve-time plausibility | |
| [ ] 3.8 | Tournament hygiene: public bracket DTO, paginate `/history`, explicit bot-result winner source | |
| [ ] 3.9 | Multiplayer review records (design already in `review-game-record-architecture.md`) | |
| [ ] 3.10 | Boot-time env schema; schema baseline and migrations as single source of truth with a CI diff | |
| [ ] 3.11 | Stamp engine/ruleset versions on saved reviews | |
| [ ] 3.12 | Guest play, phase G2: `profiles.is_guest` (set at creation, flipped when the user becomes permanent); leaderboards and tournament registration exclude guests; inactive-guest cleanup sweep; server principal helper returning `is_anonymous`; RLS probe test. **Must deploy before the flag in 1.14 is turned on** | |
| [ ] 3.13 | Guest play, phases G3 and G4: guest UI on Daily Fritz and Play vs Fritz ("save this game" prompt, Games page for guests, replaces the 1.9 "Sign in to play" button), captcha widget and CSP, native device test, privacy copy, flip the flag | |

## Phase 4: structural consolidation (one at a time, behind the existing tests)

| # | Item |
|---|---|
| [ ] 4.1 | Node-budgeted Fritz search (per 2.5), then split `botHeuristics.ts` into eval / search / tiers |
| [ ] 4.2 | Shared Fritz engine package; server bot stops being a copy |
| [ ] 4.3 | One client match engine: core owns dealing, starters, hand lifecycle; `phase` union replaces the three booleans (state-version bump and migration) |
| [ ] 4.4 | `useHandLifecycle` becomes a pure reducer with injected clock; `MultiplayerGameShell` controller hooks; recovery-machine fuzzer |
| [ ] 4.5 | Router-owned app mode; `App.tsx` capped in `check:architecture` |
| [ ] 4.6 | God-file splits: `generatePuzzles.ts`, `ghost/service.ts`, tournament `engine.ts`, `rooms.ts`, `roomLivePersistence.ts`, `useAuth.ts`, `usePostGamePivotalReview.ts` |
| [ ] 4.7 | One "which analysis stack owns what" doc and a differential test between the learning coach and review-engine thresholds |
| [ ] 4.8 | Unify Learn / Journey / learning progress into a versioned, optionally synced store |
| [ ] 4.9 | Retire `walnut-live.css` and `premium-theme.css` screen by screen; split `dailyFritz.css` and `native-landscape.css` by surface; shared solo-leaderboard component |
| [ ] 4.10 | Bundle budgets ratchet from a committed baseline |
| [ ] 4.11 | Marketing assets: per-page OG images, 180px apple-touch-icon |

## Status log

- 2026-11-01: roadmap created from the two audits.
- 2026-11-01: 0.1 built and verified, PR #409 open (`[~]` = PR open, awaiting merge; `[x]` = merged).
- 2026-11-01: #415 merged (1.9 done except guest play itself). Guest-play design written and approved in direction (anonymous Supabase sessions, upgrade in place); added as 1.14, 2.7, 3.12, 3.13.
- 2026-11-01: #409 to #414 merged. 1.6 assessed and not built (see its row). 1.9 open.
- 2026-11-01: #409, #410, #411, #412, #413 merged. 1.8 (coach and profile tests) open. Found while testing: `updateProfile` never fills `recurringMistakeTags` (it builds its history from lesson text, not concepts); nothing reads the field yet, recorded as an expected-fail test.
- 2026-11-01: 1.1 (#410) and 1.3 (#411, loader and storage half) open. 1.2 (live-stylesheet selector purge) deliberately not started: it needs screenshot review per screen.
