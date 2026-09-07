# Hooks Correctness Plan

**Goal:** Drive `react-hooks/*` ESLint warnings to zero (for the classes that are
genuinely fixable), gate them in CI so they cannot regress, and leave the codebase
ready to adopt the React Compiler.

**Status:** Phase 1 triage complete. Phases 1b–5 not started.

**Branch:** `hooks-correctness`

**Baseline commit:** `869e0712`

**Measured:** 2026-09-06, `cd client && ESLINT_USE_FLAT_CONFIG=false npx eslint src --ext .ts,.tsx`

---

## 1. The actual budget

`client/package.json` runs lint with `--max-warnings 377`. The tree currently
emits **exactly 377 warnings and 0 errors** — the budget is pinned to the
high-water mark with zero headroom, so *any* new warning fails CI today.

| Rule | Count | Fixable by this sweep? |
|---|---:|---|
| `no-console` | 128 | Yes — Phase 1b |
| `react-hooks/refs` | 88 | **Partly** — see §3 |
| `react-hooks/set-state-in-effect` | 51 | Yes — Phase 2 |
| `react-hooks/exhaustive-deps` | 49 | Yes — Phase 3 |
| `max-lines` | **40** | **No** — see §2 |
| `react-hooks/purity` | 11 | Yes — Phase 3 |
| `react-hooks/immutability` | 8 | Yes — Phase 3 |
| `react-hooks/preserve-manual-memoization` | 2 | Phase 5 (React Compiler) |
| **Total** | **377** | |

`react-hooks/*` totals **209**, not the ~190 estimated in the task brief
(`exhaustive-deps` is 49, not 50; the brief's subtotal omitted `max-lines`).

### `react-hooks/*` by rule × feature folder

| folder | refs | set-state | deps | purity | immut | memo | total |
|---|---:|---:|---:|---:|---:|---:|---:|
| `modules/` | 34 | 9 | 14 | · | 4 | 1 | **62** |
| `multiplayer/` | 9 | 6 | 7 | · | 2 | 1 | **25** |
| `(src root — App.tsx)` | 15 | 1 | 4 | · | · | · | **20** |
| `bot/` | 14 | 2 | 2 | · | · | · | **18** |
| `match/` | 4 | 1 | 8 | · | 2 | · | **15** |
| `components/` | · | 2 | 1 | 8 | · | · | **11** |
| `routing/` | 6 | 2 | 3 | · | · | · | **11** |
| `dailyFritz/` | · | 6 | 1 | · | · | · | **7** |
| `puzzleRush/` | 3 | 1 | 1 | 1 | · | · | **6** |
| `auth/` | · | 5 | · | · | · | · | **5** |
| `practice/` | · | 4 | 1 | · | · | · | **5** |
| `social/` | · | 1 | 3 | · | · | · | **4** |
| `home/`, `learn/`, `tournament/` | · | 1–2 ea | 1 ea | 1 | · | · | **3** ea |
| `identity/`, `journey/`, `matchmaking/` | | | | | | | **2** ea |
| `analyzer/`, `friends/`, `ghost/`, `routes/`, `stats/` | | | | | | | **1** ea |
| **TOTAL** | **88** | **51** | **49** | **11** | **8** | **2** | **209** |

79 files carry at least one hook warning. Regenerate the full per-file manifest with:

```bash
cd client && ESLINT_USE_FLAT_CONFIG=false npx eslint src --ext .ts,.tsx \
  --format json -o /tmp/lint.json
```

---

## 2. Finding A — `max-lines` (40) blocks a literal `--max-warnings 0`

**40 of the 377 warnings are `max-lines` (>500 lines), unrelated to hooks.** The
task brief did not account for these. Driving the budget to a literal zero means
splitting 40 files — and the largest offenders are explicitly off-limits:

| file | lines | status |
|---|---:|---|
| `modules/fritz/botHeuristics.ts` | 1635 | |
| `components/Board.tsx` | 1108 | |
| `match/LiveMatchScreen.tsx` | 1029 | |
| `multiplayer/MultiplayerGameShell.tsx` | 980 | **`multiplayer/` — do not restructure** |
| `App.tsx` | 974 | **lines 1480–1530 frozen** |
| `learn/guidedMatch/GuidedMatchRecorderScreen.tsx` | 930 | **`learn/` frozen** |
| `learn/lessonV2.ts` | 895 | **`learn/` frozen** |
| `learning/reasonTagging.ts` | 773 | **`learning/` frozen** |
| …33 more, 501–866 lines | | 8 further files in `multiplayer/` and `learn/`/`learning/` |

**Decision D-1 (recommended, needs approval): do not chase `max-lines`.** Phase 4
gates `react-hooks/*` at zero via a dedicated CI lint invocation and leaves
`max-lines` on a residual, ratcheting budget. Concretely:

```jsonc
// client/package.json
"lint":       "ESLINT_USE_FLAT_CONFIG=false eslint src --ext .ts,.tsx --max-warnings 40",
"lint:hooks": "ESLINT_USE_FLAT_CONFIG=false eslint src --ext .ts,.tsx --max-warnings 0 \
               --rule '{\"no-console\":\"off\",\"max-lines\":\"off\"}'"
```

CI runs both. `lint:hooks` is the regression gate; the 40 in `lint` can only go
down. File-splitting is a separate, later piece of work with its own risk profile
— it is not a hooks-correctness change and must not ride along in this sweep.

---

## 3. Finding B — the 88 `refs` warnings are not 88 bugs

Classifying every `react-hooks/refs` warning against its source line gives four
populations with very different risk and fix strategy:

| # | pattern | count | verdict |
|---|---|---:|---|
| **D** | ref *object* passed into a custom hook / JSX (`useMultiplayerResync({ socketRef, sessionRef, … })`) | **37** | **False positive.** Not fixable in place. |
| **B** | render-phase mirror write (`fooRef.current = foo`) | **25** | Real. Mechanical fix. |
| **C** | `.current` dereferenced during render | **22** | Real. Genuine bug class. |
| **A** | lazy-init singleton (`if (!ref.current) ref.current = new X()`) | **4** | React-sanctioned idiom. |

### Why bucket D is a false positive — verified, not assumed

`App.tsx:358` passes an object literal of ref *objects* (never `.current`) into
`useMultiplayerResync`. The rule flags the whole call site because it cannot see
into the callee. Inside `multiplayer/useMultiplayerResync.ts`, every `.current`
read — lines 89, 98, 176 — sits inside the `useCallback` at line 87 or the
`useEffect` at line 173. **There are zero render-phase ref reads.** The code is
correct; the lint rule is conservative across a function boundary.

Passing a ref object into a custom hook is the standard way to share a ref.
"Fixing" these 37 means changing hook signatures across the multiplayer session
layer — which collides directly with the `client/src/multiplayer/` "do not
restructure" guardrail *and* with HARDENING_PLAN System 9's parked pool
(`useLiveMatchSession.ts`'s composed hooks, explicitly deferred at D-18).

**Decision D-2 (recommended, needs approval):** for bucket D only, apply targeted
`// eslint-disable-next-line react-hooks/refs -- <verified reason>` at each call
site, with the justification naming the callee and stating that its `.current`
reads are effect/callback-only. Each disable is verified individually the way
`useMultiplayerResync` was above — not applied in bulk. Buckets A, B and C get
real fixes.

This is the one place the sweep suppresses rather than fixes, so it needs an
explicit call. The alternative — restructuring the multiplayer hook signatures —
is a much larger, guardrail-violating change that this sweep should not make.
If you'd rather not suppress at all, the honest outcome is that
`react-hooks/refs` gates at 37, not 0.

### Bucket A (4) — `modules/match/hooks/useMatchRuntimeBridge.ts:28`

The documented "avoid recreating ref contents" idiom from the React `useRef`
docs. Safe, but it *does* also destroy-and-recreate on `instanceKey` change
during render, which is a real render-phase side effect. Fix properly by moving
the re-keying to a `useState`-with-key or a `key` prop on the consumer, rather
than suppressing. Treated as a Phase 3 task with a test.

---

## 4. Finding C — `no-console` is not purely mechanical

128 warnings across 46 files: 120 `console.log`, 4 `console.info`, 2
`console.debug`, 2 `console.assert`. Three distinct dispositions:

| bucket | count | action |
|---|---:|---|
| **Tagged telemetry** (`[tournament:attach-client]`, `[hand:ready]`, …) | 94 | Route through `utils/logger.ts` — `logger.operational()` for socket/match lifecycle, `logger.info()` for the rest |
| **Debug tooling** (`renderProfiler`, `layoutDebug`, `botMatchDebug`, `*Diagnostics`) | 17 | Add the files to the existing `no-console: off` override list in `.eslintrc.json` alongside `boardDiagnostics.ts` / `fairnessLog.ts` / `drawAudit.ts` / `mpPerf.ts` |
| **`[TEMP-DIAGNOSTIC]` markers** | 15 | Delete outright — 6 files, all left over from the MP-JIT investigation |
| **`console.assert`** | 2 | `learn/engine/rulesAdapter.ts` — convert to a thrown invariant or delete |

`logger.ts` already exposes `error` / `warn` / `info` / `operational`, and six of
the 46 files already import it while still calling `console.log` — those are the
unambiguous starting point.

---

## 5. Phase plan

Each phase is independently shippable. Stop and report at every boundary.

### Phase 1 — Triage ✅ *(this document)*

- [x] Full rule × folder × file breakdown
- [x] Classify all 88 `refs` warnings by code pattern
- [x] Classify all 128 `no-console` sites by disposition
- [x] Baseline: `npx tsc -b` green, 377 warnings, 0 errors
- [ ] Commit this doc

### Phase 1b — `no-console` (128 → 3)

Phase 1b is deliberately **mechanical only** — its job is to drop the budget fast
and prove the harness. Anything requiring a signature change or a behavioural
guard is pushed to Phase 3, which lands in those files anyway.

The `TEMP-DIAGNOSTIC` bucket turned out to be three subsystems rather than 15
loose logs. Only 12 of the 15 are mechanical:

1. `chore(lint): delete standalone TEMP-DIAGNOSTIC logging` (−9) — `59c0388e`.
   Pure log statements; nothing else read the values.
2. `chore(lint): remove the forced-draw diagnostic subsystem` (−3).
   `forcedDrawPendingDiags` + two record functions + a 30s watchdog in
   `useRoomSocketSync.ts`, and the optional `recordForcedDrawStateEvent` callback
   threaded through `applyProjectionResult.ts`. The defensible signature touch:
   an optional callback whose only implementation was the deleted diagnostic, no
   test covers it, 2 files, no live-path param narrowing. Also fixes two real
   leaks — the pending array grew unboundedly for the life of the socket effect,
   and each forced draw armed an uncancelled 30s timer.
3. `chore(lint): exempt debug-tooling modules from no-console` (−17)
4. `refactor(log): route match/tournament telemetry through logger` (−~60)
5. `refactor(log): route multiplayer + guided telemetry through logger` (−~36)
6. `refactor(learn): replace console.assert with a thrown invariant` (−2)

**Known residual — 4 `no-console` sites in the frozen `learn/` tree.**
`learn/LearnScenarioScreen.tsx:83`, `learn/engine/rulesAdapter.ts:103` (a
`console.assert`), `learn/guidedLessonNotes.ts:463`,
`learn/guidedMatch/guidedMatchLessonLoader.ts:179`. Left untouched: `learn/` is
on CLAUDE.md's never-touch-without-permission list and has active worktrees
against it. **Convert when that system is next touched with permission.** This is
consistent with how `no-console` is handled everywhere else — it never gets a
zero-gate (only `react-hooks/*` does, in Phase 4), so these 4 live permanently
under the ratcheting `npm run lint` budget alongside the other non-hooks
warnings.

**Deferred out of Phase 1b — 3 logs, see Phase 3 unit P3-A below.** The log at
`usePlayAction.ts:117` and the two in `gameplayBlockDiagnostics.ts` stay
byte-for-byte intact, scaffold included. Deleting the `usePlayAction` one without
also removing its 9 now-dead params would *regress* the budget by 7
`no-unused-vars` warnings, and removing them is a signature change in the live
MOVE path — not mechanical work.

No behavioral change intended in Phase 1b. `logger.operational()` adds a Sentry
breadcrumb where a bare `console.log` had none — a deliberate improvement, called
out in the commit body. Verify per commit: `npx tsc -b`, both vitest suites, lint
delta.

### Phase 2 — `set-state-in-effect` (51 → 0)

The bug-bearing class — the one that dropped every multiplayer score toast in
production two days ago. **Template: commit `869e0712`** —
failing test first, idempotent guard via a ref, timer held in a ref cleared only
on unmount.

**Split confirmed against real call sites, not folder names (2026-09-06).** The
folder heuristic said 18 heavy / 33 light. Reading each site moved **13 more to
heavy** — anything in the live game path or auth is heavy regardless of folder.

**HEAVY — 31.** Failing test first, one fix per commit, e2e smoke per folder.

| file | n | why heavy |
|---|---:|---|
| `multiplayer/MultiplayerGameShell.tsx` | 3 | multiplayer shell |
| `modules/guided/useAuthoringCapture.ts` | 2 | `modules/` |
| `modules/guided/useGuidedMatchRuntime.ts` | 2 | `modules/` |
| `auth/useAppSessionUi.ts` | 2 | **auth/session** |
| `routing/useAppRouteState.ts` | 2 | **drives live-match nav** |
| `auth/AuthModal.tsx` · `ChangePasswordModal.tsx` · `UsernameModal.tsx` | 3 | **auth** |
| `App.tsx` L533 | 1 | **room-invite bootstrap + `setAppMode`** |
| `bot/BotMatchScreen.tsx` L42 | 1 | **live bot match** |
| `puzzleRush/PuzzleRushPlayView.tsx` L99 | 1 | **resets live runtime match state** |
| `dailyFritz/useDailyFritzRunController.ts` L358 | 1 | **fires `void continueSet()`** |
| `dailyFritz/useDailyFritzInit.ts` L193 | 1 | **game-mode bootstrap** |
| `identity/usePlayerIdentityModel.ts` L121 | 1 | auth-adjacent |
| `match/session/handReveal/useHandRevealSequence.ts` · `modules/match/hand-lifecycle/useHandRevealScheduler.ts` | 2 | hand lifecycle |
| `modules/daily/useDailyFritzRuntime.ts` · `modules/ghost/useGhostRuntime.ts` · `modules/guided/useGuidedMatchCaptureRuntime.ts` · `modules/review/usePostGamePivotalReview.ts` | 4 | `modules/` runtimes |
| `multiplayer/usePrivateLobbyWinStreak.ts` · `usePrivateMatchLobbyFriends.ts` · `useSocialInviteState.ts` | 3 | `multiplayer/` |
| `tournament/useTournament.ts` L275 · `useTournamentDisplayLabels.ts` L31 | 2 | `tournament/` |

**LIGHT — 18.** Test-first, one commit per folder.
`dailyFritz/DailyFritzLeaderboardScreen.tsx` (4), `practice/NoBrainerLabScreen.tsx` (4),
`journey/lessonHost/JourneyLessonHost.tsx` (2), `analyzer/GameReviewer.tsx`,
`bot/useBotGamePreferences.ts`, `components/GlobalNav.tsx`,
`components/OfflineBanner.tsx`, `ghost/GhostSetupScreen.tsx`,
`home/useHomeCommandCenter.ts`, `social/ActivityFeedPanel.tsx`,
`stats/WeeklyStatsScreen.tsx`.

**FROZEN — 2.** `learn/AuthoringCoachPanel.tsx:45,51`. Same constraint as the
`no-console` residual above: `learn/` is never-touch-without-permission. Convert
when that system is next touched with permission.

31 + 18 + 2 = 51.

### Pass 1 result — A/B/C classification (2026-09-07)

**A = 1, B = 24, C = 25** across the 49 non-frozen sites. Plus **3 bugs found
outside the warning list** (see below).

**A — real bug, fixed this pass (1 of the 49).**
`multiplayer/MultiplayerGameShell.tsx:612` — HUD score pulse stuck on
(`e7ec6843`). Its warning survives the fix, so it is also a B for Pass 2.

**B — mechanically clearable (24).** Synchronous setState that can move to
render-phase adjust, a lazy `useState` initializer, or a `key` remount, with no
behaviour change.
`App.tsx:533` · `auth/AuthModal.tsx:55` · `auth/ChangePasswordModal.tsx:26` ·
`auth/UsernameModal.tsx:35` · `auth/useAppSessionUi.ts:95` ·
`bot/BotMatchScreen.tsx:42` · `identity/usePlayerIdentityModel.ts:121` ·
`modules/daily/useDailyFritzRuntime.ts:107` · `modules/ghost/useGhostRuntime.ts:124` ·
`modules/guided/useAuthoringCapture.ts:106` ·
`modules/guided/useGuidedMatchCaptureRuntime.ts:61` ·
`modules/review/usePostGamePivotalReview.ts:58` ·
`multiplayer/MultiplayerGameShell.tsx:376, :394, :612` ·
`puzzleRush/PuzzleRushPlayView.tsx:99` · `routing/useAppRouteState.ts:86, :102` ·
`analyzer/GameReviewer.tsx:80` · `bot/useBotGamePreferences.ts:70` ·
`components/GlobalNav.tsx:171` · `components/OfflineBanner.tsx:8` ·
`dailyFritz/DailyFritzLeaderboardScreen.tsx:386` ·
`practice/NoBrainerLabScreen.tsx:95`

**C — legitimately in the effect (25).** Reacting to an external system (fetch,
dynamic import, timer, storage, coach engine), or clearing it means restructuring
a System-9-parked hook. These get a justified `eslint-disable-next-line` in
Pass 2 under the D-2 precedent.
`auth/useAppSessionUi.ts:75` (reset-then-fetch) ·
`dailyFritz/useDailyFritzInit.ts:193` · `dailyFritz/useDailyFritzRunController.ts:358`
(fires `void continueSet()`) · `match/session/handReveal/useHandRevealSequence.ts:168`
(drives the auto-progress interval) · `modules/guided/useAuthoringCapture.ts:146`
(deliberate turn-start latch — the code comments say so) ·
`modules/guided/useGuidedMatchRuntime.ts:72` (dynamic import), `:158`
(`coach.resetHand()`) · `modules/match/hand-lifecycle/useHandRevealScheduler.ts:160` ·
`multiplayer/usePrivateLobbyWinStreak.ts:25` ·
`multiplayer/usePrivateMatchLobbyFriends.ts:29` · `multiplayer/useSocialInviteState.ts:79` ·
`tournament/useTournament.ts:275` · `tournament/useTournamentDisplayLabels.ts:31` ·
`dailyFritz/DailyFritzLeaderboardScreen.tsx:272, :277, :307` ·
`ghost/GhostSetupScreen.tsx:128` · `home/useHomeCommandCenter.ts:115` ·
`journey/lessonHost/JourneyLessonHost.tsx:132, :238` ·
`practice/NoBrainerLabScreen.tsx:141, :174, :237` ·
`social/ActivityFeedPanel.tsx:252` · `stats/WeeklyStatsScreen.tsx:22`

### The lint rule did not find the bugs

**3 of the 4 bugs fixed this pass were at sites the rule never flagged.** The
`set-state-in-effect` list pointed at exactly one of them. The others came from a
targeted scan for the real defect signature — *an effect keyed on the raw `state`
object that arms deferred work and cancels it from its cleanup*:

```
effects keyed on raw `state` that arm deferred work:  6
  useHandRevealSequence.ts:116     HAS-CLEANUP   -> BUG (087cdeaf)
  MultiplayerGameShell.tsx:421     HAS-CLEANUP   -> BUG (6c502a26)
  MultiplayerGameShell.tsx:592     no-cleanup    -> the already-fixed pulse
  MultiplayerGameShell.tsx:627     no-cleanup    -> ok
  useMultiplayerPresentation.ts:86 no-cleanup    -> ok (toast, fixed 869e0712)
  useMultiplayerPresentation.ts:143 HAS-CLEANUP  -> BUG (d445f4d5)
```

Every `HAS-CLEANUP` row was a live bug. That scan is the reusable artefact from
this pass, not the rule.

**Bugs found and fixed (all four share one root cause: MP-JIT-2 turned every
gameplay transition into two `state` updates ~45ms apart, and any effect that
defers work and cancels it from cleanup loses that work permanently, because the
re-run's idempotency guard then refuses to re-arm).**

| commit | site | failure |
|---|---|---|
| `e7ec6843` | `MultiplayerGameShell:612` | HUD score pulse stayed lit after every score |
| `6c502a26` | `MultiplayerGameShell:421` | post-game rating stuck `pending` forever; delta never resolved |
| `087cdeaf` | `useHandRevealSequence:116` | hand-over reveal never appeared (1400ms window; `setHandReveal` called 0 times) |
| `d445f4d5` | `useMultiplayerPresentation:143` | multi-tile draw played only its first tile |

`087cdeaf` is the sharpest: the hook was *already given* a shared
`handRevealTimerRef` whose unmount cleanup lives in `useLiveMatchSession`, but it
destructured it as `_handRevealTimerRef` and used a local `const tid` instead.
The correct mechanism was threaded in and bypassed.

**A recurring sub-pattern worth naming:** several auth sites
(`AuthModal.tsx:55`, `ChangePasswordModal.tsx:26`, `UsernameModal.tsx:35`) are the
"reset form state when the modal opens" idiom. React's own guidance is to remount
via a `key` prop or derive during render rather than reset in an effect. Whether a
`key` remount is right here is a real design question per-modal — record the call,
don't apply it mechanically.

### Phase 3 — `refs` + `exhaustive-deps` + `purity`/`immutability`

Group commits by hook family so each diff is one coherent dataflow change.

- `refs` bucket B (25) + C (22) + A (4) — real fixes
- `refs` bucket D (37) — per D-2
- `exhaustive-deps` (49) — **each one is a behavioral question**, not a mechanical
  add. A wrong dep array in `useLiveMatchSession.ts`'s composed hooks introduces a
  render loop. Where the answer is "this effect genuinely should not re-run on
  that dep," the fix is to restructure so the dep is not needed (ref-held latest
  value, or move the read into the handler) — not to suppress.
- `purity` (11) — 8 are in `components/Board.tsx`, but at only 4 distinct lines
  (L671, L687, L694, L697, each reported twice); one cluster, one commit. The
  other 3 are `home/useHomeCommandCenter.ts:319`, `puzzleRush/useRushClock.ts:38`,
  `routes/tournamentRoutes.tsx:101`
- `immutability` (8) — `modules/match/hooks/useHandLifecycle.ts` (L302, L371,
  L685, L698), `match/session/actions/useLiveMatchActions.ts` (L166, L209),
  `multiplayer/MultiplayerGameShell.tsx` (L1005, L1006)

Hardest files, do last and slowly: `useMatchRuntimeBridge.ts`,
`useHandLifecycle.ts`, `useAppRouteState.ts`, `App.tsx`.

#### P3-A — Remove the block-reason diagnostic *(deferred out of Phase 1b)*

One coherent unit, **test-first**, because it is a signature change to a
System-9-parked composed hook in the live MOVE path. Deferred here rather than
done mechanically in Phase 1b: deleting the log alone would regress the budget by
7 `no-unused-vars` warnings, and removing the params is behavioural-risk surface.
Phase 3 lands in `match/session/actions/` anyway — the 7 refs in
`gameplayBlockDiagnostics.ts` generate `react-hooks/refs` warnings this phase owns.

Scope, verified by tracing every occurrence of each identifier:

- 1 log — `usePlayAction.ts:117` (`[TEMP-DIAGNOSTIC] play() blocked by …`)
- 2 logs — `gameplayBlockDiagnostics.ts:102, :121`
- **9 `usePlayAction` params**, each appearing *only* in the param type, the
  destructure, the deleted log, and the dep array: `drawSequenceActive`,
  `flyingTiles`, `pendingUiAction`, `roomRecoveryState`, `isRecoveringConnection`,
  `rejoinInFlightRef`, `pendingActionRef`, plus `diagnoseGameplayBlockReason` and
  `blockConditionAgeMs`
- the `useLiveMatchActions.ts` call-site edit (destructure at L181–185, pass-through
  at L297–298)
- 4 tracking effects + 7 refs in `gameplayBlockDiagnostics.ts`
- `diagnoseGameplayBlockReason` and `blockConditionAgeMs` themselves — their only
  consumer is the deleted log

**`isGameplayActionBlocked` and `setPendingActionRefDiag` stay untouched** — both
are live behaviour, not diagnostics. Write the failing test to guard the MOVE path
first (the score-toast template, `869e0712`).

Note: `gameplayBlockDiagnostics.ts` is misnamed — it exports the live
gameplay-blocking predicate, not diagnostics. `setPendingActionRefDiag`'s name is
likewise inaccurate once the tracking goes. Renaming either touches 4 files; treat
as optional follow-up, not part of P3-A.

### Phase 4 — Gate it

Per D-1: add `lint:hooks` at `--max-warnings 0`, drop `lint` to the residual
`max-lines` count, wire both into the Client Validation CI job.

### Phase 5 — React Compiler — **DO NOT START WITHOUT EXPLICIT APPROVAL**

The 2 `preserve-manual-memoization` warnings already read *"React Compiler has
skipped optimizing this component because the existing manual memoization could
not be preserved"* — `multiplayer/useMultiplayerRoomCallbacks.ts:285` and
`modules/match/hooks/useMatchNavigation.ts:108`. These are the compiler's own
advance notice: both components would be silently skipped by the compiler today.
When greenlit: enable
`babel-plugin-react-compiler`, measure render counts on the live match screen and
hubs before/after, then remove now-redundant manual `useMemo`/`useCallback`.

---

## 6. Verification (repo-specific — these bite)

```bash
cd client && npx tsc -b          # NOT tsc -p, which passes vacuously
cd client && npx vitest run      # client suite
cd server && npx vitest run      # server tests import client source — run both
cd client && npm run lint        # fails on a --max-warnings COUNT, not errors
```

- **e2e:** `cd client && npx playwright test` reuses a dev server already on
  :5173. Kill stray dev servers first or you are testing the wrong code — and it
  rewrites screenshot baselines.
- **CI = 3 jobs:** Server Validation, Client Validation (Typecheck → Lint
  short-circuits the rest on failure), MP Private Authority Soak. A newly-surfaced
  failure may be pre-existing behind an earlier failing step.
- **Render auto-deploys `main` on push.** Push at phase boundaries only, to the
  branch, never half-finished behavioral change to `main`.
- **This working tree is shared with another Claude session — never `git stash`.**

---

## 7. Open decisions

| # | Decision | Recommendation | Status |
|---|---|---|---|
| **D-1** | `max-lines` (40) blocks a literal `--max-warnings 0` | Split the lint script; gate hooks at 0, ratchet `max-lines` | **Needs approval** |
| **D-2** | 37 `refs` warnings are cross-boundary false positives | Targeted, individually-verified `eslint-disable-next-line` with reasons | **Needs approval** |
| **D-3** | `logger.operational()` adds Sentry breadcrumbs where `console.log` had none | Accept — it is the improvement, not a regression | Proposed |
| **D-4** | Per-`exhaustive-deps` behavioral calls | Resolve individually in Phase 3; record non-obvious ones here | Open, ongoing |
