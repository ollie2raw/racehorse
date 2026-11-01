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
| [~] 1.4 | Client geometry copy replaced by game-core's open-ends functions. The scoring code was byte-identical, so no behaviour change; the client file now re-exports core and keeps only its dev diagnostics. A test pins every shared export to the core function | `client/src/game/openEndsGeometry.ts`, `openEndsSingleSource.test.ts` | this PR |
| [ ] 1.5 | Remove `Math.random` defaults from game-core (rng/deck required); callers inject | `engine.ts:38`, `pregameDraw.ts:17`; server call sites change in 3.x | |
| [ ] 1.6 | Server-bot parity test over a fixed position corpus (test only) | guards the later shared-engine extraction | |
| [ ] 1.7 | CSS ratchets in stylelint: `!important` budget, hex ban outside `tokens.css`, no new gradients | baselines from current counts so nothing regresses | |
| [ ] 1.8 | Tests for untested logic: `coachMessaging`, `learningStore`, `lessonV2` start/restore, then `useHandLifecycle` | highest-risk first | |
| [ ] 1.9 | Guest first impression: playable path or real sign-in button on Daily Fritz and `/games`; skeletons instead of placeholder dashes | from launch audit P1-3 | |
| [ ] 1.10 | Accessibility and polish batch: `LayoutScreen` h1, per-route page titles, tap targets to 44px, raw `not_found` text, skip the authed call when signed out | launch audit P2 5-9 | |
| [ ] 1.11 | Client dependency updates (react-router, dompurify chain, socket.io-parser) with full e2e | `npm audit --omit=dev` | |
| [ ] 1.12 | Consolidate raw `fetch` callers onto `api/client.ts` | 15 files | |
| [ ] 1.13 | Client half of the versioned wire protocol: event maps, ack types and `PROTOCOL_VERSION` in `match-protocol` (not yet enforced) | enforcement is 3.x | |

## Phase 2: owner-side and decisions (not code)

- [ ] 2.1 App icon artwork (1024x1024) and asset catalog
- [ ] 2.2 Apple Developer team, signing, App Store Connect record, privacy questionnaire
- [ ] 2.3 TestFlight pass on a real device; resolve old PRs #352 / #353
- [ ] 2.4 Decision: turn clock / idle-forfeit for casual and rated games
- [ ] 2.5 Decision: node-budgeted Fritz (changes bot strength; needs calibration rerun)
- [ ] 2.6 Play one signed-in game and run Analyze from Games; run the event-night monitor on Monday

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
- 2026-11-01: 1.1 (#410) and 1.3 (#411, loader and storage half) open. 1.2 (live-stylesheet selector purge) deliberately not started: it needs screenshot review per screen.
