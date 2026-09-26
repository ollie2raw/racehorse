# PR 0 fixture and asset foundation

PR 0 does not change a production page, route, style, shell, or preload policy. The frozen phone tabs and Home selected-state rule remain as approved in the planning package.

## Fixture contract

`client/e2e/fixtures/mobile/base.v1.json` owns the shared Pacific date (`2026-09-25T12:00:00-07:00`), dev E2E principal, account rating/friends, and the exact Home/Solo API boundary responses. `states/*.v1.json` overlays only state-specific responses and local persistence. `schema.ts` defines the contract; `loader.ts` merges by HTTP method plus full path, seeds storage before navigation, and fulfills every `/api/` request from the fixture. An unlisted API request receives HTTP 599 and fails the test via `assertNoUnexpectedApiCalls`. The intercept matches URL pathname `/api/`, avoiding Vite module source paths such as `/src/api/client.ts`.

The existing `readE2eDevAuth` branch remains the sole test auth path. A valid dev E2E bearer plus matching user ID can read `racehorse_mobile_visual_identity_v1`; `useAuth` supplies its username/rating and `fetchFriends` supplies its friends. Both are gated by `import.meta.env.DEV && !import.meta.env.PROD`. `ranking/api.ts` permits the same dev E2E principal to exercise rating-history API loading when Supabase is not configured. The fixture values never become product defaults. `e2eDevAuth.mobileFixture.test.ts` proves production configuration rejects even a fully seeded identity; the production build was also checked for the fixture storage key and user ID, with neither present in emitted JS.

The five PR 0 states are `home/not-played`, `home/completed`, `solo/empty`, `solo/populated`, and `solo/journey-locked`. Home completion includes a version-2 best-of-three two-game set with seeds, scores, winner, rank, streak and `verification_status: verified`; the real Home normalization chooses its result view. Solo stats come from the real ranking-history and Ghost profile loaders. Journey lock uses the existing non-admin gate; the visual project uses an isolated dev server on port 5244 with the old global E2E admin bypass disabled. Journey and Lab persistence keys are seeded through the same loader.

Run the fixture suite with `npm run e2e:mobile-fixtures --prefix client`. It makes functional assertions and has **no approved screenshots**. `visualHarness.ts` holds canonical 844×390 DPR 1, five secondary landscape sizes, a portrait size, font/image stability, overflow/reachability helpers, and the future `mobile-landscape/{screen}/{state}-{width}x{height}.png` naming function. The project freezes the clock and Pacific timezone, requests reduced motion, uses a fresh context per test, and dismisses Welcome before navigation. Socket scripts are optional schema data for later gameplay fixtures; Home and Solo need none.

## Home asset exports

Approved sources remain `client/src/assets/home/newHOMEdailyfritz.webp` and `homefinalpuzzle.webp`; production CSS still references those sources. `npm run assets:home-mobile --prefix client` uses `cwebp` 1.6.0 with fixed quality 85, method 6, and source-preserving resize. All four exports were inspected against their source images: Fritz face, arms and R-banner survive; puzzle domino chain and lit endpoint survive. There is no UI text baked into either. Existing approved crop previews remain in `reference-specs/`; PR 2 owns actual frame/crop usage.

| Export | Dimensions | Bytes | Budget |
|---|---:|---:|---:|
| `newHOMEdailyfritz-1x.webp` | 400×420 | 10,090 | 90,000 |
| `newHOMEdailyfritz-2x.webp` | 800×840 | 26,130 | 90,000 |
| `homefinalpuzzle-1x.webp` | 420×210 | 4,702 | 80,000 |
| `homefinalpuzzle-2x.webp` | 840×420 | 11,328 | 80,000 |

Solo's three approved source files are untouched. The heavy rejected Home alternates remain unused. No new export is imported or preloaded by production.

## Validation against pre-change baseline

| Gate | PR 0 result | Pre-change comparison |
|---|---|---|
| Client typecheck | PASS | PASS |
| Client lint | PASS; 48 warnings, 0 errors | same 48 warnings |
| Architecture | PASS; 22/22 | PASS; 22/22 |
| Client production build | PASS; 4,871 modules, 17 prerendered routes | PASS |
| Client size check | PASS; AppRoutes 94 KB, BotMatchScreen 249 KB, index 480 KB | same guarded sizes |
| Client Vitest | PASS; 279 files, 2,163 tests | 278 files, 2,161 tests |
| Existing mobile hub E2E | PASS; 10/10 | PASS; 10/10 |
| Existing mobile route/game E2E | PASS; 9/9 | PASS; 9/9 |
| New mobile fixture E2E | PASS; 6/6 | new gate |
| Pre-game draw behavior runner | PASS; four behavior files using `node --import tsx` | npm script failed before assertions; direct tsx loader passed |

The production preload behavior documented in `PRECHANGE_VALIDATION_AND_PERFORMANCE.md` was deliberately left unchanged. Existing E2E screenshot files regenerated during validation were restored to their pre-run state; new diagnostic screenshots from those runs were removed. Unrelated pre-existing dirty files were not edited, staged or committed.
