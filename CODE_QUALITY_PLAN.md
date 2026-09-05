# Racehorse Code Quality Plan

Sibling to `HARDENING_PLAN.md`. That plan hardened Systems 1–13 against
**bug classes** — data corruption, forgery, races. This one is narrower and
softer: it audits code the hardening pass **deliberately parked** (System 9's
5 never-audited areas, D-18) for **engineering quality**, not security.

`ENGINEERING_GUARDRAILS.md` remains the record of what is *structurally
enforced* — Guardrails #2/#3 (INV-16/17) already catch duplicated shared logic
and non-idempotent rating writes; this plan does not re-litigate those, it
covers what a checklist review catches that a CI rule does not.

---

## Current focus

**As of 2026-09-05: Step 1 (read-only current-state map) written for System
9-CQ's 5 parked areas. No fixes. Awaiting human review before Step 2.**

Scope this plan covers (System 9's 5 items formally PARKED at D-18):

1. `client/src/modules/daily-puzzle/` (2 files) — **dead-code question resolved first (below): effectively dead.**
2. `client/src/modules/guided/` (18 files, ~3.5k LOC) — the interactive lesson / authoring runtime.
3. `client/src/match/board/` (7 files, ~250 LOC) — live-match layout primitives. (+ its un-audited sibling `client/src/match/InGameBoardShell.tsx`.)
4. `client/src/match/session/useLiveMatchSession.ts` (409 LOC) — the multiplayer live-match composition hook.
5. `client/src/modules/review/` (2 hooks, ~270 LOC) — post-game analysis / pivotal-review runtime.

**Not in scope:** anything `HARDENING_PLAN.md` already closed; `client/src/learn/`
and `client/src/multiplayer/` internals (CLAUDE.md-protected — but note area 2
imports `learn/` 25 times, so any Step-3 refactor there touches a protected
surface and needs explicit sign-off).

---

## How to use this document

This document records what we found and decided, area by area, for code
quality. It is graded against a **fixed checklist** (below), not against
severity × likelihood the way `HARDENING_PLAN.md`'s gap lists are — the
question here is "would a senior engineer approve this as-is," not "can this
corrupt data."

### The workflow every area follows — copied verbatim from `HARDENING_PLAN.md`'s "Continuing this plan" §2, adapted only where a step's subject differs

1. **Step 1 — Current-state map** (`§CQ9.1.x`). Read-only. Map what each
   file/area does, what depends on it, whether it is reachable at all, and
   every checklist-category observation — as *candidates*, not graded verdicts.
   **No fixes. No grading.** Write it into `§CQ9.1.x`. **Stop and wait for the
   human to review it.**
2. **Step 2 — Graded findings list** (`§CQ9.2`). Every candidate from Step 1
   assigned exactly one grade: **FIX NOW** / **REFACTOR** / **STYLE** /
   **ACCEPT** (definitions below), each tied to a specific file/function and a
   specific checklist category, with the one-line reason. **Stop.** The human
   reviews line-by-line and **ratifies as a Decision `D-N`** (mirror
   `HARDENING_PLAN.md`'s D-3 / D-15 / D-20 — record residual notes so a later
   session does not re-litigate settled points).
3. **Step 3 — Fix** the agreed scope (usually the FIX-NOW findings only; a
   REFACTOR only if the human explicitly greenlights it, since REFACTOR by
   definition touches working code). Design first if the change is structural.
   **Add or extend a test for every behavioural change** — "looks cleaner" is
   never done. A pure dead-code deletion's "test" is the full suite + typecheck
   + `check:architecture` staying green.
4. **Commit.** Reference the commit / test in the checklist item. **Do not
   push** unless the human explicitly says to — committing locally is the
   default. There are no database migrations in this plan's scope (it is
   client-only); if one somehow arises, the `HARDENING_PLAN.md` rule stands —
   the human applies it.
5. **Report back plainly** — what changed, what is still open, what the human
   must authorise (pushes, REFACTOR greenlights). No hedging.

### House rules — the same ones that held through `HARDENING_PLAN.md` Systems 1–13

- **Audit-first, no fixes** until Step 1–2 are written down and graded findings
  are ratified with the human.
- **Verify every claim against the actual code** — never trust a function name,
  a doc comment, a barrel export, or an earlier section of this doc. System 3
  and System 11 each found *ratified* claims that were wrong on a full
  call-site trace. "Likely dead" is a hypothesis to disprove, not a verdict
  (see `§CQ9.1.1` — resolved by tracing the render prop, not the name).
- **Correct the record openly.** When an earlier claim turns out wrong, say so
  in Current focus or as a dated correction note — do not quietly rework around
  it.
- **Reachability is checked the FC-DEAD-1 way** — is it registered in a route /
  nav / render tree with a real (non-default, non-false) prop or flag, not just
  imported. An imported-but-permanently-gated module is *dead* for this plan's
  purposes even though `check:deps` sees the import.
- **Never push** without an explicit instruction.
- **One step per session.** Stop after each numbered step and wait for the
  human's explicit go-ahead. Do not chain Step N and Step N+1.
- **Keep the Current focus line accurate at all times.** Log every non-obvious
  decision in the **Decisions log** (`D-n`) at the bottom.
- **When investigation shows the scope was wrong, say so** in Current focus and
  adjust — don't quietly expand.

### The grading scale (Step 2 assigns exactly one per finding)

| Grade | Meaning |
|---|---|
| **FIX NOW** | Clearly wrong, cheap to fix, no ambiguity. Dead code with zero reachable callers; a swallowed error that hides a real failure; an unsafe cast that is actually unsound. Ships in Step 3. |
| **REFACTOR** | It works and is not a bug, but a senior engineer would not approve it in review as-is — a 95-key grab-bag return, a 459-line file doing four jobs, a barrel exporting 20 internal-only symbols. Only fixed in Step 3 if the human explicitly greenlights it (it touches working code). |
| **STYLE** | Cosmetic, low-value — naming nits, a redundant wrapper component, an inconsistent import style. Recorded, generally not worth a dedicated change. |
| **ACCEPT** | Looks rough but is actually fine, with a stated reason — an `eslint-disable` on a deliberately-narrow effect dep array, `console.log` in a `window.__debug` authoring tool, a feature-flagged-off subsystem that is a real pending feature not abandoned code. |

### The checklist (findings are scored against these 9 categories, not against severity)

1. Dead code / unreachable branches
2. Duplicated logic (beyond what Guardrails #2/#3 already structurally catch)
3. Error handling (swallowed errors, generic catches, unhelpful messages)
4. Type safety (`any`, unsafe casts, unjustified non-null assertions)
5. Size / complexity beyond `check:architecture`'s existing LOC caps (INV-14)
6. Naming / pattern consistency with sibling modules
7. Resource cleanup (listeners, timers, subscriptions)
8. Stale TODO / FIXME / commented-out code
9. Non-security test coverage gaps (wrong-score / UI-glitch-shaped, **not** forgery-shaped — that is `HARDENING_PLAN.md`'s job)

### Per-area structure

Each `§CQ9.1.x` contains, in order: **what it is** / **reachability** / **what
depends on it** / **checklist observations** (categories 1–9, candidates only —
no grades). `§CQ9.2` is the graded findings table (Step 2). `§CQ9.3` is the
Step-3 change plan for the ratified scope. `§CQ9.4` is the resumable checklist.

---

# System 9-CQ: the five parked code-quality areas

Parked at **D-18** (`HARDENING_PLAN.md` §9, 2026-09-05): *"System 9 is not
'exhaustively audited' the way Systems 1–8/10–13 are until these are explicitly
re-opened."* This plan re-opens them for quality only.

## CQ9.1 Current-state map (Step 1 — read-only, 2026-09-05)

### CQ9.1.1 `client/src/modules/daily-puzzle/` — **DEAD-CODE QUESTION: RESOLVED — effectively dead**

**What it is.** Two files: `index.ts` (barrel, 2 exports) and
`useDailyPuzzleLeaderboardSync.ts` (101 LOC). The hook has a single `useEffect`
that, on game-over, upserts the player's score to `daily_puzzle_scores` and
fetches the `daily_puzzle` leaderboard (via `dailyPuzzle/api.ts`).

**Reachability — traced the FC-DEAD-1 way, not from the name.**
- `useDailyPuzzleLeaderboardSync` is imported and *instantiated* by
  `bot/useBotMatchScreenController.ts:127` (`const puzzle = useDailyPuzzleLeaderboardSync({...})`),
  and its result threads into `assembleBotMatchViewModel.ts:285–287`
  (`dailyLeaderboard` / `dailyLeaderboardLoading` / `dailyLeaderboardError`),
  which feeds a `{isDailyPuzzleRun && (…)}` block in `bot/BotGameOverModal.tsx:360`.
- **Every one of those paths is gated on `isDailyPuzzleRun`**, which is
  `Boolean(dailyPuzzleDate)` (`modules/match/hooks/useBotMatchBootstrap.ts:152,281`).
- `dailyPuzzleDate` is an **optional** prop on `BotMatchScreen`
  (`modules/match/contracts/matchScreenProps.ts:16`, `dailyPuzzleDate?: string | null`).
- **Neither of the two `<BotMatchScreen>` render sites** (`routes/soloPlayRoutes.tsx:335`
  and `:467` — the only two in the codebase) passes `dailyPuzzleDate`.
- The screen that *would* set it, `dailyPuzzle/DailyPuzzleScreen.tsx`, is
  **imported by nothing but its own test** — not in `AppRoutes.tsx`, `App.tsx`,
  or any route module.

**Verdict:** `isDailyPuzzleRun` is permanently `false` in production. The hook's
effect early-returns on every render; `upsertDailyPuzzleBestScore` /
`fetchDailyPuzzleLeaderboard` are never called from it; the view-model fields it
produces are always the `dailyFritz` runtime's initial defaults; the UI block
consuming them never renders. This is the client remnant of the **5-slot
`daily_puzzles` ladder decommissioned 2026-09-02** (`HARDENING_PLAN.md` System 3
/ DF-CAND-1; `2026-09-02_daily_puzzle_ladder_decommission.sql` applied to prod).
Same class as **FC-DEAD-1** — wired but structurally unreachable.

**Checklist observations (candidates):**
- **(1) Dead code:** the whole area — plus its blast radius: `dailyPuzzleDate`
  prop, `isDailyPuzzleRun` derivation and its ~10 gate sites, the
  `assembleBotMatchViewModel` puzzle fields, the `BotGameOverModal` puzzle
  block, `dailyPuzzle/DailyPuzzleScreen.tsx` and the sibling
  `DailyPuzzleLadderScreen.tsx` / `DailyPuzzleLegacyInPlayView.tsx` cluster, and
  the `daily_puzzle_scores` / `daily_puzzles` writes in `dailyPuzzle/api.ts`
  (`upsertDailyPuzzleBestScore`, `fetchDailyPuzzleLeaderboard`,
  `getAllDailyPuzzlesForDate`, …). **Step 1 does not attempt the full deletion
  boundary** — that is a Step 2/3 scoping exercise, same as FC-DEAD-1's
  recommendation. The audited 2 files are the leaf.
- **(9) Test coverage:** n/a — deleting dead code, the test is the suite staying
  green.

**Recommended Step-2 treatment:** grade the 2 audited files **FIX NOW** (delete);
scope the wider `daily_puzzle*` client cluster as its own follow-up the way
FC-DEAD-1 was (flag, don't chase the whole boundary in one pass).

---

### CQ9.1.2 `client/src/modules/guided/` — the lesson / authoring runtime

**What it is.** 18 files, ~3,516 LOC. The interactive "guided lesson" and
lesson-authoring engine that drives a `BotMatchScreen` when `isGuidedMode` /
`isAuthoringMode` / their V2 variants are set. Split roughly:
- **coach presentation:** `buildGuidedCoachPresentation.ts` (459),
  `computeGuidedCoachTip.ts` (163), `guidedCoachPresentationTypes.ts` (71)
- **match runtime:** `useGuidedMatchRuntime.ts` (214),
  `useGuidedMatchCommandEffects.ts` (201), `useGuidedMatchRuntimeTypes.ts` (99),
  `guidedPlacementHandlers.ts` (417), `guidedBotMatchHelpers.ts` (298)
- **V2 playback:** `useGuidedV2PlaybackEffects.ts` (280), `guidedV2State.ts` (50),
  `useGuidedV2CoordinationState.ts` (38)
- **V1 replay:** `useGuidedV1ReplayEffect.ts` (125)
- **boot / capture / debug:** `useGuidedLessonBoot.ts` (143),
  `useGuidedMatchCaptureRuntime.ts` (186), `useAuthoringCapture.ts` (430),
  `useGuidedWindowDebugApis.ts` (286)
- **barrel:** `index.ts` (56)

**Reachability.** Live. `useGuidedLessonBoot` + `useAuthoringCapture` are pulled
by `bot/useBotMatchScreenController.ts`; the runtime/effects hooks
(`useGuidedMatchRuntime`, `useGuidedMatchCommandEffects`,
`useGuidedMatchCaptureRuntime`, `useGuidedV2CoordinationState`) are pulled by
`modules/match/hooks/useMatchTurnStack.ts` and
`modules/match/match-turn-stack/*`; `guidedBotMatchHelpers` by
`modules/match/bootstrap/resolveInitialBotMatchState.ts`. `isGuidedMode` is set
by the Learn flow (`learn` context → `setIsGuidedMode`, threaded through
`routes/soloPlayRoutes.tsx`). CLAUDE.md marks `client/src/learn/` as an *active*
system — the guided runtime is its match-side half.

**What depends on it.** Only `bot/*` and `modules/match/*` (verified: no other
top-level area imports `modules/guided`). **25 imports the other direction**,
from `modules/guided/*` into the protected `client/src/learn/` — the coupling is
deep. Any Step-3 restructuring here is a `learn/`-surface change and needs
explicit human sign-off.

**Checklist observations (candidates):**
- **(1) Dead code — candidates, need Step-2 confirmation:**
  - The barrel `index.ts` exports ~40 symbols; **only ~6 are imported outside
    `modules/guided/`** (`useAuthoringCapture`, `useGuidedLessonBoot`,
    `useGuidedMatchRuntime`, `useGuidedMatchCommandEffects`,
    `useGuidedMatchCaptureRuntime`, `useGuidedV2CoordinationState`, +
    `guidedBotMatchHelpers` named helpers). The rest
    (`buildGuidedCoachPresentation`, `computeGuidedCoachTip`,
    `useGuidedV2PlaybackEffects`, `useGuidedV1ReplayEffect`,
    `useGuidedPlacementHandlers`, `useGuidedWindowDebugApis`,
    `buildLessonCoachVm`, `computeActivePlacementMoves`, …) are consumed **only
    internally** — barrel-exported but no external importer. Over-broad public
    surface; not itself dead code (internal consumers exist) but a barrel
    hygiene / encapsulation finding.
  - Not yet checked leaf-by-leaf: whether any *internal* helper in the 459-line
    `buildGuidedCoachPresentation.ts` or the 417-line `guidedPlacementHandlers.ts`
    is genuinely unreferenced. Deferred to Step 2.
- **(2) Duplicated logic:** not yet traced in depth. `guidedBotMatchHelpers.ts`
  re-derives board/scoring-ish concepts (`syncGuidedBoneyardCount`,
  `sameTileKeyMultiset`, `guidedWinnerIdFromScores`) — need to check against
  `@racehorse/game-core` / `match/runtime/botEngine` before Step 2 (Guardrail #2
  / INV-16 only pins the `glicko2` constant pair, not this).
- **(3) Error handling:** not yet sampled beyond the debug file.
- **(4) Type safety:** **clean at first pass** — `grep` for `: any` / `as any` /
  `as unknown as` / `= null!` across all 18 files returns **zero hits**.
- **(5) Size/complexity:** `buildGuidedCoachPresentation.ts` (459),
  `useAuthoringCapture.ts` (430), `guidedPlacementHandlers.ts` (417) all exceed
  the ESLint `max-lines` *warn* threshold (currently `warn` at 500 — so under it,
  but only just) and none are in `check:architecture`'s hard `LOC_CAPS`
  (INV-14). The barrel exporting 40 symbols from 18 files is a structural
  complexity signal. **Candidate: propose adding one or more of these to INV-14's
  LOC_CAPS** so they can't grow further, rather than splitting now.
- **(6) Naming/consistency:** `guidedPlacementHandlers.ts` exports
  `useGuidedPlacementHandlers` (a hook) alongside plain handler builders — mixed
  file role. `guidedV2State.ts` vs `useGuidedV2CoordinationState.ts` vs
  `useGuidedV2PlaybackEffects.ts` — the V1/V2 split runs through many files with
  no single "which version am I" entry point. Candidate for Step 2.
- **(7) Resource cleanup:** `useGuidedWindowDebugApis.ts` attaches
  `window.__guidedFrozenAudit` and `window.__guidedTranscriptAuthoring` and
  **does** clean them up (`delete win.__guidedFrozenAudit` on unmount,
  lines 105 / 258) — looks correct, verify in Step 2. No obvious dangling
  timers/listeners spotted in the sample.
- **(8) Stale TODO / commented-out:** **none** — zero `TODO` / `FIXME` / `HACK` /
  `XXX` and zero commented-out code blocks across all 18 files.
- **(8-adjacent) `eslint-disable`:** **8 `react-hooks/exhaustive-deps`
  disables**, all in `modules/guided/` (`useGuidedV2PlaybackEffects` ×2,
  `useGuidedMatchRuntime` ×2, `useGuidedWindowDebugApis` ×1,
  `useGuidedMatchCaptureRuntime` ×1, `useAuthoringCapture` ×2). Sampled: they are
  the deliberate "run on `handNumber` change only, not on `coach`/`match`
  identity churn" pattern — the trade is a known stale-closure risk. **Likely
  ACCEPT** but each should get a one-line justification comment in Step 2/3 if it
  doesn't have one.
- **(8-adjacent) `console.log` in shipped code:** `useGuidedWindowDebugApis.ts`
  (`[guided-frozen-audit] ready…`, `[guided-transcript-authoring] ready…`,
  `[guided-debug] …`), `useGuidedMatchRuntime.ts` (`[guided-fallback] …`).
  These are authoring/diagnostic breadcrumbs; the ESLint `no-console` rule is
  `warn` (allows `warn`/`error` only), so these are contributing to the 401
  warning budget. **Candidate:** route through `logger` or gate on a dev flag.
- **(9) Test coverage:** **one test file** (`useGuidedLessonBoot.test.tsx`) for
  ~3,516 LOC. The V2 playback effects, the placement handlers, the coach
  presentation builder, the authoring capture — all untested. This is the
  largest single test-coverage gap in the plan's scope. (Note: `bot/` has
  `.behaviorTests.ts` files that touch `useAuthoringCapture` — non-vitest, run
  via `npm run test:bot-hooks` — partial coverage.)

---

### CQ9.1.3 `client/src/match/board/` — live-match layout primitives

**What it is.** 7 files, ~246 LOC of thin presentational React:
`InGameBoardShell` (25), `InGameBoardHud` (39), `InGameBoardFrame` (73),
`MatchBoardCanvas` (24), `MatchLiveLayout` (59), `InGameOverlayStack` (9), and a
barrel (17). `MatchLiveLayout` composes Shell → Hud → Frame → Canvas.

**Reachability.** `MatchLiveLayout` is **load-bearing** — 7 consumers:
`LiveMatchScreen`, `puzzleRush/PuzzleRushPlayView`, `practice/NoBrainerLabScreen`,
`bot/view/layouts/BotMatchLiveLayoutSection`, `components/MatchNblBoardFrame`, and
the (dead) `dailyPuzzle/DailyPuzzleLadderScreen` / `DailyPuzzleLegacyInPlayView`.
`MatchBoardCanvas` has 1 external consumer; `InGameBoardFrame` 1;
`InGameOverlayStack` 1; **`InGameBoardHud` has zero external consumers** (used
only inside `MatchLiveLayout`).

**Checklist observations (candidates):**
- **(1) Dead code — strong candidate:** `InGameBoardHud` is barrel-exported but
  imported nowhere outside `MatchLiveLayout` (its sole internal user). Not
  *unreferenced* but the public export is dead. Minor.
- **(1) Dead code — `InGameOverlayStack`:** the entire component is
  `return <>{children}</>` — a no-op fragment wrapper with one consumer
  (`bot/view/overlays/BotMatchInGameOverlays.tsx`). It adds a named type and a
  barrel entry for zero behaviour. **Candidate STYLE or FIX-NOW-delete.**
- **(2) Duplicated logic + (6) naming — the notable finding:** there is a
  **sibling file `client/src/match/InGameBoardShell.tsx` (307 LOC)** — one
  directory up from `match/board/` — that:
  - is named `InGameBoardShell.tsx` but its exported component is
    **`InGameBoardFrame`** (file name ≠ export name);
  - **also** exports an `InGameBoardShell` component and an `InGameBoardLayout`
    type — so there are now *two* `InGameBoardShell` and *two* `InGameBoardFrame`
    definitions a directory apart;
  - contains a `<main className="nbl-stage walnut-nbl-stage rh-board-stage">`
    block that is a **near-verbatim duplicate** of `match/board/MatchBoardCanvas.tsx`
    (24 LOC) — same classNames, same watermark, same toolbar slot;
  - **is imported by nothing** — `grep` for any import resolving to
    `src/match/InGameBoardShell.tsx` returns zero hits (all `./InGameBoardShell`
    imports resolve to the `match/board/` one).
  So: a **307-line dead file** whose name collides with a live sibling and whose
  body duplicates a live component. **Scope note:** it's `match/` not
  `match/board/`, so technically one level outside the parked item — but it *is*
  "the sibling module" the checklist asks about, and it's the single highest-
  value finding in this area. Flag it; the human decides whether it's in scope.
- **(3) Error handling / (7) cleanup:** n/a — pure presentational, no effects,
  no async, no listeners.
- **(4) Type safety:** clean.
- **(5) Size:** all well under caps.
- **(6) Naming — `InGameBoardFrame` is over-parameterised:** the `match/board/`
  one takes 12 props, 5 of them `*ClassName` escape hatches
  (`studioShellClassName`, `boardZoneClassName`, `handDockClassName`,
  `handStackClassName`, `handFooterClassName`) that its only caller
  (`MatchLiveLayout`) does not pass. Speculative generality. Candidate REFACTOR.
- **(8) TODO / commented-out:** none.
- **(9) Test coverage:** none, and arguably fine (pure layout, no logic) —
  likely ACCEPT.

---

### CQ9.1.4 `client/src/match/session/useLiveMatchSession.ts` — the MP session composition hook

**What it is.** 409 LOC. The composition root for a live *multiplayer* match:
25 `useState`, 24 `useRef`, delegates to 6 sub-hooks (`useTileSelection`,
`useLiveMatchViewModel`, `useTransientRoomUi`, `useLiveMatchActions`,
`useHandRevealSequence`, `useRoomSocketSyncParams`), and returns a **~95-key
object** — nearly every piece of state, every setter, every ref, and every
sub-hook's entire result, passed straight through.

**Reachability.** Live — the multiplayer match screen. **Adjacent to the
CLAUDE.md-protected `client/src/multiplayer/`** ("socket lifecycle code; do not
restructure"); `match/session/` is not literally under that path but is
socket-lifecycle-coupled (`roomSocketSyncParams`, `applyRoomEventMeta`, resync
refs). Any Step-3 change here is high-blast-radius and needs explicit sign-off —
treat it like a `multiplayer/` change.

**What depends on it.** Consumed by the MP match screen composition (via
`match/session` barrel). Its 95-key return is spread into a large prop tree.

**Checklist observations (candidates):**
- **(5) Size/complexity — the headline:** 409 LOC is under the ESLint
  `max-lines` warn (500) and not in INV-14's `LOC_CAPS`, but the **95-key return
  object** is the "a senior engineer wouldn't approve this" smell — it is a
  grab-bag that leaks every internal setter (`setState`, `setLegalMoves`,
  `setCanDraw`, `setHandReveal`, `setRematchRequested`, …) and every internal
  ref to consumers. Candidate REFACTOR (group the return into named
  sub-objects — `state` / `refs` / `actions` / `viewModel`), **not** a split of
  the file itself. High blast radius — REFACTOR only with explicit greenlight.
- **(7) Resource cleanup — looks correct, verify in Step 2:** one unmount
  cleanup effect (lines 302–311) clears the 3 `setTimeout` refs declared in this
  file (`drawSequenceTimeoutRef`, `lastPlayedTileTimerRef`, `handRevealTimerRef`).
  No other timers/intervals/listeners are created directly here (they live in the
  sub-hooks, out of this file's scope). The 3 sibling `useEffect`s that sync
  refs to state (lines 103–113) have no cleanup and need none.
- **(3) Error handling:** `applyJoinResponseGameState` (lines 228–253) returns
  `{ ok: false, nextState: null }` on a failed projection **silently** — no
  `showToast`, no `setError`, no log. The caller presumably handles `ok:false`,
  but a silent projection failure in a recovery path is a candidate finding
  (category 3) — verify the caller in Step 2.
- **(4) Type safety:** `resp.legalMoves as Move[]` and `resp.state ?? null) as GameState | null`
  (lines 230, 245) — casts on socket-ack payloads. `projectMultiplayerGameState`
  validates `state`; `legalMoves` is cast with only an `Array.isArray` guard, no
  element validation. Candidate finding (category 4) — likely ACCEPT if the
  server contract is trusted, but worth a note.
- **(1) Dead code:** none spotted — every state var appears in the return; need
  Step 2 to confirm every *returned* key has a consumer (95 is a lot).
- **(8) TODO / commented-out:** none.
- **(9) Test coverage:** the **sub-hooks are tested** (`useLiveMatchViewModel.test.ts`,
  `useTileSelection.test.tsx`, `useLiveMatchActions.test.ts`,
  `gameplayActionIdentity.test.ts`) but **`useLiveMatchSession.ts` itself — the
  composition, the cleanup effect, `applyJoinResponseGameState` — has no direct
  test.** Candidate coverage gap (category 9).

---

### CQ9.1.5 `client/src/modules/review/` — post-game review runtime

**What it is.** 3 files: `index.ts` (1 line), `useReviewRuntime.ts` (86),
`usePostGamePivotalReview.ts` (186). `useReviewRuntime` computes
`botPostGameReviewEligible` (via `training/pivotalReview/postGameReviewPolicy`)
and wraps `usePostGamePivotalReview`, which owns deferred move-log analysis,
the game-reviewer open/close, and the "pivotal turn review wizard" state.

**Reachability.** `useReviewRuntime` is consumed by
`bot/useBotMatchScreenController.ts` and `modules/match/hooks/useMatchNavigation.ts`
— **live** (the Play-vs-Fritz post-game "review your game" prompt + analyzer).

**Checklist observations (candidates):**
- **(1) Dead code — feature-flagged-off subsystem, needs a call:**
  `PIVOTAL_REVIEW_WIZARD_ENABLED` (`modules/match/types/matchRuntimeTypes.ts:4`)
  is a **hardcoded `const … = false`** (not env-driven). In `useReviewRuntime`
  every `!(PIVOTAL_REVIEW_WIZARD_ENABLED && …)` clause collapses to `true`, and
  `BotMatchModalLayer.tsx:60,66` passes the flag straight to the wizard's
  `enabled` prop. So the wizard UI never renders. Yet `usePostGamePivotalReview`
  still maintains ~9 wizard-only state fields (`pivotalReviewOpen`,
  `pivotalReviewSummary`, `completePivotalTurnReview`, `savePivotalReviewSummary`,
  `pivotalSelection` `useMemo` that runs `selectPivotalTurnsFromAnalysis` on
  every analysis) plus a `training/pivotalReview/` subsystem
  (`pivotalTurnSelector`, `pivotalReviewStorage`, `buildPivotalReviewSession`).
  **Is this a pending feature (ACCEPT) or abandoned (FIX NOW — delete the wizard
  half + the flag + the `training/pivotalReview/` bits that only it uses)?**
  Step 2 needs a human call — same shape as FC-DEAD-1's "revive or remove"
  question. The **non-wizard** half (`postGameAnalysis`,
  `showPostGameReviewPrompt`, `openReviewGameFromPrompt`, the analyzer) **is
  live** and stays regardless.
- **(1) Dead code — the re-export shim:** `src/bot/usePostGamePivotalReview.ts`
  is a one-line `export * from '../modules/review/usePostGamePivotalReview.ts'`
  with **zero importers** — its only consumer is
  `src/bot/usePostGamePivotalReview.behaviorTests.ts` (non-vitest). The module
  moved to `modules/review/`; the old path is a dead compat shim. **Candidate
  FIX NOW** (point the behaviorTest at the real path, delete the shim).
- **(3) Error handling:** `usePostGamePivotalReview` line 84 —
  `.catch(() => { if (!cancelled) setPostGameAnalysisPending(false); })` —
  swallows the analyzer import/run error entirely (no log, no user signal).
  The move-log analyzer failing means the "review your game" prompt silently
  never appears. Candidate finding (category 3) — arguably ACCEPT (review is a
  nice-to-have, not core) but should at least `logger.warn`.
- **(4) Type safety:** clean.
- **(5) Size:** under caps.
- **(6) Naming:** `usePostGamePivotalReview` "owns … pivotal review wizard
  state" per its own docstring, but with the wizard flag off it is mostly "post
  game analysis + analyzer open/close." Name over-promises relative to live
  behaviour. Minor.
- **(7) Cleanup:** the analyzer effect has a correct `cancelled` guard +
  cleanup (lines 72, 88–90). Good.
- **(8) TODO / commented-out:** none.
- **(9) Test coverage:** `useReviewRuntime` and the live `postGameAnalysis`
  path have no vitest coverage (the `bot/*.behaviorTests.ts` touches the hook
  shape only — asserts it is a function and greps its `.toString()`). Candidate
  coverage gap.

---

## CQ9.2 Graded findings list — **Step 2, not started**

Every candidate above gets exactly one grade (FIX NOW / REFACTOR / STYLE /
ACCEPT), a checklist category, a file:line, and a one-line reason. Then the
human ratifies as `D-N`.

## CQ9.3 Step-3 change plan — **not started** (waits on CQ9.2 ratification)

## CQ9.4 Checklist

- [x] **Step 1 — current-state map** for all 5 areas — written 2026-09-05, this section. Read-only, no fixes.
- [x] CQ9.1.1 `modules/daily-puzzle/` dead-or-alive resolved — **dead** (`isDailyPuzzleRun` permanently false; traced from the render prop, not the name).
- [ ] **Step 2 — graded findings list** (`§CQ9.2`) → ratify as `D-N`.
- [ ] **Step 3 — fix the ratified scope.** Commit each area separately. Do not push.

---

# Continuing this plan

*Written for a fresh agent session with no prior context.*

- Read **`## Current focus`** first, then this section, then `§CQ9.1.x` for the
  area in flight.
- **This plan is subordinate to `HARDENING_PLAN.md`.** If a code-quality finding
  turns out to be a security/correctness bug, it stops being this plan's
  business — record it, and hand it to `HARDENING_PLAN.md`'s process (a dated
  finding + the human's call on urgency), same as AD-1 / DF-STALE-1 were handled.
- **One area, one step, then stop.** The 5 areas are independent — they can be
  Step-2'd / Step-3'd in any order once Step 1 is ratified, but still one step
  per session.
- **REFACTOR findings are opt-in.** FIX NOW ships in Step 3 by default; a
  REFACTOR only ships if the human explicitly greenlights that specific one,
  because it changes working code and (for areas 2 and 4) touches a
  CLAUDE.md-protected surface.
- **Deploy / prod facts:** same as `HARDENING_PLAN.md` "Continuing this plan"
  §5 — Render free tier, single instance, frequent restarts, doc-only pushes
  don't deploy. This plan is client-only; a client change *does* trigger a
  Vercel deploy on push.
- **Verification bar:** `npm run typecheck` + full `vitest` (client and server
  separately) + `npm run lint` (401-warning budget) + `npm run check:architecture`
  all green, same as every `HARDENING_PLAN.md` step. A dead-code deletion is
  "done" only when all of those stay green with the code gone.

---

# Decisions log

*(empty — first decision will be D-CQ-1 when Step 2's findings list is ratified)*
