# Refactor Opportunities

Date: 2026-09-09
Scope: structural quality of the shipped codebase — file/function size, duplicated
logic, inconsistent patterns for the same problem, dead abstractions, type-safety
gaps, and unit-test coverage of core logic.

This is the third of the standing audit documents, and it follows the same rule
as `LAUNCH_READINESS_CHECKLIST.md` and `FEATURE_COMPLETENESS_AUDIT.md`:

- **Every closeable item has a concrete "done" you can point at.** Not "clean up
  the API layer" — a specific edit with a specific end state.
- **Genuinely open-ended work is named and deferred**, not left vague or
  smuggled in as a small task.
- **Things that look like a refactor opportunity but aren't** are written down in
  §4 so they don't get re-discovered next pass.

**Nothing here is fixed.** This is a report. It also deliberately does **not**
re-file anything already tracked in `CODE_QUALITY_PLAN.md` (F1–F23, D-CQ-1…6) or
`HARDENING_PLAN.md` §7 (game-core seams) — those are cross-referenced, not
repeated. See §5.

---

## 1. Method

- **File size:** `wc -l` sweep of `client/src` and `server/src` for anything over
  500 lines; cross-checked against the ESLint `max-lines` list
  (`npm run lint --prefix client -f json`, the rule counts code lines not raw
  lines so its numbers are lower).
- **Function/component size:** hook-call count and top-level `export function`
  count per large file; manual read of the largest handful.
- **Duplication:** greps for repeated wrapper shapes (`throwingGet`, local
  `apiFetch`), repeated date arithmetic (`setUTCDate(getUTCDate() ± n)` +
  `toISOString().slice(0,10)`), repeated fetch-state triads
  (`loading`/`error`/`data` `useState` + `useEffect`), and the known prior
  instances (TABS/APP_PRIMARY_TABS drift from `FEATURE_COMPLETENESS_AUDIT` S4;
  the `PuzzleCompletionRow`/`PuzzleScoreRow` client dup, now gone with P1-1).
- **Type safety:** full-tree grep for `any`, `as any`, `as unknown as`,
  `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`.
- **Test coverage:** for every non-test `.ts` over 200 LOC with 3+ exports,
  checked whether any `*.test.*` / `*.behaviorTests.*` file references it by
  basename; manually confirmed the zero-hit ones are pure logic (no React).

---

## 2. Worth doing now — cheap, clear win

### R1 — Four hand-rolled "call the API, throw on error" wrappers

`client/src/api/client.ts` exposes `apiGet` / `apiPost` / `apiDelete` returning
`ApiResult<T>` (`{ data, error, status, errorCode }`) — the "handle the error at
the call site" convention. Four feature API modules independently re-implement a
throw-on-error wrapper over it:

| File | Wrappers |
|---|---|
| `client/src/tournament/tournamentApi.ts:10-26` | `throwingGet` (+ `auth` arg), `throwingPost`, `throwingDelete` |
| `client/src/ghost/api.ts:17-28` | `throwingGet`, `throwingPost` (call `throwGhostError` instead of `throw new Error`) |
| `client/src/features/daily/homeDailySummaryApi.ts:3-7` | `throwingGet` |
| `client/src/social/socialApi.ts:21-25` | `apiFetch` (same shape, plus the `withCachedRequest` layer) |

Every one is 3–5 lines and identical in intent: `await apiGet<T>(path)` →
`if (result.error) throw` → `return result.data as T`.

**Done looks like:** `apiGetOrThrow<T>` / `apiPostOrThrow<T>` / `apiDeleteOrThrow<T>`
in `api/client.ts`, taking the same options object `apiGet` already takes plus an
optional `onError?: (message: string, status?: number) => never` for the ghost
case. The four modules drop their local wrappers and import the shared ones ·
`socialApi`'s `withCachedRequest` is unaffected (it wraps the throwing call, not
`apiGet`) · `tsc -b` green · no behaviour change (same throw, same message).

### R2 — `addDays` on a `YYYY-MM-DD` key, reimplemented five times (server)

The exact fragment
`new Date(\`${key}T00:00:00Z\`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)`
appears independently in:

- `server/src/homeDailySummary.ts:50-54` (`addDateKeyDays`)
- `server/src/generatePuzzles.ts:136-141`
- `server/src/puzzleRush/puzzleStatsSummary.ts:41-45` (`addDays` — added by P1-1)
- `server/src/platform/health/dailyPuzzleGenerationHealth.ts:38-39`
- `server/src/http/stores/dailyFritzHealthSummary.ts:160-161` (the `-1` variant)

`server/src/shared/pacificDate.ts` already exists as the home for
`getPacificDateKey` — a `shiftDateKey(key, deltaDays)` belongs beside it.

**Done looks like:** one `shiftDateKey` (or `addDateKeyDays`) exported from
`shared/pacificDate.ts`, the five call sites switched to it · a unit test for the
month/year-boundary and negative-delta cases · `npm run test --prefix server`
green.

### R3 — `client/src/dailyFritz/api.ts` (891 LOC) is three unrelated modules

It carries, in one file: (a) client-storage cache helpers
(`clearDailyFritzTodayCache`, `clearDailyFritzMatchSnapshots`,
`clearDailyFritzClientStorage`, the cache-prefix constant); (b) error-copy /
error-classification helpers (`DAILY_FRITZ_MISSING_GAME_RECEIPTS_MESSAGE`,
`isRecoverableDailyFritzAuthorityCode`, `formatDailyFritzNextHandUserMessage`,
`isRetryableDailyFritzNextHandError`); (c) the ~11 actual API calls
(`getTodayDailyFritz`, `startDailyFritz`, `nextDailyFritzHand`,
`completeDailyFritz`, …). Only (c) is "the Daily Fritz API". It's the only
`*/api.ts` in the tree flagged by `max-lines` (790 code lines).

**Done looks like:** `dailyFritz/clientStorage.ts` + `dailyFritz/apiErrors.ts`
carved out, `api.ts` keeps only the network calls · every consumer import
updated (mechanical — TypeScript flags a miss) · `tsc -b` + client `test:all`
green · each new file under the 500-line budget so the `max-lines` warning count
drops by one (the budget is pinned at exactly 51 — see §4).

### R4 — `client/src/learning/reasonTagging.ts` (1344 LOC): split the copy tables from the pipeline

The logic is a clean linear pipeline (`extractBoardContext` →
`extractMoveFeatures` → `determinePrimaryReason` / `determineSecondaryReason` →
`buildConceptTags` / `buildRiskFlags` → `generateShortExplanation` /
`generateLongExplanation` → `tagMove`). But ~500 of the 1344 lines are two static
data structures — `SHORT_EXPLANATION_TEMPLATES` (`:838`) and the long-explanation
templates — inlined between the functions.

**Done looks like:** the template maps moved to
`learning/reasonExplanationTemplates.ts` (pure data, no logic), `reasonTagging.ts`
imports them · `learning/` is CLAUDE.md-protected so this needs explicit
greenlight, but it is a pure move with zero behaviour change and TypeScript
proves the templates still typecheck against `CoachingReason` / `PlayerLevel` ·
`tsc -b` + the existing `reasonTagging` test green · file drops ~500 lines.

### R5 — `client/src/practice/noBrainerLogic.ts` (599 LOC) has zero unit tests

Pure state machine for Practice / The Lab — `createPracticeState(hand)`,
`playPracticeMove(state, …)`, `hintForState(state, example)`. No React, no
network, fully deterministic. `FEATURE_COMPLETENESS_AUDIT` §5.1 already flags The
Lab as having *no functional coverage at all*; this is the unit-level half of
that, and it's the cheap half — the module is a textbook pure-function test
target.

**Done looks like:** `noBrainerLogic.test.ts` covering
`createPracticeState` (deal shape), `playPracticeMove` (legal placement advances
state; illegal is rejected; win/stuck terminal states), `hintForState` (returns a
playable tile when one exists, `null` when none) · `check:architecture` 20/20 ·
recorded whether the e2e half stays deferred in `FEATURE_COMPLETENESS_AUDIT` §5.1
or gets promoted.

### R6 — `bot/botHeuristics.ts` one-line re-export shim

`client/src/bot/botHeuristics.ts` is a single line:
`export * from '../modules/fritz/botHeuristics.ts';`. Same shape as the dead
re-export shims F18 / D-CQ-6 removed. Needs a 30-second check of whether anything
still imports `bot/botHeuristics` (vs `modules/fritz/botHeuristics`) — if not,
delete; if a couple do, repoint them and delete.

**Done looks like:** either the shim is gone and imports point at
`modules/fritz/botHeuristics`, or a one-line comment on the shim explaining why
it's a kept alias · `check:deps` edge count drops or is unchanged · `tsc -b`
green.

---

## 3. Worth doing but sizeable — a real project, named and deferred

Same treatment as `CODE_QUALITY_PLAN.md`'s F6 / F12: real, worth doing, not a
task. None of these should be started without its own scoped pass and greenlight.

### D1 — Shared async-data hook — ✅ DONE (2026-09-09)

**The hook:** `client/src/hooks/useAsyncData.ts` (PR #153, `8b6f170f`) —
`useAsyncData(fetcher, deps, { enabled?, errorMessage? })` →
`{ data, loading, error, refetch }`. Run-id + `AbortController` supersession
(drops stale/unmounted responses), stale-`data`-retained refetch, `loading`
derived so a disabled hook always reads false, 10 unit tests. It deliberately
does **not** cache / dedup / stale-while-revalidate across mounts — that stays
`socialApi.withCachedRequest`'s job.

**9 screens migrated (Part B):**

| Batch | PR | Screens |
|---|---|---|
| 1 | #154 `0055964e` | `RatingHistoryPage`, `PuzzleRushLeaderboardScreen`, `DailyFritzLeaderboardScreen` |
| 2 | #155 `138d9ab7` | `WeeklyStatsScreen`, `ActivityFeedPanel`, `GhostSetupScreen` (summary triad only — featured-ghost + friends fetches stay hand-rolled, no loading/error UI) |
| 3 | #156 `caff5e6c` | `DailyFritzHealthAdminScreen`, `DailyFritzLeaderboardRoute`, `PuzzleRushScreen` (`/today` soft-fetch only — the `startPuzzleRush` action path is untouched) |

**Latent bugs fixed in passing** (each flagged in its PR, not blended in):
`DailyFritzLeaderboardScreen`, `DailyFritzHealthAdminScreen`'s refresh, and
`ActivityFeedPanel` all lacked an unmount/stale guard. `ActivityFeedPanel` also:
Retry was permanently broken on success (`error` was never cleared), and it
showed an infinite spinner when signed out.

**Batch 4 — deliberately skipped.** `useSinglePlayerHubStats` and
`MatchFoundOverlay` are data-only (no loading/error UI), already carry `active`
guards, and would gain nothing but consistency from the hook. Not worth the churn.

**Flagged NOT-a-fit — leave hand-rolled. Do not re-propose forcing these into the hook:**

| Screen | Why the hook doesn't fit |
|---|---|
| `LeaderboardScreen` | per-tab "fetch once, never refetch" client cache; 4 resources; one shared loading/error surface |
| `FriendsScreen` | multi-resource (`friends`/`incoming`/`outgoing` + presence map) + 30 s presence poll + socket presence subscription + `loadFriends()` from ~10 mutation handlers |
| `ActivityFeedScreen` | 596-line multi-resource social hub (friends-with-presence, per-friend public profiles, global leaderboard, …) — same class as `FriendsScreen` |
| `NoBrainerLabScreen` | its `error` state is **shared** between the dataset load and gameplay (`startHand` sets/clears it) — needs error-state separation first |
| `usePlayerIdentityModel` | a real 4-source aggregator (profile + insights + rivals + journey) with partial-failure `sourceStatus` semantics and its own tests — not a copy-pasted triad |
| `GlobalNav` friend-count | data-only, writes a module-level `globalNavHudCache`, `.catch → 0` — nav chrome, not a triad |

Out of scope entirely: `App.tsx` (that's D5), `multiplayer/*` and `learn/*` (CLAUDE.md-protected).

### D2 — `client/src/components/Board.tsx` (1266 LOC, 38 hook calls in one component)

The domino board: geometry, zoom/pan, placement-target computation, tile
animations, open-ends rendering, a11y labels — all in one `BoardComponent`. It is
*cohesive* (it is one thing on screen) but 38 `useState`/`useRef`/`useMemo`/
`useCallback`/`useEffect` calls in a single function body is past what one
component should hold, and it carries live interaction rules from
`walnut-live.css` (CLAUDE.md: "do not delete or modify").

**Why it's deferred:** every mode renders this component; the geometry hooks and
the pan/zoom hooks are entangled through shared refs; extracting
`useBoardViewport` / `useBoardGeometry` / `usePlacementTargets` is doable but
each is load-bearing and the regression surface is the entire game. Needs its own
pass with e2e board-interaction coverage in place first.

### D3 — Second-engine / game-core client duplication

`client/src/game/openEndsGeometry.ts` (554 LOC) and
`client/src/modules/match/runtime/botEngine.ts` (571 LOC) re-implement board
geometry, scoring, and legality that `@racehorse/game-core` already owns
(`packages/game-core/src/openEndsGeometry.ts` is 532 LOC of the *same* math, now
drifted — client has extra DEV-audit hooks and issue codes, game-core has doc
comments and a different function order). `client/src/types.ts` re-declares
`Tile` / `Move` / `BoardState` with no structural drift guard.

Same family: `client/src/ranking/glicko2.ts` is a hand-maintained duplicate of
the server's Glicko-2 math (**confirmed drifted** on forfeit-outcome handling),
and the Ghost move-log builders duplicate "loop once per real draw" logic.

**This is all already tracked** — `HARDENING_PLAN.md` §7 (GC-3 / GC-INV-1), §8.3
(RK-3, glicko2), §9 (RT-2, Ghost move-log), and `ENGINEERING_GUARDRAILS.md` §2
("No second implementation of shared logic"). Listed here only so it isn't
re-filed as a fresh refactor finding: it is a known seam with a known owner (the
hardening plan), and consolidating it is a game-correctness project, not a
cleanup.

### D4 — `server/src/rooms.ts` (1437 LOC, 25 exports) and `server/src/generatePuzzles.ts` (1791 LOC)

`rooms.ts` is the multiplayer room lifecycle core — CLAUDE.md-adjacent to the
protected `client/src/multiplayer/`, and the server's largest non-generated
module. `generatePuzzles.ts` is the offline puzzle-pool generator (build-time /
script, not request path). Both are candidates for splitting by concern
(`rooms.ts` → creation / join / state-commit / cleanup; `generatePuzzles.ts` →
generation / validation / IO) but `rooms.ts` in particular is
socket-lifecycle-critical and the server has **no `max-lines` enforcement**
(`--max-warnings 9999`), so there is no ratchet forcing the issue and no cheap
win — it's a deliberate, tested, scoped decomposition or nothing.

**Why it's deferred:** high blast radius (`rooms.ts`), low urgency
(`generatePuzzles.ts` is off the request path). Name it; don't touch it as a
side task.

### D5 — `client/src/App.tsx` (1079 LOC, 54 `useState`/`useRef`)

The composition root. CLAUDE.md protects lines 1480–1530 (multiplayer connection
hooks — "do not move"). Prior work (`useAppRoutesProps`, `useAppRoutesInput`, the
D-CQ-5/6 barrel trims) has been chipping at the prop funnel from the edges;
`FEATURE_COMPLETENESS_AUDIT` S8 (`homeOverlays` unused prop bundle) is one more
loose thread here.

**Why it's deferred:** an App-root god-component is a known shape and the
refactor is maximum blast radius for the whole app. The incremental extractions
already in flight are the right approach; a big-bang restructure is not worth the
risk. Note it, keep chipping via the existing S8 / barrel work.

---

## 4. Looks like an opportunity but isn't — don't re-discover this

- **`client/src/dailyPuzzle/api.ts` (214 LOC) is not dead.** Despite the name and
  the retired ladder, `normalizeBoardState` in it is a live import from
  `learn/engine/rulesAdapter.ts`. The file is *misnamed* (it's board-state
  normalisation, not a daily-puzzle API) but renaming it is churn for no
  functional gain and breaks `git blame` continuity on a legacy-payload
  normaliser that shouldn't need to change. Leave it; the comment at the top
  already explains why it survives.

- **`packages/game-core/src/botHeuristics.ts` (29 LOC) is not a duplicate** of
  `client/src/modules/fritz/botHeuristics.ts` (1931 LOC). It holds only
  `estimateDrawCostFromPublicInfo` and is *deliberately* kept off the game-core
  root barrel (GC-4) so a verifier can't pull the package's one non-integer
  computation into a graded path. Different content, deliberate separation.

- **Type safety is genuinely good — do not spend a pass hunting `any`.** Whole
  tree: 7 explicit `any` (all in `server/src/http/routes/*` around loosely-typed
  Supabase JSON — `fritzChallenges.ts` `set_result`, `ghost.ts` / `ranking.ts` /
  `roomForfeit.ts` `supabaseFetch<any[]>`), 1 `as any`, **0** `@ts-ignore` /
  `@ts-expect-error` / `@ts-nocheck`, 22 `as unknown as` (most are the
  game-core type-boundary in `optimisticPlay.ts` / `reviewBoardState.ts` /
  `moveAnalyzer.ts` — the GC-3 seam again — plus a cluster of
  `as unknown as Record<string, unknown>` in `journeyContentValidation*.ts` that
  is the *correct* idiom for structural introspection of authored content). The
  one spot that would genuinely benefit from a real type is
  `server/src/http/routes/fritzChallenges.ts` `set_result` handling
  (`Record<string, any>` at `:489`, `:593`, `:598` — the challenge-set
  accumulation: `format: 'best_of_3'`, `playerGamesWon`, `games[]`, …). A named
  interface for that shape is ~20 minutes and would catch a field typo;
  `DailyFritzSetResult` in `packages/game-core/src/dtoContracts.ts` is a close
  cousin to model it on. Only worth doing next time that route is touched — not
  a standalone finding.

- **40 files over the `max-lines` budget is real debt, but it's frozen, not
  growing.** `client` lint runs `--max-warnings 51` and the count is *exactly*
  51 (40 `max-lines` + 7 `no-console` + 4 `react-hooks`), so CI already blocks
  any new oversized file. The list (`App.tsx`, `Board.tsx`,
  `MultiplayerGameShell.tsx`, `LiveMatchScreen.tsx`, `botHeuristics.ts`,
  `lessonV2.ts`, `reasonTagging.ts`, `useAuth.ts`, `dailyFritz/api.ts`,
  `TournamentBracketScreen.tsx`, …) is mostly cohesive-but-long feature cores,
  not tangled god-objects. R3 / R4 chip two of the cheapest; the rest belong to
  D2 / D4 / D5 or are simply "big because the feature is big". Do not open a
  blanket "split every 500+ file" pass — the budget makes that unnecessary.

- **`CODE_QUALITY_PLAN.md`'s prior dead-code passes were thorough.** F1
  (`modules/daily-puzzle/`), F8 (`InGameBoardShell.tsx`), F10
  (`InGameOverlayStack`), F18 (dead re-export), D-CQ-5 (`daily_puzzle*`
  bot-plumbing, −438 LOC), D-CQ-6 (barrel 57→14). A fresh `ts-prune` pass this
  session surfaced nothing actionable beyond the R6 one-liner. Dead code is not
  where the remaining value is.

- **The TABS / APP_PRIMARY_TABS nav-table drift** (`FEATURE_COMPLETENESS_AUDIT`
  S4) and the **`PuzzleCompletionRow` / `PuzzleScoreRow` client duplication**
  (closed with P1-1, PR #139) are the two duplication instances from earlier
  work — both already tracked / closed, not re-listed.

---

## 5. Cross-references — already tracked elsewhere, not re-filed

| Item | Tracked in |
|---|---|
| `modules/guided/index.ts` barrel surface | `CODE_QUALITY_PLAN.md` F3 / D-CQ-6 (done) |
| `modules/guided/` test coverage (Tier 2/3) | `CODE_QUALITY_PLAN.md` F6 → issue #126 |
| `useLiveMatchSession.ts` ~95-key return | `CODE_QUALITY_PLAN.md` F12 → issue #127 |
| `useLiveMatchSession.ts` composition test | `CODE_QUALITY_PLAN.md` F15 → issue #128 |
| game-core / server client re-implementations (openEndsGeometry, botEngine, types.ts, `glicko2.ts`, Ghost move-log) | `HARDENING_PLAN.md` §7 (GC-3, GC-INV-1), §8.3 (RK-3), §9 (RT-2); `ENGINEERING_GUARDRAILS.md` §2 |
| `homeOverlays` unused prop bundle; nav-table drift (S4); Journey validator wrapper (S3) | `FEATURE_COMPLETENESS_AUDIT.md` §3 |
| The Lab / Ghost / most-modes end-to-end coverage | `FEATURE_COMPLETENESS_AUDIT.md` §5.1 |

New findings after this go into the normal `CODE_QUALITY_PLAN.md` flow, or to
`HARDENING_PLAN.md` if they turn out to be correctness/security bugs.

---

## 6. The list

**§2 is six cheap, closeable items** (R1–R6) — a few hours each, low risk, most
with zero behaviour change and TypeScript as the safety net — **all six merged
(#143–148).** **§3 is five sizeable projects** (D1–D5) that are real but must not
be done as side tasks — **D1 done (`useAsyncData`, #153–156, 2026-09-09); D2–D5
still open.** **§4 is what to leave alone.** This is a finite list, and this is it.
