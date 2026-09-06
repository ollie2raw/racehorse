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

**As of 2026-09-05: Steps 1–3 done for the FIX-NOW scope. `D-CQ-1` ratified
`§CQ9.2`; F10/F8/F18/F1 shipped as four commits (`b7979243`, `4254a235`,
`459871a5`, `181624b7`), each green, not pushed. Open: REFACTOR/STYLE findings
(per-finding greenlight) and the deferred `daily_puzzle*` client cluster.**

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
- **(2) Duplicated logic — CHECKED, not a finding:** `guidedBotMatchHelpers.ts`'s
  `parseGuidedBoardState` / `parseGuidedTranscriptState` parse the
  **guided-lesson transcript wire format** (`board:empty` sentinel, `[low,high]`
  tuple → `{low,high}` remap) — a different serialization than game-core's
  `BoardState`, not a re-implementation of it. `syncGuidedBoneyardCount` pads a
  tile array with `{low:0,high:0}` placeholders for a *count display* — a
  guided-only presentational helper, no game-core equivalent.
  `guidedWinnerIdFromScores` is a trivial `>=`. **Minor STYLE only (F-misc):**
  there are 3 scattered small multiset helpers — `sameTileKeyMultiset`
  (guided, equality), `multisetDiff` (`learn/guidedAuthoring.ts:365`), and the
  subtract-comment in `modules/bot-turn/embeddedForcedDrawPresentation.ts` — a
  candidate to consolidate into one `tileMultiset` util, low value.
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
- **(1) Dead code + (2) duplicated body + (6) name collision — the headline,
  now fully mapped (investigation 3, human pulled it into scope):**
  `client/src/match/InGameBoardShell.tsx` — **307 LOC, dead, superseded.**
  - **Dead since 2026-05-29.** `git log -S "match/InGameBoardShell'"` shows the
    last commit importing it is `3150655e` ("Consolidate live match layout and
    theme under rh-match-live") — **the same commit that ADDED
    `match/board/MatchLiveLayout.tsx`** (`git log --diff-filter=A`). The
    `match/board/` 6-file decomposition (`InGameBoardShell` + `InGameBoardHud` +
    `InGameBoardFrame` + `MatchBoardCanvas` + `MatchLiveLayout` +
    `InGameOverlayStack`) **replaced** this one mega-file; it was never deleted.
    The two commits touching it since (`05703df3` WebP conversion 2026-08-14,
    `4d04a838` lint sweep 2026-06-17) are repo-wide sweeps, not intentional
    edits.
  - **Zero importers** — confirmed via `git grep`, no `src/match/index.ts`
    barrel, no dynamic/string reference.
  - **Name collision:** file is `InGameBoardShell.tsx` but exports a function
    `InGameBoardFrame` (file name ≠ export), plus `InGameBoardShell` (an
    18-prop mega-component with a `layout: 'studio' | 'walnut-hud' | 'walnut-wrap'`
    union) and `InGameBoardLayout`. So there are two `InGameBoardShell` and two
    `InGameBoardFrame` definitions one directory apart, only the `match/board/`
    set live.
  - **Duplicated body:** its `InGameBoardFrame` is the `<main className="nbl-stage
    walnut-nbl-stage rh-board-stage">` + watermark + toolbar block — a
    near-verbatim duplicate of `match/board/MatchBoardCanvas.tsx` (24 LOC).
  - **Scope note:** `match/` not `match/board/`, one directory outside the D-18
    item — the human explicitly pulled it into this pass (2026-09-05). It is the
    single highest-value finding in the area.
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
- **(3) Error handling — `applyJoinResponseGameState` silent early-return
  (investigation 1: TRACED, verdict GENUINELY BENIGN, NOT a `HARDENING_PLAN.md`
  candidate):** `applyJoinResponseGameState` (lines 228–253) returns
  `{ ok: false, nextState: null }` on a failed `projectMultiplayerGameState`
  **without** any log / toast / `setError` at that site, and returns *before*
  `setState` / `setLegalMoves` / `setCanDraw`. Full trace of what a player
  experiences:
  - **Primary caller** — `joinAckCoordinator.ts:104` — *does* check `ok`:
    `if (!ok && resp.state != null)` → `logger.warn('join', 'room:join
    handshake state failed projection validation — resync scheduled', {roomCode})`
    **and dispatches `RESYNC_NEEDED`**, which refetches authoritative state from
    the server. So at the system level it is observable and self-healing.
  - **Secondary caller** — `MultiplayerGameShell.tsx:1016` (a `useLayoutEffect`
    replaying a *buffered* join response once the shell mounts) — discards the
    return. If that leaves `state` null: the shell has a null-state effect
    (`MultiplayerGameShell.tsx:347`) that clears draw UI but does **not**
    refetch; recovery instead comes from (a) the server's next
    `room:update` / `state:sync` broadcast (any opponent action, or periodic)
    delivering fresh state via `setState`, or (b) socket reconnect re-running
    join.
  - **Can the player cause harm while stuck?** No. A `play` with null `state`:
    `usePlayAction.ts:100` reads `stateRef.current` (null) and `legalMovesRef.current`
    (`[]` — never set); line 130 `legalMovesNow.find(...)` → `undefined` → line 140
    `setActionError('That tile cannot be played there.')` and **returns without
    emitting anything**. Loud, safe no-op. No wrong result, no disputed outcome.
  - **Worst case:** a transient blank/loading board that recovers on the next
    server broadcast or reconnect, with a `logger.warn` in the log.
  **This is a quality finding** (the *function itself* would be clearer with a
  one-line comment "caller schedules resync on `!ok`" or its own `logger.warn`),
  not a hardening one — the recovery is sound and no player-visible wrong state
  or dispute is reachable.
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
- **(1) Dead code — `PIVOTAL_REVIEW_WIZARD_ENABLED` (investigation 2: history
  traced, verdict INCOMPLETE / PARKED beta feature, not abandoned — grade
  ACCEPT with residual notes):**
  - **Never been `true`.** `git grep "PIVOTAL_REVIEW_WIZARD_ENABLED = true"` over
    the last 200 commits on all branches → **zero hits**. `false` on `main` and
    every branch checked. `-S` on the identifier shows only the two large
    "architecture refactor" commits (`99a3c4d5` sprint-1-7, `d9e82c8e`) ever
    touched it — set to `false` at creation, never flipped.
  - **No open trigger is wired.** `setPivotalReviewOpen(true)` **exists nowhere**
    — the only call is `setPivotalReviewOpen(false)` (a reset in
    `useMatchNavigation.ts:141`). So even flipping the flag to `true` would leave
    `pivotalReviewOpen` permanently `false` and `BotPivotalReviewPortal`
    (`if (!enabled || !open || !selection) return null`) rendering nothing. The
    wizard is not just flag-gated, it is **unfinished** — the "open the wizard"
    UI was never built.
  - **But the surrounding feature is actively beta-gated, not abandoned.**
    `97e47ae0` (2026-08-15, ~3 weeks pre-audit): *"fix(beta): hide post-game
    review except for the admin account … The analyzer is not ready for players.
    Keep the normal result overlay, and only show Review Game / Analyze Game
    when the signed-in email matches VITE_ADMIN_EMAIL."* — flipped
    `POST_GAME_REVIEW_VISIBLE true→false` and added `isPostGameReviewEnabled(isAdmin)`.
    The sibling flags in the same file (`LEARN_MODE_VISIBLE`,
    `JOURNEY_MODE_VISIBLE`, `POST_GAME_REVIEW_VISIBLE`) are all actively toggled
    over time — this is a live beta-gating flag file, and the whole post-game
    review area (analyzer + wizard) was *deliberately* deferred for the beta
    with a stated reason.
  - **Verdict: genuinely unclear, weight of evidence = "parked / incomplete beta
    feature."** Grade **ACCEPT** for the flag + wizard state. **Residual notes
    for a future session:** (i) the wizard has **no open trigger** — "flip
    `PIVOTAL_REVIEW_WIZARD_ENABLED = true`" is *not* sufficient to ship it, the
    open UI must be built; (ii) `pivotalSelection` `useMemo` runs
    `selectPivotalTurnsFromAnalysis` on every analysis regardless of the flag —
    small wasted compute for a feature that can't render (separate STYLE
    finding F17).
  - The **non-wizard** half (`postGameAnalysis`, `showPostGameReviewPrompt`,
    `openReviewGameFromPrompt`, the analyzer) **is live** (admin-gated per
    `97e47ae0`) and stays regardless.
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

### CQ9.1.6 the deferred `daily_puzzle*` cluster — Step-1 map (2026-09-05)

**Scope.** The `daily_puzzle*` surface beyond the 2 files F1 already deleted
(`§CQ9.2` deferred-cluster note). **Map only — no deletions.** Server side has
data/cron stakes → **STOP-AND-REPORT triggered** (`§CQ9.1.6.3`).

#### CQ9.1.6.1 Puzzle-naming disambiguation (a finding worth keeping)

"Daily Puzzle" (retired 5-slot **ladder**), "Daily Puzzle Rush" / "Puzzle Rush"
(**live**), and the shared puzzle-**generation** pipeline are three things whose
names collide hard. Every `puzzle`-containing symbol/dir/table, sorted:

| Bucket | Items |
|---|---|
| **DEFINITELY DEAD — retired ladder** | `client/src/dailyPuzzle/` **25 of 33 files** (see 6.2 table) + their 17 `.test.*` · client routes `/daily`, `/daily/leaderboard` (already gone — no route module references them) · `/api/daily-puzzle/*` HTTP routes (already gone — no `registerDailyPuzzleRoutes` in `server/src/index.ts`) · the F1-leftover bot plumbing (`useDailyFritzRuntime.ts:114-116,242-246` misplaced `dailyLeaderboard*` `useState`; `botMatchViewModelTypes` fields; `BotMatchModalLayer` plumbing; `BotGameOverModal`'s `{isDailyPuzzleRun && …}` block; `isDailyPuzzleRun` + `dailyPuzzleDate` prop + ~10 gate sites) |
| **DEFINITELY LIVE — Puzzle Rush** | `client/src/puzzleRush/**` · `server/src/puzzleRush/**` · `server/src/http/routes/puzzleRush.ts` + `puzzleRushStore.ts` (registered `index.ts:592`) · `journey/*Puzzle*` (Learn journey — separate feature) · `stats/components/PuzzlePerformanceSection.tsx` · table **`puzzle_pool`** (Puzzle Rush's puzzle source) · tables `puzzle_rush_*` |
| **DEFINITELY LIVE — shared code reused by Puzzle Rush** (per the "touches both → live" rule) | `client/src/dailyPuzzle/`: `DailyPuzzleSoloHandDock.tsx`, `useResponsiveHandTileSize.ts`, `dailyPuzzlePlayMoveCompletion.ts`, `dailyPuzzleScreenTypes.ts` (transitive), `dailyPuzzleLadderIcons.tsx`, `date.ts`, `types.ts`, `api.ts` — **8 of 33**, imported by `puzzleRush/PuzzleRush{PlayView,Screen,HubView}.tsx` / `home/*` / `learn/engine/rulesAdapter.ts` · `server/src/dailyPuzzle.ts` (`DailyPuzzleSlot` type, `DAILY_PUZZLE_SLOT_INDICES`, `buildDailyPuzzleLeaderboard`) — used by `puzzleRush/grading.ts`, `puzzleRush/leaderboard.ts`, health route · `server/src/dailyPuzzleSubmissionValidation.ts` (`validateDailyPuzzleSubmission`) — **used by `puzzleRush/grading.ts:169`** · `server/src/http/stores/dailyPuzzleStore.ts` (`getUsernameForUserId` → `puzzleRush.ts` route; archive-read fns → stats route) · `server/src/generatePuzzles.ts` (`computeBestPossiblePuzzleScore` → `dailyPuzzle.ts` → Puzzle Rush) |
| **LIVE (read-only archive)** — retired writes, historical SELECT only | tables `daily_puzzle_attempts`, `daily_puzzle_slot_results`, `daily_puzzle_completions` — read by `server/src/social/socialProfile.ts` (profile "puzzles solved" count) + `server/src/http/stores/homeCompletionDates.ts` (streak-calendar frozen history), both service-role, via `listCompleted{DailyPuzzleLadder,LegacyDailyPuzzle}DatesForUser` passed to `registerStatsRoutes`. Client write policies + grants revoked 2026-09-02 (`2026-09-02_daily_puzzle_ladder_decommission.sql`, DF-CAND-1). |
| **AMBIGUOUS → RESOLVED 2026-09-05** | **table `daily_puzzles`** + `gen-puzzles.yml` cron + `seedDailyPuzzleLadder.ts` + `generatePuzzles.ts` + `dailyPuzzleLadderPublish.ts` + `seedPuzzlePool.ts` — traced (6.4 item 2): **KEEP, load-bearing** — `docs/ops/puzzle-rush-deploy.md` documents this as Puzzle Rush's only new-content pipeline. the `/ready` health-route check = **rewritten (de-gate + relabel + horizon-predicate) — ✅ SHIPPED (`4791f736`)**; `dailyPuzzleLadderReadiness.ts` (KEEP — used by `dailyPuzzleLadderPublish.ts`) + `checkDailyPuzzleLadder.ts` (unwired manual CLI) left untouched. The 0-caller `dailyPuzzleStore.ts` attempt-tracking exports + the unmounted `handleDailyPuzzleLadderCronWarm` cron-warm endpoint = **FIX-NOW dead — ✅ SHIPPED (`c1bc286e`, `b132e381`)**. |

Guard test worth keeping: `client/src/puzzleRush/dailyPuzzleIsRush.test.ts` —
source-level asserts the Home "Daily Puzzle" card routes to `puzzleRush`, not the
retired `navigate('daily')`. It `?raw`-imports `DailyPuzzleLadderHubView.tsx` (a
dead file) — that reference needs updating when the dead files go, not deleting
the test.

#### CQ9.1.6.2 Client dead subtree — reachability verdicts (FC-DEAD-1 method)

Method: full transitive-import closure of `client/src/dailyPuzzle/` from the 7
externally-live-imported roots (+`dailyPuzzleScreenTypes`, reached transitively).
Everything outside that closure has **zero non-test importer anywhere in `src/`**
— no route module, no `App.tsx`/`AppRoutes.tsx`, no `lazy()`, no dynamic
`import()`, no `new Worker()`. Confirmed unrouted (`/daily` appears in no route
file).

**25 dead files** (`client/src/dailyPuzzle/`), all verdict **UNREACHABLE**:
`DailyPuzzleScreen.tsx`, `DailyPuzzleLadderScreen.tsx`, `DailyPuzzleLadderHubView.tsx`,
`DailyPuzzleLadderLeaderboardScreen.tsx`, `DailyPuzzleLadderOverlays.tsx`,
`DailyPuzzleLegacyInPlayView.tsx`, `DailyPuzzleLoadingScreen.tsx`,
`DailyPuzzleAdminScreen.tsx`, `dailyPuzzleArchiveLeaderboardHelpers.ts`,
`dailyPuzzleLadderSessionStorage.ts`, `dailyPuzzleLadderSlotSubmission.ts`,
`dailyPuzzleLegacyResultSubmission.ts`, `dailyPuzzleScreenHelpers.ts`,
`dailyPuzzleSlotHelpers.ts`, `ladderHelpers.ts`, `ladderShareCard.ts`,
`ladderSlotRowViewModel.ts`, `presentation.ts`, `streakStorage.ts`,
`useDailyPuzzleArchiveLeaderboard.ts`, `useDailyPuzzleLadderGameplay.ts`,
`useDailyPuzzleLegacyGameplay.ts`, `useDailyPuzzleValidatorWorker.ts`,
`validator.ts`, `validator.worker.ts`.
**8 files stay** (the shared-live set above); deleting the 25 does not touch them
(closure proved no live→dead edge).

**SHIPPED 2026-09-05 (commit `de14ade6`).** Corrections found during the deletion
(the map was close but not exact — verification bar caught the rest):
- **14 dead `.test.*`, not 17** — the map's "17 co-located tests" included
  `DailyPuzzleSoloHandDock.test.tsx`, `dailyPuzzlePlayMoveCompletion.test.ts`,
  `useResponsiveHandTileSize.test.ts`, which test **live** shared files. Kept.
- **`dailyPuzzle.css` (402 selectors) also deleted** — not in the map's file
  count. Imported only by 4 of the deleted screens; exhaustive check: 0 of its
  selectors referenced by any live consumer (`PuzzleRushHubView`'s
  `dpl-ladder-hub` mention is a *comment explaining it deliberately does not use
  it*). Orphan with no bundler entry point once its importers were gone.
- **`presentation.ts` was NOT client-dead-only — a server test imported it.**
  `server/src/dailyPuzzleGeneration.test.ts` imported `getDailyPuzzleStepPresentation`
  / `getDailyPuzzleDisplayTitle` and `readFileSync`'d `DailyPuzzleScreen.tsx`.
  `presentation.ts` still had **0 non-test importers** (client *and* server) — it
  is genuinely dead; the 6 `it`s testing it + the copy-guard `it` were pruned,
  the live generation/readiness cases in that file kept. The map's §CQ9.1.6.2
  closure was client-scoped and should have grepped `server/` too.
- **`api.ts` dead-export removal — done, and it was more than 3.** Removed
  `upsertDailyPuzzleBestScore`, `fetchDailyPuzzleLeaderboard`,
  `getAllDailyPuzzlesForDate` (confirmed 0 callers after the subtree deletion —
  their only refs were in the deleted files + 1 deleted test) plus their now-orphaned
  privates: `DAILY_PUZZLE_TYPE_ORDER`, `UpsertDailyPuzzleBestScoreInput`,
  `sanitizeLeaderboardUsername`, the `logger` import. `DailyPuzzleLeaderboardEntry`
  kept (external type consumer). **Still dead in `api.ts`, left for a follow-up:**
  `getDailyPuzzleForDate`, `getDailyPuzzleByDateSeed`, `upsertDailyPuzzle`,
  `upsertDailyPuzzleCompletion`, `getTodayDailyPuzzleLadder`, `startDailyPuzzleLadder`,
  `submitDailyPuzzleSlot`, `completeDailyPuzzleLadder`, `fetchDailyPuzzleLadderLeaderboard`
  — ~9 more ladder API fns now unused, a within-file prune.
- **`client/src/lib/siteUrl.test.ts`** lost its `buildLadderShareText` import + the
  "signs the Daily Puzzle Ladder share" `it` (dead helper deleted).
- **`client/src/puzzleRush/dailyPuzzleIsRush.test.ts`** — see below.
- **Lint budget ratcheted 401 → 377** (`client/package.json`) — the deleted files
  carried 24 warnings; freed headroom pinned so it can't silently absorb new ones.

Verified: `tsc -b` clean · client vitest **208/1553** (was 222/1640) · server
vitest **218/1288** (was 218/1294) · lint 377/377 exit 0 · `check:architecture`
20/20 CERTIFIED.

**F1 re-sourcing — verified, landed clean.** Traced `181624b7`:
`assembleBotMatchViewModel.ts:289-291` HEAD reads `dailyFritz.dailyLeaderboard{,Loading,Error}`
(not the deleted `puzzle.*`); `useDailyFritzRuntime.ts:114-116` declares the
`useState`s (init `[]`/`false`/`null`), returns them at `:242-246`; **no writer
exists** (the deleted `useDailyPuzzleLeaderboardSync` was the only one), so the
values are frozen at their inits and the `isDailyPuzzleRun`-gated consumer never
renders — behaviour-identical, as claimed.

#### CQ9.1.6.3 Server-side status — **STOP-AND-REPORT**

Per the pass's instruction: a `daily_puzzle*` table, cron, and health check
still receive traffic. This is **not** a client-only cleanup.

- **Cron: `gen-puzzles.yml` is LIVE** — GitHub Actions `schedule: '0 */6 * * *'`
  (every 6h) → `scripts/gen-puzzles.sh` → `server/src/seedDailyPuzzleLadder.ts`
  → generates puzzle content (`generatePuzzles.ts`) and **writes `daily_puzzles`**
  (ladder-slot shape, 365 days ahead).
- **Table `daily_puzzles` — LIVE writes (the cron) + LIVE reads.**
  Read by `dailyPuzzleLadderPublish.ts` (the generator's publish step) and, since
  `4791f736`, by `getFurthestPublishedDailyPuzzleDate` (`dailyPuzzleStore.ts`) for
  the `/ready` `dailyPuzzleGeneration` health snapshot (non-gating — see
  §CQ9.1.6.4 item 2). The old `/ready` reader `listDailyPuzzleSlotsForDate` →
  `assessDailyPuzzleLadderReadiness` (today's-ladder-publish-readiness, gated the
  503) was replaced in that same commit.
- **The pipeline link to Puzzle Rush — TRACED 2026-09-05, then CORRECTED
  2026-09-05. See `§CQ9.1.6.4` item 2 for the full write-up + live numbers + the
  correction note.** `seedPuzzlePool.ts` backfills `puzzle_pool` *from*
  `daily_puzzles`; it is a manual script, run **once at the 2026-08-20 launch and
  never since** (live: `puzzle_pool` = 2284 rows, frozen at the launch-day
  reference). Puzzle Rush reads `puzzle_pool` only — **no `daily_puzzles` read,
  no fallback** — and the pool recycles rather than draining (27 runs ever).
  **The prior "circular dead weight, gradeable FIX NOW for the whole loop"
  verdict was WRONG** — it missed `docs/ops/puzzle-rush-deploy.md`'s "The ladder
  generator must keep running" section, which documents `seedDailyPuzzleLadder.ts`
  as the deliberately-kept **only source of new Puzzle Rush content** + the
  tooling for the thin-tier backlog. **Corrected:** the cron +
  `seedDailyPuzzleLadder.ts` + `generatePuzzles.ts` + `dailyPuzzleLadderPublish.ts`
  + `daily_puzzles` table + `seedPuzzlePool.ts` **KEEP (load-bearing)**; the
  `/ready` health-route check was **rewritten — de-gate + relabel + horizon
  predicate, ✅ SHIPPED `4791f736`** (§CQ9.1.6.4 item 2); the
  0-caller `dailyPuzzleStore.ts` **attempt-tracking** exports (commit `c1bc286e`)
  and the unmounted `handleDailyPuzzleLadderCronWarm` /
  `isAuthorizedDailyPuzzleCronRequest` cron-warm endpoint (commit `b132e381`)
  were FIX-NOW dead — **both now deleted**.
- **HTTP routes: none.** No `registerDailyPuzzleRoutes` in `index.ts`; the
  `/api/daily-puzzle/*` routes are already gone (migration comment confirmed
  against `index.ts`).
- **Archive tables (`daily_puzzle_attempts`, `_slot_results`, `_completions`):**
  live SELECT traffic (stats/profile), writes retired + client grants revoked.
  Dropping these would break the streak calendar / "puzzles solved" count for
  pre-2026-08-20 history — a **data-retention decision**, not a code cleanup.
- **`daily_puzzle_scores` / `daily_puzzle_submissions`** — not referenced by any
  current server code (grep: 0 hits outside migrations). Parked as DF-CAND-3/4 in
  `HARDENING_PLAN.md` — that plan's call.

**Migrations** touching the cluster: `daily_puzzle.sql`, `daily_puzzle_v2.sql`,
`daily_puzzle_ladder_v1.sql`, `2026-08-06_daily_puzzle_five_slot_*` (×2),
`2026-08-12_daily_puzzle_attempts_indexes.sql`,
`2026-08-12_drop_redundant_puzzle_indexes.sql`,
`2026-09-02_daily_puzzle_ladder_decommission.sql`. Migrations are append-only
history — none get deleted; listed for completeness.

#### CQ9.1.6.4 Step-2/3 status

1. **Client subtree — ✅ SHIPPED 2026-09-05** (greenlit). 25 source + 1 CSS + 14
   dead tests deleted; 3 `api.ts` exports + orphaned privates removed;
   `siteUrl.test.ts` / `dailyPuzzleIsRush.test.ts` fixed; one dead `it`-cluster
   in `server/src/dailyPuzzleGeneration.test.ts` pruned (it tested the deleted
   `presentation.ts`); lint budget 401→377. **Still open (small within-file
   follow-up):** ~9 more dead ladder fns in the live `api.ts`; the `'daily'`
   `AppMode` union member (`types.ts:95`) now has no renderer; the F1-leftover
   bot plumbing (`useDailyFritzRuntime` misplaced `dailyLeaderboard*` `useState`,
   `botMatchViewModelTypes` fields, `BotMatchModalLayer` plumbing, `BotGameOverModal`
   `{isDailyPuzzleRun && …}` block, `isDailyPuzzleRun` + `dailyPuzzleDate` prop +
   ~10 gates) — **NOT touched this pass** (still gated on nothing being reachable;
   its own scoped removal).
2. **`daily_puzzles` table + `gen-puzzles.yml` cron + the ladder server files +
   the health-route ladder check — TRACED 2026-09-05.**

   **How Puzzle Rush actually consumes puzzles.** `puzzleRushStore.ts`
   `listPuzzlePoolCandidates` reads **`puzzle_pool` only**, sampled per tier,
   `order=play_count.asc,…` + a per-run Fisher-Yates shuffle → the pool
   **recycles** (least-played-first), it does not drain. The `difficulty.ts`
   "fallback" is **within-pool tier-borrowing** (a thin tier borrows from the
   nearest tier by difficulty), **not** a read of `daily_puzzles`. Grepped every
   Puzzle Rush path: **no direct `daily_puzzles` read, no fallback to it.**
   `grading.ts`'s `poolEntryAsSlot(): DailyPuzzleSlot` is a type-cast, not a
   table read.

   **The only bridge, `seedPuzzlePool.ts`, is a manual script — committed once at
   the 2026-08-20 launch (`5113589f`), never changed, and not wired into any
   cron / deploy hook.** `docs/ops/puzzle-rush-deploy.md` step 3 says "re-run it
   whenever the daily ladder has produced new content" — aspirational, unheeded.

   **Live confirmation (service-role query, 2026-09-05 — RK-8 style):**
   - `puzzle_pool`: **2284 rows**, all `enabled`, all `source=daily_puzzles`;
     tiers `{quick_line: 106, tactical_setup: 104, master_chain: 2074}`.
     **Byte-identical to `puzzle-rush-deploy.md`'s 2026-08-20 `--dry-run`
     reference** → the pool has **not grown one row since launch**.
   - `daily_puzzles`: **2332 rows** (2330 published), newest `created_at`
     **today** for `puzzle_date 2027-09-02` → the cron *is* actively generating
     ~3 rows/day, **~48 rows accumulated since launch that never reached
     `puzzle_pool`.**
   - `rush_runs`: **27 total, ever.** Pool `play_count`: 1882 rows at 0 (82%
     untouched), max observed **3**. At 15 puzzles/run × ~1.5 runs/day it would
     take ~150 days to give every pool puzzle a single play; the pool never
     empties.

   **Verdict (superseded — see the 2026-09-05 correction below).** Puzzle Rush is
   fully self-sufficient off the frozen 2026-08-20 `puzzle_pool` snapshot; fresh
   `daily_puzzles` rows have not reached it since launch. The original write-up
   then called the whole `gen-puzzles.yml` → `daily_puzzles` → health-check loop
   *"circular dead weight, gradeable FIX NOW,"* conditional on "no intent to
   refresh the pool." **That was wrong.**

   ---

   **⚠ CORRECTION — 2026-09-05 (reconciliation pass).** The prior verdict was
   wrong because it **did not read `docs/ops/puzzle-rush-deploy.md` to the end.**
   That doc has two sections the trace missed:

   - **"## The ladder generator must keep running"** — states outright that
     `seedDailyPuzzleLadder.ts` **is not retired even though the ladder UI is**,
     and is *"still the only source of new puzzle content"* for Puzzle Rush
     (`seedDailyPuzzleLadder.ts → daily_puzzles → seedPuzzlePool.ts → puzzle_pool
     → Rush runs`). Turning it off *"degrades quietly — no new content, staler
     rotation, and the `play_count`-based variety spread flattens as every puzzle
     gets played."*
   - **"## Backlog: the two thin tiers cap the mode at three stages"** — an
     explicit (unscheduled) plan to unlock more run stages by generating more
     `quick_line` / `tactical_setup` content **through this exact pipeline**
     (`seedDailyPuzzleLadder.ts` has a `manual` budget built for it) and re-running
     `seedPuzzlePool.ts`.

   Separately confirmed in the same pass: the `quick_line`/`tactical_setup`/
   `master_chain` labels are **internal `puzzle_pool.tier` values**, not
   player-facing — `config.ts` maps them to the live 3-stage **Warm-Up / Building
   / Master** run (`baseSeconds: 120` = 2:00, `puzzlesPerRun: 15`). The human's
   "2 min / 15 puzzles / beginner-medium-hard, no chain tiers" description **is**
   today's live state; there is no unbuilt redesign and no v2 path.

   **Corrected picture:**

   - **KEEP — load-bearing (documented):** `gen-puzzles.yml` cron,
     `seedDailyPuzzleLadder.ts`, `generatePuzzles.ts`, `dailyPuzzleLadderPublish.ts`,
     the **`daily_puzzles` table**, `seedPuzzlePool.ts`. This is the *only* new-
     content source for a mode with a known thin-tier constraint, and the tooling
     the deploy doc's backlog item depends on. Underused since launch (pool frozen
     at 2284 rows) and degrading quietly — **operator-accepted, not dead.**
   - **BORDERLINE → ✅ SHIPPED 2026-09-05 (commit `4791f736`), graded FIX NOW.**
     De-gate + relabel + predicate-repurpose of the `/ready` block, exactly as
     scoped below. `dailyPuzzleLadderReadiness.ts` and `checkDailyPuzzleLadder.ts`
     left untouched.

     **What shipped:**
     - **De-gate:** `dailyPuzzleGeneration.ok` is no longer in `/ready`'s overall
       `ok` expression (`registerHealthRoutes.ts` — `ok = !shuttingDown &&
       requiredEnvOk && supabase.ok && dailyFritzEvents.ok &&
       dailyFritzAuthority.ok`). A stalled content cron can no longer 503 the
       readiness probe. The snapshot stays in `checks.dailyPuzzleGeneration`.
     - **Relabel:** JSON field `dailyPuzzleLadder` → `dailyPuzzleGeneration`; log
       message `'daily-puzzle-ladder readiness alert'` → `'daily-puzzle
       generation pipeline is behind'`; the `legacySinglePuzzleDay` /
       `missingSlotIndexes` shape is gone.
     - **Repurpose predicate:** new `server/src/platform/health/dailyPuzzleGenerationHealth.ts`
       — `assessDailyPuzzleGenerationHealth(todayPt, furthestPublishedDate)` is OK
       iff the furthest **published** `daily_puzzles.puzzle_date` is `>= today +
       DAILY_PUZZLE_GENERATION_MIN_LOOKAHEAD_DAYS` (**30**). `gen-puzzles.yml`
       seeds 363 days out every 6 h, so a healthy pipeline sits far above the
       floor; a genuinely stalled cron crosses it within weeks (was: ~365-day
       blind spot); one bad near-term day never trips it. Adds
       `Sentry.captureException` when it trips (the trace found the old
       `log.error`-only alert was unwatched).
     - **`dailyPuzzleStore.ts`:** `listDailyPuzzleSlotsForDate` (the health route
       was its **sole** caller) replaced by `getFurthestPublishedDailyPuzzleDate`
       (`select puzzle_date … published=eq.true order=puzzle_date.desc limit 1`).
       File stays at 2 live exports (`+ getUsernameForUserId`).
     - **Tests:** `dailyPuzzleGenerationHealth.test.ts` (predicate true/false
       boundary incl. the exact `today + N` / `today + N - 1` edge, zero-rows,
       custom horizon — 13 cases across both new test files);
       `registerHealthRoutes.test.ts` — the **regression guard**: a failing
       `dailyPuzzleGeneration` check leaves `/ready` `200` / `body.ok === true`
       and still fires Sentry. Confirmed to **fail against the pre-change gated
       code** (re-adding `&& dailyPuzzleGeneration.ok` → those 2 assertions turn
       503, test red). A real supabase-probe failure still 503s (unchanged).
     - **Verification:** server `tsc -b` clean, server vitest **218 files / 1293
       tests**, server lint unchanged (201 problems / 62 errors — pre-existing
       backlog, 0 new), client `tsc -b` clean, `check:architecture` **20/20
       CERTIFIED**, client lint 377, client vitest 1553.

     ---
     Original trace (2026-09-05) preserved below for context.

     **What the check actually verified (from code, not the name).**
     `registerHealthRoutes.ts:183-211` — inside `GET /ready` (NOT `/healthz`;
     `/healthz` only does a Supabase DB probe) — calls
     `assessDailyPuzzleLadderReadiness(todayPt, await listDailyPuzzleSlotsForDate(todayPt))`.
     The predicate is `isDailyPuzzleLadderReady` → `findReadyDailyPuzzleLadderSlots(slots) !== null`
     (`dailyPuzzle.ts:289-321`), which requires, for **today's Pacific date** in
     `daily_puzzles`: ≥3 rows; grouped by `set_version`, newest first; the first 3
     sorted slots all `published === true`; their `slotIndex` exactly `[1,2,3]`;
     and **every one of the 3 has `slotMaxPoints > 0` AND `(bestPossibleScore ?? 0) > 0`**.
     `shouldAlert = !ready && isPastLadderReadinessGracePt(runDate, now)` — fires
     only when `runDate === todayPt` **and** it is ≥15 min past Pacific midnight.
     On fire: `log.error({...}, 'daily-puzzle-ladder readiness alert')` with
     `alertReason = "Daily Puzzle ladder for {date} is not publish-ready ({n}/3
     slots, missing: {indexes|'metadata'})"`. **`log.error` only — no
     `Sentry.captureException`** (unlike the `/healthz` DB-probe path).

     **How often it runs / what hits `/ready`.** Not "every `/healthz` hit."
     `/ready` is hit by: (a) `smoke-test.yml` once per deploy (`on: push:[main]`,
     server/client code only — doc pushes don't deploy), and that job asserts
     only `.gameCore`, **never `.dailyPuzzleLadder`**; (b) manual human checks
     (frequent during hardening work). The UptimeRobot monitor and `index.ts`'s
     ~10-min self-ping both target **`/ping`**, not `/ready` (T-17). Render's own
     health-check path is external config, unverified from the repo. So the
     `log.error` is an essentially-unwatched log line.

     **It is checking a reasonable condition, but it is redundant and mis-wired:**
     - The **predicate is not a dead-UI concept** — "3 published, fully-scored
       slots for a date" is exactly the publish gate the KEEP generator itself
       uses: `dailyPuzzleLadderReadiness.ts` (`assessDailyPuzzleLadderReadiness`,
       `normalizePublishedSlotRows`) is imported by **`dailyPuzzleLadderPublish.ts`**
       (a KEEP pipeline file, `:8-10,84,112-133`). Deleting that module is off the
       table; it is load-bearing.
     - **Redundant with existing, better monitoring.** `gen-puzzles.yml` already
       runs a *"Verify today Pacific ladder is publish-ready"* step
       (`seedDailyPuzzleLadder.ts --date TODAY --diagnose`) **every 6 h** in GitHub
       Actions, co-located with the generator, and **fails the workflow visibly**
       if today isn't ready. The `/ready` block is a lower-frequency, inert copy of
       the same check.
     - **Wrong date offset for a generator-health signal.** `gen-puzzles.yml`
       seeds `today-2 … today+363` and **skips already-ready dates**. Today's rows
       were written ~a year ago; a generator that dies *today* leaves this check
       green until ~today+365. As a "did the generator run recently" signal it has
       a ~365-day blind spot.
     - **Real risk — a retired feature's content lag can 503 the readiness probe.**
       `/ready`'s overall `ok` is `… && dailyPuzzleLadder.ok && …`, and
       `dailyPuzzleLadder.ok = readiness.ready || !readiness.shouldAlert`. So if
       today's `daily_puzzles` set is not publish-ready after 00:15 PT, **`GET /ready`
       returns 503** — and if Render's health-check path is `/ready`, a non-urgent
       content-staleness issue becomes an availability event on the free-tier
       single instance (cf. T-17's health-check history).

     **Recommendation (SHIPPED as `4791f736`, above) — REWRITE (small), scoped to the `/ready` block only:**
     1. **De-gate:** drop `dailyPuzzleLadder.ok` from `/ready`'s overall `ok`
        expression (keep the field in the JSON for visibility). Puzzle-content
        staleness must not 503 the server.
     2. **Relabel:** rename the check + message away from "daily-puzzle-ladder
        readiness"/`legacySinglePuzzleDay` (retired-UI framing) to a
        generation-pipeline name.
     3. **Optionally repurpose the predicate** to a lookahead-horizon check
        (`max(daily_puzzles.puzzle_date) >= today + N`), which catches a stalled
        generator within weeks instead of a year and doesn't false-positive on one
        bad day; if kept, add `Sentry.captureException` when it trips so it is
        actually seen.
     - **Keep** `dailyPuzzleLadderReadiness.ts` (load-bearing for
       `dailyPuzzleLadderPublish.ts`) and `checkDailyPuzzleLadder.ts` (harmless
       unwired manual CLI, `check:daily-ladder`; already logged in the server-lint
       backlog) **untouched**.
     - **Not delete:** the correction bars removing observability on a load-bearing
       system, and de-gate+relabel is nearly as cheap while keeping the `/ready`
       field and removing the 503 coupling.
   - **DEAD — ✅ SHIPPED 2026-09-05 (commit `c1bc286e`).** The retired ladder's
     *attempt-tracking* server surface in `dailyPuzzleStore.ts` — a distinct
     concern from the KEEP generation pipeline. Deleted: the greenlit 7
     (`persistDailyPuzzleAttempt`, `createDailyPuzzleAttempt`,
     `createDailyPuzzleSlotResult`, `listDailyPuzzleSlotsForDateWithAutoSeed`,
     `buildDailyPuzzleLeaderboardForDate`, `getDailyPuzzleLadderStreak`,
     `listDailyPuzzleSlotsForAttempt`) + their now-orphaned chain
     (`listDailyPuzzleSlotsForDateAndVersion`, `isRequestPuzzleGenerationEnabled`,
     `listDailyPuzzleAttemptsForDate`, `listAllDailyPuzzleAttemptsForDate`,
     `fetchAttemptsForDate`, `LEADERBOARD_ATTEMPT_LIMIT`, and — surfaced by
     removing `createDailyPuzzleAttempt`, its sole caller —
     `getDailyPuzzleAttempt` + `getDailyPuzzleAttemptById` +
     `listDailyPuzzleSlotResults`) + orphaned imports. `dailyPuzzleStore.ts`:
     353 → ~100 LOC; its only live exports now are `listDailyPuzzleSlotsForDate`
     (health route) and `getUsernameForUserId` (`puzzleRush.ts` route).
     `index.ts` `dailyPuzzleStore` import trimmed 11 names → 1.
     Tests: `dailyPuzzleStore.test.ts` + `dailyPuzzleStore.leaderboardCap.test.ts`
     deleted (covered only removed fns); `leaderboardCircuitBreaker.test.ts` — the
     2 `buildDailyPuzzleLeaderboardForDate` cases removed, its 3 **live**
     `buildDailyFritzLeaderboard` cases kept (whole-file coverage checked, the
     `dailyPuzzleGeneration.test.ts` lesson); `dailyPuzzleGeneration.test.ts` —
     the request-time-gen opt-out `it` removed (tested removed code).
     `puzzleRush/config.ts` + `puzzleRushStore.ts` "Mirrors LEADERBOARD_ATTEMPT_LIMIT"
     comments reworded (the referenced symbol is gone). `dailyPuzzle.ts` STAYS
     (Puzzle Rush's `DailyPuzzleSlot` type / `DAILY_PUZZLE_SLOT_INDICES` /
     `computeBestPossiblePuzzleScore` re-export).
     Verified: server build clean, server vitest **216/1280** (was 218/1288),
     client `tsc -b` / lint / `check:architecture` 20/20 CERTIFIED / vitest 1553.
   - **DEAD — ✅ SHIPPED 2026-09-05 (commit `b132e381`).**
     `handleDailyPuzzleLadderCronWarm` (`express.RequestHandler`) +
     `isAuthorizedDailyPuzzleCronRequest` (its sole caller) — the retired ladder's
     cron-warm HTTP endpoint. Route-registration check (not just static import,
     since Express handlers can be wired indirectly): no `dailyPuzzle.ts` route
     file on main, no `app.get`/`app.post`/router-mount in `server/src` references
     the handler, `index.ts` only mounts `cronLimit` middleware on `/api/cron`.
     The registering route file was deleted in System 3 (`HARDENING_PLAN.md:3304`)
     and now survives only in stale `.claude/worktrees/*` branches. No co-located
     test. Deleted the 2 functions + now-orphaned imports (`express`,
     `ensureDailyPuzzleLadderForDate`, `constantTimeEqualSecret`,
     `getPacificDateKeyDaysFromNow` — each confirmed used only by these two).
     `dailyPuzzleStore.ts` now ~25 LOC: `listDailyPuzzleSlotsForDate` +
     `getUsernameForUserId`. Verified: server `tsc -b` clean, server vitest
     1280/1280, client `tsc -b` / lint 377 / `check:architecture` 20/20 CERTIFIED
     / vitest 1553.

   Net: the item-2 loop is **not** deletable as "dead weight." The ladder
   *attempt-tracking* store surface, the unmounted cron-warm handler, and the
   `/ready` health-route rewrite are **all now shipped** (`c1bc286e`,
   `b132e381`, `4791f736`). **The only thing left open in this cluster:** the
   **archive-table retention decision** (`daily_puzzle_attempts` / `_slot_results`
   / `_completions`, now zero writers) — `HARDENING_PLAN.md`'s call, not this
   plan's.
3. **Archive tables** — retention decision, `HARDENING_PLAN.md`. Note: the client
   write paths into `daily_puzzle_scores` / `daily_puzzle_completions` (via the
   removed `api.ts` `upsert*` fns) are now gone too — those tables have **zero**
   writers anywhere now.

## CQ9.2 Graded findings list — **Step 2, written 2026-09-05, awaiting ratification as `D-CQ-1`**

Every Step-1 candidate assigned exactly one grade. **Nothing here is a
`HARDENING_PLAN.md` candidate** — investigation 1 confirmed the one
recovery-path concern (`applyJoinResponseGameState`) is genuinely benign.

Grades: **FIX NOW** = clearly wrong, cheap, unambiguous, ships in Step 3 by
default · **REFACTOR** = works but a senior wouldn't approve as-is, ships only
with explicit per-finding greenlight (touches working code / protected surface)
· **STYLE** = cosmetic, low value · **ACCEPT** = looks rough, is actually fine.

### FIX NOW

| # | Cat | File | Finding | Why FIX NOW |
|---|---|---|---|---|
| **F1** | 1 | `client/src/modules/daily-puzzle/` (both files) | Dead — `isDailyPuzzleRun = Boolean(dailyPuzzleDate)` is permanently false (no `<BotMatchScreen>` render site passes `dailyPuzzleDate`; `DailyPuzzleScreen` routed nowhere). Client remnant of the 5-slot ladder decommissioned 2026-09-02. | Zero reachable execution. Delete the 2 files + the `useBotMatchScreenController.ts:127,170` wiring + the `puzzle:` field in `createBotMatchViewModelArgs.ts` + the `dailyLeaderboard*` fields in `assembleBotMatchViewModel.ts:285–287` that *only* it feeds. |
| **F8** | 1 / 2 / 6 | `client/src/match/InGameBoardShell.tsx` (307 LOC) | Dead since 2026-05-29 (`3150655e` added `match/board/MatchLiveLayout` and stopped importing this). Zero importers. File name ≠ export (`InGameBoardFrame`); duplicates `MatchBoardCanvas`'s body; name-collides with the live `match/board/` set. | Superseded v1 that the `match/board/` decomposition replaced, never deleted. Delete the file. |
| **F10** | 1 | `client/src/match/board/InGameOverlayStack.tsx` (9 LOC) + barrel entry | The entire component is `return <>{children}</>` — a no-op. One consumer (`bot/view/overlays/BotMatchInGameOverlays.tsx`). | Dead weight: a file, a type, a barrel line, an extra element in the tree for zero behaviour. Inline `<>{children}</>` at the one call site; delete the file + barrel entry. |
| **F18** | 1 | `client/src/bot/usePostGamePivotalReview.ts` (1 line) | Dead re-export shim (`export * from '../modules/review/usePostGamePivotalReview.ts'`). Zero importers; only `bot/usePostGamePivotalReview.behaviorTests.ts` (non-vitest) touches it. | The module moved to `modules/review/`. Point the behaviorTest at the real path; delete the shim. |
| **F22** | 1 | `client/src/modules/guided/buildGuidedCoachPresentation.ts:251–253` (`buildLessonRecommendedTileKey` frozen-lesson branch) | Two defects in one branch. **(a)** No `draw`/`pass` guard — a frozen-lesson step whose authored `chosenMove` is `'draw'`/`'pass'` returns the literal string as a "recommended tile key", surfacing a *"Play draw"* / *"Play pass"* context chip in the coach panel (`playLessonBestMove` and `buildLessonCoachVm`'s frozen `canBestMove` both guard this; this function didn't). **(b)** `.split(':')[0]?.replace('\|', '-')` emits the **hyphen** form (`"6-6"`) while the V2 and transcript branches — and the sole highlight consumer, `bot/BotHandTray.tsx:81` (`lessonRecommendedTileKey === toTileKey(tile)`, pipe form) — use `"6\|6"`. Net effect: **the hand-tray "recommended tile" highlight never matches in frozen V1 lesson mode.** Surfaced during F6 file 3. **Moot on `main` today** — V1 frozen mode (`FROZEN_LESSON_KEY`) is localStorage-only, written solely by the V1 authoring flow, no bundled default; real players get the bundled V2 lesson via `getPublicGuidedMatchPlaybackLesson()`, where `isGuidedFrozenLessonMode` is always false. Same "real but moot until reachable" bucket as F21 — stays in this plan, not `HARDENING_PLAN.md`. | One-line fix (guard `draw`/`pass` → `null`; return `chosenMove.split(':')[0]` unchanged, matching the other two branches). Zero behaviour change while unreachable; mirrors the guard `buildLessonCoachVm` already applies one branch over. Cheaper now than after someone ships a V1 frozen lesson and files a "the coached tile isn't highlighted" bug. Also collapses F23. |
| **F21** | 1 / 3 | `client/src/modules/guided/guidedBotMatchHelpers.ts:28` (`splitCoachingSummaryBlock`) | Reads `match[2]` for the body, but `COACHING_SUMMARY_BLOCK_RE` (`/^@summary\s*\r?\n([\s\S]*?)\r?\n---\r?\n/i`) has **one** capture group — `match[2]` is always `undefined`, so `body` collapses to `''` whenever an inline `@summary … ---` block is present. `parseGuidedLessonCoachContent` then discards the authored coaching body and shows the generic *"Study the board…"* fallback. **Surfaced during F6 file 2.** **Moot today** — no authored content in `src/` uses `@summary`, and `LessonV2Event.coachingSummary` (a struct field) is the live summary path — so it stays in this plan, not `HARDENING_PLAN.md` (same "real but moot until reachable" treatment as the `requireStateDigests` finding). | One-line fix, zero behaviour-change risk while unreachable, and far cheaper than rediscovering it when someone first authors `@summary`-format text. Intended semantics confirmed against the sole consumer chain (`splitCoachingSummaryBlock` → `parseGuidedLessonCoachContent`; no caller uses `match.index` / `match[0].length` for a remainder): `summary` = text between `@summary` and `---`, `body` = everything after the `---` line. |

### REFACTOR (ship only with explicit per-finding greenlight)

| # | Cat | File | Finding | Why not FIX NOW |
|---|---|---|---|---|
| **F12** | 5 | `client/src/match/session/useLiveMatchSession.ts` | ~95-key grab-bag return — leaks every internal `setState*` and every ref to consumers. | Real "senior wouldn't approve" smell, but grouping the return (`{ state, refs, actions, viewModel }`) rewrites a spread consumed across a large socket-adjacent prop tree. High blast radius; `match/session/` is socket-lifecycle-coupled (treat like protected `multiplayer/`). |
| **F19** | 3 | `client/src/modules/review/usePostGamePivotalReview.ts:84` | `.catch(() => setPostGameAnalysisPending(false))` swallows the analyzer import/run failure — the "review your game" prompt then silently never appears, with no log. | Add a `logger.warn`. Small, but it *is* changing error-handling behaviour in a live path — wants a look, not a blind FIX NOW. Low urgency (review is a nice-to-have). **SHIPPED — greenlit + `D-CQ-4` (2026-09-05).** `logger.warn('usePostGamePivotalReview', …, { error })` added in the catch, guarded by `if (cancelled) return` (no warn on unmount/dep-change). Happy path unchanged. **Caveat:** `logger.warn` is DEV-only console (`import.meta.env.DEV`) — this gives grep-ability while debugging, not a production Sentry trace; `reportOptionalChunkFailure` would add a prod breadcrumb if that's wanted later. New vitest `usePostGamePivotalReview.test.tsx` (2 cases: reject → warn fires with the error + pending still clears + analysis null; resolve → no warn + analysis populated). |
| **F3** | 1 / 6 | `client/src/modules/guided/index.ts` | Barrel exports ~40 symbols; only ~6–7 have an importer outside `modules/guided/`. The rest are internal-only. | Trimming the barrel to its real external surface is safe mechanically but `modules/guided/` has 25 imports into protected `learn/` and the barrel is the module's contract — wants a deliberate pass, not a drive-by. |
| **F6** | 9 | `client/src/modules/guided/` (whole area) | ~3,516 LOC, **one** vitest file (`useGuidedLessonBoot.test.tsx`). V2 playback, placement handlers, coach-presentation builder, authoring capture — all untested. | The single largest coverage gap in scope, but writing tests for a live lesson runtime coupled to protected `learn/` is a project, not a step. Needs its own scoped effort + greenlight. |
| **F11** | 6 | `client/src/match/board/InGameBoardFrame.tsx` | 12 props, 5 of them `*ClassName` escape hatches (`studioShellClassName`, `boardZoneClassName`, `handDockClassName`, `handStackClassName`, `handFooterClassName`) that its **only** caller (`MatchLiveLayout`) never passes. | Speculative generality. Trimming is safe but touches a load-bearing layout component (7 downstream consumers via `MatchLiveLayout`) — verify no other caller wants them first. |

### STYLE (recorded, generally not worth a dedicated change)

| # | Cat | File | Finding |
|---|---|---|---|
| **F4** | 8 | `modules/guided/useGuidedWindowDebugApis.ts`, `useGuidedMatchRuntime.ts` | `console.log` in shipped code (`[guided-frozen-audit] ready…`, `[guided-transcript-authoring] ready…`, `[guided-debug] …`, `[guided-fallback] …`). Contributes to the 401-warning lint budget. Route through `logger` or gate on a dev flag. |
| **F9** | 1 | `client/src/match/board/index.ts` | `InGameBoardHud` is barrel-exported but imported only inside `MatchLiveLayout` (same module). Drop it from the barrel; keep the component. |
| **F13** | 3 | `useLiveMatchSession.ts:228–253` | `applyJoinResponseGameState` returns `{ ok: false }` on projection failure with no log at that site (caller `joinAckCoordinator.ts:104` logs + schedules resync — benign, see investigation 1). Add a one-line comment ("caller resyncs on `!ok`") or its own `logger.warn` for grep-ability. |
| **F15** | 9 | `useLiveMatchSession.ts` | No direct test of the composition / the unmount cleanup effect / `applyJoinResponseGameState` (the 6 sub-hooks *are* tested). A thin composition test is nice-to-have. |
| **F17** | 1 | `modules/review/usePostGamePivotalReview.ts:100–103` | `pivotalSelection` `useMemo` runs `selectPivotalTurnsFromAnalysis` on every analysis even though `PIVOTAL_REVIEW_WIZARD_ENABLED` is false and the result can't render. Gate it on the flag. |
| **F-misc** | 2 | guided / learn / bot-turn | 3 scattered small multiset helpers (`sameTileKeyMultiset`, `multisetDiff`, an inline subtract). Consolidate into one `tileMultiset` util. Low value. |
| **F20** | 6 | `modules/review/usePostGamePivotalReview.ts` docstring | Docstring says it "owns … pivotal review wizard state" but with the wizard flag off + no open trigger it is mostly "post-game analysis + analyzer open/close." Name/doc over-promise vs live behaviour. |
| **F23** | 6 | `client/src/modules/guided/buildGuidedCoachPresentation.ts:252` (`buildLessonRecommendedTileKey` frozen branch) | Used `.replace('|', '-')` (single, string-arg) where the sibling `formatLessonTileLabel` uses `.replace(/\|/g, '-')` (global regex). Low-stakes — a `"low\|high"` tile key has exactly one pipe — but the inconsistency masked the F22 format bug (the frozen branch alone emitted the hyphen display form as a *key*). **Resolved in F22's fix** — the `.replace` is deleted; the branch now returns the raw `"low\|high"` key like the V2/transcript branches. |

### ACCEPT (looks rough, is actually fine — reason stated)

| # | Cat | File | Finding | Why ACCEPT |
|---|---|---|---|---|
| **F5** | 8 | `modules/guided/` (8 `react-hooks/exhaustive-deps` disables) | Deliberate "run this effect on `handNumber` change only, not on `coach`/`match` identity churn" pattern. The trade (a known, bounded stale-closure risk) is the correct call for playback-sequencing effects. **Residual:** each disable should carry a one-line `why` comment where it doesn't already (folded into F3's pass if that's greenlit). |
| **F14** | 4 | `useLiveMatchSession.ts:245` | `resp.legalMoves as Move[]` cast with only an `Array.isArray` guard, no element validation. | The server is the move-legality authority (GC-INV-1) — every move is re-validated server-side regardless of what the client's `legalMoves` array contains. Client-side element validation would be pure defense-in-depth against a benign display glitch. `state` *is* validated (`projectMultiplayerGameState`). |
| **F16** | 1 | `PIVOTAL_REVIEW_WIZARD_ENABLED` + the wizard half of `usePostGamePivotalReview` + `training/pivotalReview/pivotalTurnSelector` / `pivotalReviewStorage` / `BotPivotalReviewPortal` / `BotReviewSummaryPortal` | Feature-flagged-off + **unfinished** (no `setPivotalReviewOpen(true)` anywhere). | Investigation 2: parked, not abandoned — it lives in an *actively-toggled* beta-gate flag file, and the sibling post-game-review feature was *explicitly* deferred for beta as recently as 2026-08-15 (`97e47ae0`, "the analyzer is not ready for players"). **Residual note (must survive to a future session):** flipping the flag is NOT sufficient to ship the wizard — the "open" UI was never built. |

### daily-puzzle wider cluster — deferred scope (like FC-DEAD-1), not a graded finding yet

F1 deletes the 2 audited `modules/daily-puzzle/` files. The surrounding dead
`daily_puzzle*` **client** cluster — `dailyPuzzle/DailyPuzzleScreen.tsx`,
`DailyPuzzleLadderScreen.tsx`, `DailyPuzzleLegacyInPlayView.tsx`,
`DailyPuzzleLadderLeaderboardScreen.tsx`, the `daily_puzzle_scores` /
`daily_puzzles` write paths in `dailyPuzzle/api.ts`
(`upsertDailyPuzzleBestScore`, `fetchDailyPuzzleLeaderboard`,
`getAllDailyPuzzlesForDate`), the `dailyPuzzleDate` prop and its ~10
`isDailyPuzzleRun` gate sites — is a **separate deletion pass**, scoped and
graded on its own, the same way FC-DEAD-1 flagged the Fritz-Challenge cluster
rather than chasing the whole boundary in one commit. Recorded here so it is
not lost. `daily_puzzle*` prod tables and any server references stay
`HARDENING_PLAN.md`'s call, not this plan's.

**Step-1 map written + client half SHIPPED — `§CQ9.1.6` (2026-09-05).**
25 dead `client/src/dailyPuzzle/` source files + `dailyPuzzle.css` + 14 dead
tests deleted (greenlit); 3 dead `api.ts` exports + orphaned privates removed;
2 client tests + 1 server test fixed; lint budget 401→377. **8 `dailyPuzzle/`
files are shared-live with Puzzle Rush** and stayed. **Server half TRACED
then CORRECTED 2026-09-05** (`§CQ9.1.6.4` item 2): Puzzle Rush reads
`puzzle_pool` only, off the frozen 2026-08-20 snapshot (never topped up;
`seedPuzzlePool.ts` run once at launch), no `daily_puzzles` fallback. The
**first** verdict — "circular dead weight, gradeable FIX NOW for the whole
cron/ladder loop" — **was wrong**: it missed
`docs/ops/puzzle-rush-deploy.md`'s "The ladder generator must keep running"
section, which documents the generator as the deliberately-kept **only source
of new Puzzle Rush content** + the tooling for the thin-tier backlog.
**Corrected:** `gen-puzzles.yml` cron + `seedDailyPuzzleLadder.ts` +
`generatePuzzles.ts` + `dailyPuzzleLadderPublish.ts` + `daily_puzzles` table +
`seedPuzzlePool.ts` = **KEEP, load-bearing**.

**Server dead-surface cleanup — ✅ SHIPPED 2026-09-05, three passes:**
- The 0-caller `dailyPuzzleStore.ts` **attempt-tracking** exports
  (`persistDailyPuzzleAttempt`, `createDailyPuzzleAttempt`,
  `createDailyPuzzleSlotResult`, `listDailyPuzzleSlotsForDateWithAutoSeed`,
  `buildDailyPuzzleLeaderboardForDate`, `getDailyPuzzleLadderStreak`,
  `listDailyPuzzleSlotsForAttempt`) + orphaned chain — commit `c1bc286e`.
- `handleDailyPuzzleLadderCronWarm` + `isAuthorizedDailyPuzzleCronRequest` (the
  unmounted cron-warm endpoint; route-registration check confirmed 0 mounts) +
  orphaned imports — commit `b132e381`.
- The `/ready` health-route check — de-gate + relabel + horizon-predicate rewrite
  (`dailyPuzzleLadder` → `dailyPuzzleGeneration`; no longer gates the 503; alerts
  on `max(daily_puzzles.puzzle_date) < today + 30d` via Sentry) — commit
  `4791f736`. New `dailyPuzzleGenerationHealth.ts` + 2 test files (incl. a
  regression guard proven to fail against the old gated code).
  `dailyPuzzleLadderReadiness.ts` + `checkDailyPuzzleLadder.ts` left untouched.
  `dailyPuzzleStore.ts` stays at 2 live exports
  (`getFurthestPublishedDailyPuzzleDate` + `getUsernameForUserId`).

**This cluster is now closed except for one named item:**
1. **Archive-table retention decision** (`daily_puzzle_attempts` /
   `_slot_results` / `_completions`, now zero writers) — `HARDENING_PLAN.md`'s
   call, not this plan's.

F1-leftover bot plumbing (client) not touched — its own scoped removal.

## CQ9.3 Step-3 change plan

**FIX-NOW set shipped 2026-09-05 (D-CQ-1), four separate commits, order
F10 → F8 → F18 → F1 (widest blast radius last). Not pushed.**

| # | Commit | Deleted / changed | Touched beyond the named file |
|---|---|---|---|
| **F10** | `b7979243` | `match/board/InGameOverlayStack.tsx` + its 2 barrel exports; inlined `<>{children}</>` at `BotMatchInGameOverlays.tsx` | just the one call site (expected) |
| **F8** | `4254a235` | `src/match/InGameBoardShell.tsx` (307 LOC) | none — zero importers |
| **F18** | `459871a5` | `bot/usePostGamePivotalReview.ts` (dead re-export shim) | `bot/usePostGamePivotalReview.behaviorTests.ts` import redirected to `modules/review/usePostGamePivotalReview.ts` (as instructed) |
| **F1** | `181624b7` | `modules/daily-puzzle/` (both files) | `useBotMatchScreenController.ts` (drop import + hook call + `puzzle` arg), `createBotMatchViewModelArgs.ts` (drop `puzzle` type), `assembleBotMatchViewModel.ts` (3 view-model fields **re-sourced** `puzzle.*` → `dailyFritz.*`, not deleted — behaviour-identical since the hook was a pure pass-through) |

**F1 pre-commit check (as instructed — "confirm nothing outside
`modules/daily-puzzle/` reads the `dailyLeaderboard*` fields"):** traced fully.
The `dailyLeaderboard` / `dailyLeaderboardLoading` / `dailyLeaderboardError`
state is a **misplaced piece of daily-*puzzle* state living in
`useDailyFritzRuntime`** (`useState` at lines 114–116). Written only by the
deleted hook (dead effect) and by a mode-agnostic reset in
`useMatchNavigation.ts:132–134`. **Read** only by
`assembleBotMatchViewModel.ts:285–287` → `BotMatchModalLayer` → the
`{isDailyPuzzleRun && …}` "Today's Top Scores" block in `BotGameOverModal`,
which never renders (`isDailyPuzzleRun` permanently false). No Daily Fritz
feature reads them — Daily Fritz uses the separate `dailyFritzLeaderboard` /
`dailyFritzRank`. So: **no live reader.** Kept the plumbing (re-sourced, not
deleted-under) so the deferred `daily_puzzle*` cluster pass can remove the
whole surface at once rather than half here.

**Deferred `daily_puzzle*` client cluster** (its own scoped pass, per `§CQ9.2`):
the `dailyLeaderboard*` `useState` in `useDailyFritzRuntime` + its resets in
`useMatchNavigation`, `botMatchViewModelTypes.ts:277–279`,
`BotMatchModalLayer.tsx:132–134`, the `BotGameOverModal` block, the
`dailyPuzzleDate` prop + ~10 `isDailyPuzzleRun` gates, and
`dailyPuzzle/DailyPuzzleScreen.tsx` / `DailyPuzzleLadderScreen.tsx` /
`DailyPuzzleLegacyInPlayView.tsx` / the `dailyPuzzle/api.ts` write paths.

**REFACTOR / STYLE items** — not touched; await explicit per-finding greenlight.

## CQ9.4 Checklist

- [x] **Step 1 — current-state map** for all 5 areas — written 2026-09-05. Read-only, no fixes.
- [x] CQ9.1.1 `modules/daily-puzzle/` dead-or-alive resolved — **dead**.
- [x] Investigation 1 — `applyJoinResponseGameState` silent failure traced — **benign, not a `HARDENING_PLAN.md` candidate** (`§CQ9.1.4`).
- [x] Investigation 2 — `PIVOTAL_REVIEW_WIZARD_ENABLED` history traced — **parked/incomplete beta feature, ACCEPT** (`§CQ9.1.5`).
- [x] Investigation 3 — `client/src/match/InGameBoardShell.tsx` mapped into scope — **dead since 2026-05-29, FIX NOW** (`§CQ9.1.3` / F8).
- [x] **Step 2 — graded findings list** (`§CQ9.2`, 19 findings + 1 deferred cluster) — written 2026-09-05.
- [x] **Step 2 ratification** — `D-CQ-1` (2026-09-05): FIX-NOW scope only (F1, F8, F10, F18).
- [x] **Step 3 — FIX-NOW scope shipped** — F10 `b7979243` · F8 `4254a235` · F18 `459871a5` · F1 `181624b7`. Each green (typecheck + full vitest 217/1502 + lint 401/401 + `check:architecture` 20/20). Not pushed.
- [ ] REFACTOR / STYLE findings — await per-finding greenlight. (Shipped so far: F19 `D-CQ-4`. F21/F22/F23 shipped via the F6 pass, `D-CQ-2`/`D-CQ-3`. Still held: F3, F6-Tier-3, F11, F12.)
- [ ] Deferred `daily_puzzle*` client cluster — its own scoped pass.
- [x] **F21** (`splitCoachingSummaryBlock` dropped-body bug, surfaced during F6 file 2) — FIX NOW, fixed + ratified `D-CQ-2`. One-line function fix, shared regex untouched, verified green. Not pushed.
- [x] **F22** (`buildLessonRecommendedTileKey` frozen branch: no draw/pass guard + hyphen-vs-pipe key format → dead hand-tray highlight in frozen V1 mode; surfaced during F6 file 3) — FIX NOW, fixed + ratified `D-CQ-3`. Moot on `main` (frozen V1 mode is author-machine only). Not pushed.
- [x] **F23** (`.replace('|','-')` vs `formatLessonTileLabel`'s `/\|/g` in the same file) — STYLE; resolved by F22's fix (the `.replace` is gone). Logged for the record.
- [~] **F6 — guided module test coverage** greenlit 2026-09-05. Scoping pass done (`§CQ9.5`). Tier 1 file 1 landed: `guidedTestFixtures.ts` + `guidedV2State.test.ts` (18 cases — all 6 `resolveNextPlayerAfterV2Event` branch combos, `parseV2EventHands` malformed-key filtering, `buildBotMatchStateFromV2Event` board-null/handOpen · boneyard pad+trim · winnerId-on-gameOver · not-gameOver passthrough · field mapping). Green: `tsc -b`, full vitest 218/1520, lint 401/401, `check:architecture` 20/20 CERTIFIED. Not pushed.
  File 2 landed: `guidedBotMatchHelpers.test.ts` — **50 cases** (est. ~30–35), all 14
  non-`parseGuidedBoardState` exports. Surfaced **F21** (`splitCoachingSummaryBlock`
  dropped-body bug) — graded FIX NOW, fixed and ratified `D-CQ-2` in a separate
  commit before file 3; the two tests that pinned the bug now assert the correct
  behaviour. Green: `tsc -b`, full vitest 219/1570, lint 401/401,
  `check:architecture` CERTIFIED. Not pushed.
  File 3 landed: `buildGuidedCoachPresentation.test.ts` — **44 cases** (est. ~30–40;
  trimmed to sit under the 500-line `max-lines` warn) across all 6 exports
  (`computeActivePlacementMoves`, `buildGuidedCoachingFlags`,
  `buildLessonRecommendedTileKey`, `buildLessonCoachVm`, `buildLessonCoachPanelContent`,
  and end-to-end `buildGuidedCoachPresentation`). This file is the §CQ9.5.2
  dead-branch verification for the 459-line source — every branch confirmed live.
  Surfaced **F22** (`buildLessonRecommendedTileKey` frozen branch — draw/pass +
  key-format bugs) → FIX NOW, fixed + ratified `D-CQ-3` in its own commit, and
  **F23** (STYLE, resolved by the same fix). One genuine non-bug note pinned:
  `showCoachMoreButton` can only be `true` once the body exceeds the ~600-char
  preview cap (below that the preview text equals the body), unless an explicit
  shorter summary is present. Green: `tsc -b`, full vitest 220/1614, lint 401/401,
  `check:architecture` CERTIFIED. Not pushed.
  File 4 landed (Tier 2): `computeGuidedCoachTip.test.ts` — **18 cases** (est. ~12–15)
  on real botEngine (`createFixedBotMatch` + `getLegalMoves` + `previewPlayMove`
  fixtures, no mocks; expected scores derived in-test from `previewPlayMove`, not
  hard-coded, so the tests don't encode the all-fives rule). Covers: 6 guards;
  opening move (highest-scoring pick · scoring-double still `isOpeningDouble:false` ·
  highest-double fallback · null when neither); single-legal-play `isOnlyPlay`;
  **`isControlChoice`** (one tile, two non-scoring placements, differing `openSum` —
  `hand=[3|4]` on board L3R4, fully deterministic); `computeGuidedScoringTiles`
  (guards · `low-high` keying · max-of on collision).
  **Fixture-generation surprise:** the all-fives scoring is `openSum / 5` — a
  `5|5` opener scores **2**, not 10. Every score assertion is now derived, not
  literal.
  **The multi-move mirrored-`chooseBotMove` case is a `[smoke]` test only** —
  no-throw + shape-drawn-from-candidates. It does **not** assert which tile the
  mirrored master picks; must not later be counted as covering that branch's logic.
  **`best.pts === 0` scoring-override branch — NOT covered, and NOT dead.**
  Real attempt: 4 exploration rounds, ~18 constructed positions, read the
  `evaluateStrategicMove` master weighting. It IS reachable — `immediateWeight` is
  only 22–34 and `outBlockBonus` reaches ~161, so the master genuinely declines a
  small scoring play to block a near-win opponent (`youProximity ≥ 0.85`,
  `oppTileCount ≤ 3`, post-move `blockProb < 0.45`). But `chooseBotMove` in the
  mirror re-samples the opponent hand from the unseen pool via a **seeded** PRNG
  (`createStatePrng`), so the "punisher" tile is only reliably in-sample when that
  pool is small — a deep played-out endgame with ~20 tiles visible. Constructing
  that needs either a full `applyPlayMove` game choreography or a hand-written
  ~20-tile board (the exact wire-format fragility the plan flags for
  `parseGuidedBoardState`). So: an **integration-fixture gap with a stated reason**,
  not dead code — and note the branch's behaviour when it does fire is deliberate
  (it overrides the master's block recommendation with the scoring tile: "you had
  a scoring play, take it" — a coaching choice, debatable but intentional, tagged
  `isControlChoice: false`).
  Green: `tsc -b`, full vitest 221/1632, lint 401/401, `check:architecture`
  CERTIFIED. Not pushed.
  File 5 landed: `parseGuidedBoardState` addendum in `guidedBotMatchHelpers.test.ts`
  — **6 cases** (est. ~6–8). Per §CQ9.5.6 item 5 the multi-tile board is generated
  by playing real moves (`createFixedBotMatch` + `applyPlayMove`) then round-tripped
  through the actual `serializeGhostBoardState`, not hand-written. Covers: real
  round-trip (tiles `[l,h]` → `{low,high}`, authoritative ends, hub value survives) ·
  `board:empty`/`''` → null · malformed + non-object JSON → null · explicit tuple
  remap · `hubs` key → `hubDoubles` + branch-tile remap · serialized ends win over
  recomputed / absent → recomputed.
  **Fixture-generation findings (the plan flagged real risk here — confirmed):**
  (1) the opening `5|5` double creates a **mainline hub** (`hubValue: 5`,
  `isCrossed: true`), so the round-trip test exercises the hub path, not just an
  empty `hubDoubles`. (2) **`parseGuidedBoardState` is NOT a pure inverse of the
  serializer** — it runs `hydrateBoardForOpenEnds`, which canonicalises each hub's
  `branches` from the serializer's `[]` to the 2-slot `[left, right]` shape, and
  `branchDepth` `undefined` → `null`. Faithful for tiles/ends/hub-values; the parse
  output is *more* canonical than the wire, by design. No bug — pinned with a
  comment so the next reader knows the asymmetry is intentional.
  Green: `tsc -b`, full vitest 221/1638, lint 401/401, `check:architecture`
  CERTIFIED. Not pushed. Remaining: files 6–8 per `§CQ9.5.6`.

---

## CQ9.5 F6 — `modules/guided/` test coverage: scoping pass (greenlit 2026-09-05)

**Discipline reminder.** This is the scoping step only. No test files are written
until the human signs off on the file list below. Then: one test file per session,
verify against the code, no push.

### CQ9.5.1 Exported surface, 18 files — pure vs hook, and existing coverage

`P` = pure function (no React, deterministic given inputs). `H` = React hook
(state/effects/refs). Existing coverage: the **only** vitest file is
`useGuidedLessonBoot.test.tsx` (one case — the V2-registry-not-touched-before-preload
guard). `bot/useAuthoringCapture.behaviorTests.ts` is **not** real coverage — it
regex-greps the hook source for `export function useAuthoringCapture` and
re-implements two one-line helpers inline; it exercises none of the module's code.

| File | Export | Kind | Branching? | Covered? |
|---|---|---|---|---|
| `guidedV2State.ts` | `resolveNextPlayerAfterV2Event` | P | yes — handOver/gameOver · turnContinues · actor (4 paths) | no |
| | `parseV2EventHands` | P | light — parse + null-filter | no |
| | `buildBotMatchStateFromV2Event` | P (dep: `parseLessonV2BoardState`) | yes — board null→handOpen, boneyard sync, winnerId on gameOver | no |
| `guidedBotMatchHelpers.ts` | `splitCoachingSummaryBlock` | P | yes — regex match / no-match | no |
| | `buildCoachPreviewText` | P | yes — summary-wins · under/over max · word-boundary cut | no |
| | `formatLessonTileLabel` | P | trivial (`\|`→`-`, null) | no |
| | `parseGuidedLessonCoachContent` | P | **yes, heavy** — empty→fallback · first-line-as-title vs not · `play:` reject · 72-char cap · paragraph split · safe fallback | no |
| | `syncGuidedBoneyardCount` | P | yes — equal / trim / pad | no |
| | `sameTileKeyMultiset` | P | yes — length · missing key · dup accounting | no |
| | `guidedWinnerIdFromScores` | P | trivial `>=` | no |
| | `notifyGuidedV2EventToasts` | P (callback dispatch) | yes — score · draw · pass · actor label | no |
| | `parseGuidedBoardState` | P (dep: `hydrateBoardForOpenEnds`) | **yes, heavy** — sentinel · array-vs-object tile remap · `hubs`/`hubDoubles` key · branch remap · leftEnd/rightEnd override · try/catch | no |
| | `getGuidedV1AuthoredStepByIndex` | P | light — find w/ `chosenMove !== null` | no |
| | `getGuidedV1OrderedAuthoredSteps` | P | light — filter + sort | no |
| | `getNextGuidedV1StepIndex` | P | light | no |
| | `restoreGuidedV1NextFullMatchState` | P | yes — scan loop skipping stateless steps | no |
| | `restoreGuidedV1StepMatchState` | P | yes — null / parse / catch | no |
| | `parseGuidedTranscriptState` | P | yes — empty / parse / catch | no |
| `buildGuidedCoachPresentation.ts` | `computeActivePlacementMoves` | P | yes — V2-active filter (tile key, position) vs pass-through | no |
| | `buildGuidedCoachingFlags` | P | **yes, heavy** — 7 output flags, `showPlayerCoaching` gated by ~8 conditions | no |
| | `buildLessonCoachVm` | P | **yes, heavy** — 3 mode branches (transcript / frozen V1 / V2), each computes stepIndex / totalSteps / canBestMove | no |
| | `buildLessonRecommendedTileKey` | P | yes — 4 mode branches incl. frozen `split(':')[0].replace('\|','-')` parse | no |
| | `buildLessonCoachPanelContent` | P | **yes, heavy** — 6-way return (off-line · fritz · hand-over · player-coaching · fallback · null) | no |
| | `buildGuidedCoachPresentation` | P | orchestrator — progress label/pct/count math + `showCoachMoreButton` closure | no |
| `computeGuidedCoachTip.ts` | `computeGuidedCoachTip` | P (deps: `previewPlayMove`, `chooseBotMove` — real botEngine) | **yes, heavy** — guard · opening scoring / opening double / opening null · single play · mirrored bot-choice · `pts===0` scoring override · `isControlChoice` | no |
| | `computeGuidedScoringTiles` | P (dep: `previewPlayMove`) | yes — map of positive-score tiles | no |
| `useGuidedLessonBoot.ts` | `useGuidedLessonBoot` | H (useMemo/useState lazy init) | yes — `mode==='bot'` gate · frozenLesson vs authoring fallback · transcript published vs draft · derived mode booleans | **partial** — 1 case (V2 preload guard) |
| `useGuidedV2CoordinationState.ts` | `useGuidedV2CoordinationState` | H (useState lazy init, ref) | yes — 5-guard chain → `firstEventIndex` vs `0` | no |
| `useGuidedMatchCaptureRuntime.ts` | `useGuidedMatchCaptureRuntime` | H (1 effect + callbacks) | `isEmergencySaveableGuidedMatchCandidate` predicate (7 ANDed conditions), `canSaveGuidedMatchCandidate`, save-validation branch | no |
| `guidedPlacementHandlers.ts` | `useGuidedPlacementHandlers` | H (no effects — 6 `useCallback`) | **yes, heavy** — `handleGuidedPlacement` transcript/V2 match logic (clicked-vs-expected key+position), `playLessonBestMove` 3 mode branches; but ~50-key deps object | no |
| `useGuidedMatchRuntime.ts` | `useGuidedMatchRuntime` | H (useMemo derivations + 4 effects) | derivations are mode-flag one-liners; the `[guided-fallback]` new-hand reset effect has real logic | no |
| `useGuidedV1ReplayEffect.ts` | `useGuidedV1ReplayEffect` | H (1 timer effect) | yes — missing-events · replyIndex bounds · delay calc · per-event `BotActionResult` shaping | no |
| `useGuidedV2PlaybackEffects.ts` | `useGuidedV2PlaybackEffects` | H (5 timer effects) | **yes, heavy** — fritz-apply, player-repair-draw, draw/pass advance, note-align log | no |
| `useAuthoringCapture.ts` | `useAuthoringCapture` | H (8 effects + `useState` + localStorage + dynamic import) | yes — but authoring-only (dev tool); repeated "find last real step" reducer ×3 | no (behaviorTests = source-grep only) |
| `useGuidedWindowDebugApis.ts` | `useGuidedWindowDebugApis` | H (3 effects, `window.__*` attach/detach) | dev diagnostics; `applyScriptedFritzMove` has logic but authoring-only | no |
| `useGuidedMatchCommandEffects.ts` | `useGuidedMatchCommandEffects` | H — **pure wiring**, calls 4 sub-hooks, no logic of its own | none | n/a |
| `useGuidedMatchRuntimeTypes.ts` · `guidedCoachPresentationTypes.ts` · `index.ts` | types / barrel | — | — | n/a |

### CQ9.5.2 Step-1 leaf-by-leaf follow-up (the two flagged files)

Step 1 (`§CQ9.1.2 (1)`) deferred a dead-branch check of the 459-line
`buildGuidedCoachPresentation.ts` and the 417-line `guidedPlacementHandlers.ts`.
Reading both leaf-by-leaf for this scoping pass: **no dead exports and no
unreachable branches found.** Every `buildGuidedCoachPresentation.ts` helper is
called by `buildGuidedCoachPresentation`, which `useGuidedMatchRuntime` consumes;
every `guidedPlacementHandlers.ts` branch is reachable from the three lesson modes.
The overlap Step 1 predicted (dead branch ≈ untested branch) resolves as: the
branches are *live but untested*. Writing the Tier-1 tests below **is** the
verification that they behave as the reader expects — that's the value here, not
dead-code removal.

### CQ9.5.3 Risk × cost ranking

Fixtures are cheap: `modules/match/runtime/botEngine.ts` already exports
`createBotMatch` / `createFixedBotMatch` / `createFixedBotMatchWithStarter` for
real `BotMatchState`s, and the `vi.mock('../match/bootstrap/lessonV2LazyRegistry.ts', …)`
pattern from `useGuidedLessonBoot.test.tsx` already works for stubbing the lazy
registry. Small hand-rolled `FrozenLesson` / `AuthoredStep` / `GuidedTranscript` /
`LessonV2Event` literals cover the rest.

**Tier 1 — pure, real branching, low cost, player-facing correctness. Do first.**

1. **`guidedV2State.test.ts`** (new) — ~12–15 cases.
   `resolveNextPlayerAfterV2Event` (all 4 branch combinations),
   `parseV2EventHands` (valid keys, malformed keys filtered),
   `buildBotMatchStateFromV2Event` (board present vs null → `handOpen`; boneyard
   pad/trim; score + hand mapping; `winnerId` set only on `gameOver`; passthrough
   of untouched fields). Mock `parseLessonV2BoardState` from the lazy registry.

2. **`guidedBotMatchHelpers.test.ts`** (new) — ~30–35 cases.
   `splitCoachingSummaryBlock`, `buildCoachPreviewText` (summary-wins · under max ·
   over max with word-boundary cut · 65%-threshold hard cut), `parseGuidedLessonCoachContent`
   (empty → fallback title/body · first line as title · `play:`-prefixed first
   line rejected · >72-char first line · multi-paragraph split · summary from
   inline block vs explicit arg), `sameTileKeyMultiset` (equal · length mismatch ·
   content mismatch · duplicate-count accounting), `syncGuidedBoneyardCount`
   (equal / trim / pad), `formatLessonTileLabel`, `guidedWinnerIdFromScores`,
   `getGuidedV1AuthoredStepByIndex` / `getGuidedV1OrderedAuthoredSteps` /
   `getNextGuidedV1StepIndex` / `restoreGuidedV1NextFullMatchState` (small
   `FrozenLesson` fixture with a stateless step to skip),
   `restoreGuidedV1StepMatchState` / `parseGuidedTranscriptState` (valid · empty ·
   garbage → null), `notifyGuidedV2EventToasts` (score / draw / pass callbacks via
   `vi.fn()` spies, `player` vs `opponentLabel`).
   **Deliberately excluded from this file:** `parseGuidedBoardState` — see Tier 2.

3. **`buildGuidedCoachPresentation.test.ts`** (new) — ~30–40 cases. Pure, uses
   `createBotMatch*` fixtures + lesson literals, no mocks.
   `computeActivePlacementMoves` (V2 filter active — tile-key match, position
   match, position absent; inactive → pass-through), `buildGuidedCoachingFlags`
   (the `showPlayerCoaching` true path, then each negating condition flipped one at
   a time; `showFritzCoachingPanel`; `isGuidedV2FritzResolving`),
   `buildLessonRecommendedTileKey` (each of the 4 mode branches incl. the frozen
   `split(':')` parse), `buildLessonCoachVm` (transcript / frozen V1 / V2 — assert
   `stepIndex`, `totalSteps`, `canBestMove` per branch), `buildLessonCoachPanelContent`
   (all 6 returns), plus 3–4 end-to-end `buildGuidedCoachPresentation` cases
   asserting `lessonCoachProgressLabel` / `Pct` / `Count` and `showCoachMoreButton`.

**Tier 2 — pure but needs heavier fixtures / real engine. Do after Tier 1.**

4. **`computeGuidedCoachTip.test.ts`** (new) — ~12–15 cases. Real botEngine
   (`previewPlayMove`, `chooseBotMove`) — build real `BotMatchState`s via
   `createFixedBotMatchWithStarter` for: empty-board opening (scoring move ·
   double fallback · neither → null), single legal play, mid-hand mirrored
   bot-choice recommendation, `pts===0` scoring-override path, `isControlChoice`
   detection, plus the guards (not guided / not your turn / no moves → null).
   `computeGuidedScoringTiles` (map keyed `low-high`, max-of on collision).

5. **`parseGuidedBoardState`** — add to `guidedBotMatchHelpers.test.ts` in a
   second pass, ~6–8 cases. Needs a realistic `serializeGhostBoardState` output
   fixture (generate one from a real board rather than hand-write the wire
   format): `board:empty` / `''` → null, `[low,high]` tuple remap, `hubs` key →
   `hubDoubles`, branch-tile remap, `leftEnd`/`rightEnd` authoritative override,
   malformed JSON → null. Split out because the fixture cost is real and the
   round-trip is easy to get subtly wrong.

**Tier 3 — hooks worth a focused test, lower priority.**

6. **`useGuidedLessonBoot.test.tsx`** (extend existing) — ~8–10 cases.
   `mode !== 'bot'` disables all flags; `frozenLesson` from `loadFrozenLesson`
   vs the authoring-session fallback; transcript published vs draft;
   the `isGuidedTranscriptMode` / `isGuidedFrozenLessonMode` / `lessonLayoutMode`
   truth table. Mock `learn/guidedAuthoring.ts` loaders.

7. **`useGuidedV2CoordinationState.test.ts`** (new) — ~5 cases, cheap.
   The lazy-init guard chain: not V2 · no lesson · not preloaded · `canStart`
   false → `0`; happy path → `initGuidedV2Playback(...).firstEventIndex`. Mock the
   lazy registry.

8. **`guidedPlacementHandlers`** — decision logic only. **Preferred:** if a small
   refactor is separately greenlit, extract the "does the clicked move match the
   expected transcript/V2 event?" comparison (tile key + optional position) into a
   pure `matchesExpectedGuidedMove(...)` helper in `guidedBotMatchHelpers.ts` and
   unit-test that (~8 cases). **Otherwise:** `renderHook` with a hand-rolled deps
   object of `vi.fn()`s, asserting `handleGuidedPlacement` returns
   `'handled'`/`'continue'` and calls the right setters for the transcript-match,
   V2-match, and off-line paths (~6–8 cases). Flagged higher-cost because of the
   deps surface.

### CQ9.5.4 Effect-heavy hooks deliberately skipped for now (with reasons)

- **`useGuidedV2PlaybackEffects.ts`** — 5 interacting `setTimeout` effects driving
  `setMatch` + sound. A correct fake-timer harness (registry mock, ~25-key arg
  object, ordering between the fritz-apply / repair-draw / advance effects) is a
  multi-session build, and the transforms these effects delegate to
  (`buildBotMatchStateFromV2Event`, `resolveNextPlayerAfterV2Event`,
  `sameTileKeyMultiset`, `syncGuidedBoneyardCount`) are **fully covered by Tier 1**.
  Revisit only if a V2 playback bug surfaces.
- **`useGuidedV1ReplayEffect.ts`** — one timer effect, same harness cost profile,
  lower traffic (V1 explicit-transcript mode). Candidate for a thin fake-timer
  test later; not now.
- **`useGuidedMatchRuntime.ts`** — composition hook; the `useMemo` derivations are
  mode-flag one-liners already exercised through the `buildGuidedCoachPresentation`
  tests. Its one effect with real logic (`[guided-fallback]` new-hand step reset)
  could get a targeted test later; a full harness is not worth it.
- **`useAuthoringCapture.ts`** — dev-only lesson-authoring tool, not a player
  path; 8 effects + localStorage + dynamic `import()`. Cheap win available:
  extract the thrice-repeated "walk backwards to the last step with
  `chosenMove !== null`" reducer into a pure helper and test that. Skip the hook
  itself.
- **`useGuidedMatchCaptureRuntime.ts`** — `isEmergencySaveableGuidedMatchCandidate`
  is already a pure inline predicate; lift it (or just its condition) to
  module scope and give it a ~4-case test. Skip the effect + async callbacks.
- **`useGuidedWindowDebugApis.ts`** — dev diagnostics; F4 (STYLE) will likely
  gate/remove its `console.log`s anyway. No test.
- **`useGuidedMatchCommandEffects.ts`** — pure wiring, nothing to assert.

### CQ9.5.5 Fixture helper

All Tier-1/2 files need the same handful of literals. First test file to land
creates `modules/guided/__fixtures__/guidedFixtures.ts` (or co-located
`guidedTestFixtures.ts`) with: a `LessonV2Event` builder, a minimal
`FrozenLesson` + `AuthoredStep` builder, a `GuidedTranscript` + `GuidedTurn`
builder. `BotMatchState` comes from `botEngine`'s existing `createBotMatch*`
exports — do **not** add another.

### CQ9.5.6 Proposed landing order (one file per session, verify + no push)

CQ9.5.5 fixtures (folded into file 1) → 1 `guidedV2State` → 2 `guidedBotMatchHelpers`
→ 3 `buildGuidedCoachPresentation` → 4 `computeGuidedCoachTip` → 5 `parseGuidedBoardState`
addendum → 6 `useGuidedLessonBoot` extension → 7 `useGuidedV2CoordinationState` →
8 `guidedPlacementHandlers` (pending the extract-helper decision). Tiers 1–2
(files 1–5) are the high-value core; Tier 3 is opt-in continuation.

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

| D | Date | Decision | Reasoning |
|---|---|---|---|
| **D-CQ-4** | 2026-09-05 | **F19 greenlit and shipped** (separate commit, own scope — not folded into F6). `usePostGamePivotalReview`'s deferred-analysis `.catch` now calls `logger.warn('usePostGamePivotalReview', 'post-game analysis failed …', { error })`, gated on `if (cancelled) return` so an unmount / dep-change doesn't log. Happy path (analysis resolves) is untouched; the failure path still clears `postGameAnalysisPending`. New `usePostGamePivotalReview.test.tsx` — 2 cases (reject: warn fires with the error message + pending clears + `postGameAnalysis` null; resolve: no warn + analysis populated). **Known limitation:** `logger.warn` only writes to the console in DEV — it satisfies "leave a grep-able trace when debugging" but does NOT surface a production failure to Sentry; `reportOptionalChunkFailure` (the established optional-dynamic-import pattern, Sentry breadcrumb) is the follow-up if prod visibility is wanted. | Cheapest, lowest-risk REFACTOR-table item: one line in a catch, no protected surface, no happy-path change, low urgency (review is a nice-to-have). Human greenlit it explicitly as standalone work between F6 files. Verified green: `tsc -b`, client vitest 222/1640, server vitest 218/1292, lint 401/401, `check:architecture` 20/20. Not pushed at commit time. |
| **D-CQ-3** | 2026-09-05 | **F22 added, graded FIX NOW, fixed; F23 added (STYLE), resolved by the same fix.** F22: `buildLessonRecommendedTileKey`'s frozen-lesson branch (a) returned `'draw'`/`'pass'` verbatim as a tile key (no guard, unlike its two siblings) → a *"Play draw"* coach chip, and (b) emitted the hyphen display form (`"6-6"`) as a *key*, so `bot/BotHandTray.tsx`'s `=== toTileKey(tile)` (pipe form) never matched → the recommended-tile highlight is dead in frozen V1 lesson mode. Consumer trace: the return value has exactly one behavioural consumer (`BotHandTray` equality check for the highlight) plus `formatLessonTileLabel` for the chip label; a non-tile / wrong-format value causes a silent no-match (highlight) and a cosmetic wrong chip — no crash, no *wrong* highlight. **Moot on `main`**: V1 frozen mode is localStorage/author-machine only (no bundled lesson; players get bundled V2), so `isGuidedFrozenLessonMode` is always false for real users — same "real but moot until reachable" call as F21/D-CQ-2. Fixed anyway: one line, zero behaviour change while unreachable, mirrors the `draw`/`pass` guard `buildLessonCoachVm` already applies. F23 (`.replace('\|','-')` single vs `formatLessonTileLabel`'s `/\|/g`): the `.replace` is deleted entirely by F22's fix → resolved, logged STYLE for the record. F6 file-3 commit `6467c01e` had pinned both as "behaviour notes (not bugs)" — the pipe/hyphen consumer mismatch makes (b) a real bug; file-3's two frozen tests updated to assert the fixed behaviour (`"6\|6"`, and `null` for draw/pass). | Surfaced during F6 test authoring, same as F21. Grade driven by the consumer trace as instructed: not a crash or a *wrong* highlight, but a real dead-highlight + cosmetic-chip defect on a currently-unreachable path, and the guard clause is trivial + consistency-improving. Verified green (`tsc -b`, full vitest, lint 401/401, `check:architecture` 20/20). Not pushed. |
| **D-CQ-2** | 2026-09-05 | **F21 added and graded FIX NOW; fixed.** `splitCoachingSummaryBlock` read `match[2]` (a non-existent capture group) for the coaching body, collapsing it to `''` on every inline `@summary … ---` block. Intended semantics confirmed against the only consumer chain (→ `parseGuidedLessonCoachContent`; nothing reads `match.index`/`match[0].length`): `body` = the remainder after the `---` line. Fix is one line in the function — `body: raw.slice((match.index ?? 0) + match[0].length)` — the shared `COACHING_SUMMARY_BLOCK_RE` constant (re-exported through 3 barrels) is left untouched. The `\s*`-crosses-newline fragility on a whitespace-only summary line (report item 2) was considered and **left as-is**: both the match and no-match paths yield `summary: null` for a blank summary, so it is observably equivalent — not worth a change to the shared constant. F6 file-2 commit `a12fdfc2` pinned the bug with `NOTE(latent)` tests; this commit replaces them with correct-behaviour assertions (summary extracted + body = real remainder). | Surfaced during F6 test authoring. Moot on `main` today — no `@summary`-format authored content exists and `LessonV2Event.coachingSummary` is the live path — so it stays in this plan, not `HARDENING_PLAN.md`, exactly like the `verifyDailyFritzHand` `requireStateDigests` finding ("real but moot until the code path is reachable"). Cheap to fix now, expensive to rediscover once someone authors an `@summary` lesson and silently loses the body. Zero behaviour change while unreachable; verified green (`tsc -b`, full vitest 219/1570, lint 401/401, `check:architecture` 20/20). Not pushed. |
| **D-CQ-1** | 2026-09-05 | **`§CQ9.2` graded findings list ratified. Step-3 scope = the FIX-NOW set only: F1 (`modules/daily-puzzle/` dead), F8 (`match/InGameBoardShell.tsx` dead, pulled in from one dir outside the D-18 item), F10 (`InGameOverlayStack` no-op), F18 (dead re-export shim).** Three pre-Step-2 investigations resolved: (1) `applyJoinResponseGameState`'s silent early-return is genuinely benign — caller checks `ok`, logs, schedules resync; no player-visible wrong state or dispute reachable → quality finding F13, **explicitly not a `HARDENING_PLAN.md` candidate**; (2) `PIVOTAL_REVIEW_WIZARD_ENABLED` — never `true` on any branch and no open trigger wired, but lives in an actively-toggled beta-gate flag file with a 2026-08-15 "analyzer not ready for players" decision on the sibling → **parked/incomplete, ACCEPT** (F16), with a residual note that flipping the flag alone won't ship it; (3) `match/InGameBoardShell.tsx` dead since 2026-05-29 (superseded by the `match/board/` decomposition in the same commit that added `MatchLiveLayout`). REFACTOR/STYLE items (F3/F6/F11/F12/F19 + the STYLE set) held for per-finding greenlight — they touch working code and, for the guided ones, the CLAUDE.md-protected `learn/` surface. | FIX-NOW = clearly wrong, cheap, unambiguous; ships by default. The `daily_puzzle*` client surface beyond the 2 audited files is a **separate scoped pass** (FC-DEAD-1 treatment) — F1 re-sources the `dailyLeaderboard*` view-model fields from `dailyFritz` rather than cascade-deleting the plumbing, so that pass can remove the whole surface at once. Same one-step-per-session / verify-against-code / no-push discipline as every `HARDENING_PLAN.md` step. |
