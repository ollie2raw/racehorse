# Pre-change validation and performance baseline — 2026-09-25

Captured before production mobile UI changes. The repository already had unrelated uncommitted changes in `PROGRESS-F.md`, `client/src/journey/RacehorseJourneyScreen.tsx` and a Supabase migration; this pass did not alter them. Existing E2E specs overwrite screenshot files; the six tracked captures they refreshed were restored after the run, and nine newly named generated captures were moved to `/private/tmp/racehorse-e2e-preflight-output/`.

## Validation ledger

| Check | Command | Status / evidence | Existing issue / mobile relevance |
|---|---|---|---|
| Typecheck | `npm run typecheck --prefix client` | PASS, exit 0 | pre-change baseline |
| Lint | `npm run lint --prefix client` | PASS, exit 0; 48 warnings, 0 errors | warnings are existing max-lines/hooks findings; no mobile edits yet |
| Architecture | `npm run check:architecture --prefix client` | PASS, 22/22 invariants | pre-change baseline |
| Production client build | `npm run build --prefix client` | PASS; Vite 4,871 modules, prerender 17 routes | existing circular chunk and unsupported CSS `room` warnings; not caused by mobile work |
| Bundle guard | `npm run size-check --prefix client` | PASS; AppRoutes 94 KB vs 195 KB, BotMatchScreen 249 KB vs 254 KB, index 480 KB vs 684 KB | BotMatchScreen is only 5 KB below existing raw-size guard; new mobile JS must be small |
| Unit suite | `npm run test --prefix client -- --run` | PASS: 278 files, 2,161 tests | existing jsdom `HTMLMediaElement.play()` notices only |
| Mobile hub E2E | `npm run e2e --prefix client -- --project=chromium-mobile client/e2e/mobile-390-hub-containment.spec.ts` | PASS: 10/10, portrait 390×844 and landscape 844×390 | tests scroll every container to bottom before reachability assertion; they do **not** guarantee all reference content visible at scroll origin |
| Mobile route/game E2E | `npm run e2e --prefix client -- --project=chromium-mobile-df-serial mobile-390.spec.ts` | PASS: 9/9 at 390×844, including Fritz/Daily Fritz/private MP portrait states | current hard rotate gate is expected by these tests and must change with ratified policy |
| Pre-game draw script | `npm run test:pre-game-draw --prefix client` | **FAIL before assertions**: `ts-node --esm` cannot resolve extensionless `src/utils/logger` imported from `openEndsGeometry.ts` | pre-existing script/Node 25 loader issue; do not conceal as a gameplay failure; fix/test-runner migration is separate |
| Open ends direct | `npx tsx client/src/game/openEndsGeometry.behaviorTests.ts` | PASS | verifies geometry despite broken legacy script loader |
| Bot UI hooks script | `npm run test:bot-hooks --prefix client` | PASS after sandbox IPC permission (three behavior files) | first sandbox run failed EPERM on tsx local pipe, rerun outside sandbox passed |
| Four pre-game draw files via `node --import tsx` | see commands below | PASS after direct loader workaround | confirms tests run independently of broken npm script |
| Multiplayer recovery machine via `node --import tsx` | see command below | PASS | covers later reconnect presentation work |

Direct loader commands: `node --import tsx client/src/match/preGameDraw/{preGameDrawLogic,usePreGameDraw,preGameDrawEligibility,preGameDrawScatter}.behaviorTests.ts` (run individually) and `node --import tsx client/src/multiplayer/recoveryMachine.behaviorTests.ts`.

## Production build and route-load measurements

Measured from the **current** `client/dist` built above, served by `vite preview` on localhost:4173; Chromium at 844×390, DPR 1, anonymous, welcome dismissed, route entry + 2.5 seconds. The API server was not running for this preview trace, so backend calls failed and the timings describe **frontend asset loading only**, not populated data readiness. Artifact JSON: `/private/tmp/racehorse-preflight-trace.json`. Response bytes below are decoded asset body sizes, **not compressed wire transfer**; JS gzip is computed from the exact built files. External font requests are not included. This is a directional baseline, not a throttled midrange-device benchmark.

| Route | JS requested (raw / gzip) | CSS raw | WebP raw | Notable route chunks | Browser load event* |
|---|---:|---:|---:|---|---:|
| `/` Home | 1,398,045 / 427,435 B | 343,101 B | 99,450 B | `HomeScreen` 40.8 KB raw / 12.0 KB gzip | 1,094 ms |
| `/solo` | 1,359,483 / 416,788 B | 347,136 B | 329,270 B | `SinglePlayerHubScreen` lazy, 3 character assets | 725 ms |
| `/daily-fritz` | 1,411,415 / 431,566 B | 466,088 B | 171,532 B | `DailyFritzScreen` 59.95 KB / 18.48 KB gzip | 544 ms |
| `/tournament` | 1,358,092 / 414,254 B | 341,934 B | 98,800 B | `TournamentHubScreen` lazy | 838 ms |
| `/social` | 1,377,950 / 421,314 B | 372,755 B | 98,800 B | `ActivityFeedLobbyBridge` 33.12 KB / 10.92 KB gzip | 753 ms |
| `/learn` | 1,502,416 / 460,921 B | 417,959 B | 369,604 B | `LearnHome`, `lesson-v2`, `bot-guided`; two Learn art assets | 707 ms |

*Load-event timings are local-machine/localhost values with unthrottled network and should not be compared to field targets. The Long Tasks observer recorded no >50 ms entries in these six runs; this is insufficient proof of 60 fps on a phone. Layout-shift entries from `getEntriesByType('layout-shift')` were empty; future QA should use a dedicated `PerformanceObserver` and real-device profile. `index` JS is 491.32 KB raw / 146.95 KB gzip; `vendor-supabase` 211.22 / 54.93 KB; `move-logger` 195.46 / 65.53 KB; `vendor-charts` 394.93 / 113.35 KB but not observed on these first-view routes. Initial CSS `index` is 287.8 KB raw / ~49.5 KB gzip.

**Key hotspot:** `client/dist/index.html:48-57` module-preloads game engine/reviewer/logging chunks before a Home/Solo page needs gameplay. `client/dist/index.html:61-62` preloads the two Home WebPs on **every** route, so `/solo`, `/daily-fritz`, `/tournament`, `/social`, `/learn` each paid the 96,522 B Home-art transfer; this explains the ~98.8 KB common WebP floor with logo. The image tags are injected by `preloadHeroImagePlugin` in `client/vite.config.ts:11-31` into the SPA HTML, then inherited by the preview fallback; route-aware treatment belongs to PR 0/2 or PR 8. Solo adds 230,470 B selected character art; Learn adds 270,804 B sprite/scientist art. Keep this separate from image file size itself.

The current initial Home JS gzip (~427 KB) exceeds the proposed ≤250 KB target in `APP_READINESS_AND_VISUAL_QA.md` by ~177 KB **before redesign**. PR 1–3 must not worsen this without a trace-backed waiver; PR 8 should address baseline boot/chunk preloads if this target remains the release budget. The selected Home art (96.5 KB) is already comfortably under the ≤350 KB pair budget and each ≤180 KB image budget. The selected Solo trio (230.5 KB) fits the ≤500 KB per-screen art budget. These are encoded bytes, not decoded memory: decoded selected Home sources are ~12.6 MB RGBA together at full source dimensions, and Solo sources ~4.8 MB, so responsive derivatives/route unloading still matter.
