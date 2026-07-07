# Phase: Daily Puzzle Cleanup — Sub-phase 8 Sizing (Render-Tree Decomposition Scoping)

## Prerequisite confirmation

**Does `docs/phase-dailypuzzle-gameplay-state-machine-verification-report.md` exist at that exact path?** **YES**

---

## Purpose

Sub-phases 1–7 (plus the sub-phase 7 verification/fix pass) extracted hooks, pure helpers, icons, and submission logic from `DailyPuzzleScreen.tsx` and `DailyPuzzleLadderScreen.tsx`. This report sizes what remains — primarily JSX render trees and thin routing state — to decide whether render-tree decomposition is worth pursuing, and if so, how to scope it safely.

**This is a sizing document only.** No code was extracted, moved, or modified.

---

## Summary table

| File | Total LOC | Approx. non-render (logic/wiring) | Approx. render (JSX + inline helpers) | Top-level render branches |
|------|-----------|-----------------------------------|---------------------------------------|---------------------------|
| `DailyPuzzleScreen.tsx` | **1178** | ~536 (45%) | ~642 (55%) | **13** early-return routes + 1 final in-play return |
| `DailyPuzzleLadderScreen.tsx` | **1093** | ~387 (35%) | ~706 (65%) | **3** early-return routes + 1 overlay helper + 2 final returns |

---

# Part A — `DailyPuzzleScreen.tsx`

## A1. Current LOC

**1178 lines** (post sub-phase 7 + verification fix; measured 2026-07-05).

---

## A2. Top-level conditional render branches

Branches are listed in **evaluation order** (first match wins). Line ranges and LOC counts are approximate JSX/content lines inclusive.

| # | Short name | Lines | ~LOC | Trigger condition |
|---|------------|-------|------|-------------------|
| 1 | **Entry: ladder checking** | 538–540 | 3 | `entryMode === 'checking' && selectedDateSeed === localDateKey` |
| 2 | **Entry: ladder check error** | 542–567 | 26 | `entryMode === 'ladderCheckError' && selectedDateSeed === localDateKey` |
| 3 | **Entry: ladder pending** | 570–615 | 46 | `entryMode === 'ladderPending' && ladderToday && selectedDateSeed === localDateKey` |
| 4 | **Entry: delegate to ladder screen** | 618–631 | 14 | `entryMode === 'ladder' && ladderToday && selectedDateSeed === localDateKey` |
| 5 | **Legacy: puzzle loading** | 634–635 | 2 | `loading` |
| 6 | **Legacy: load error (in-play path)** | 638–653 | 16 | `loadError && !showLobby` |
| 7 | **Legacy: no puzzle (in-play path)** | 656–670 | 15 | `!puzzle && !showLobby` |
| 8 | **Inline helper: `renderLeaderboardRows`** | 673–743 | 71 | Not a branch — helper defined before lobby/leaderboard returns |
| 9 | **Lobby: full-page leaderboard** | 745–771 | 27 | `showLobby && dailyLeaderboardOpen` |
| 10 | **Lobby: entry hub + archive picker modal** | 774–958 | 185 | `showLobby` (and not branch 9) |
| 11 | **Guard: null puzzle** | 961 | 1 | `!puzzle` after lobby path exhausted |
| 12 | **In-play: board preparing** | 967–975 | 9 | `!runtimeState` |
| 13 | **In-play: live board** | 978–1096 | 119 | Final return when runtime ready; `status === 'IN_PROGRESS'` shows board only |
| 14 | **In-play: post-game result overlay** | 1098–1173 | 76 | Nested inside branch 13: `status !== 'IN_PROGRESS'` |

**Nested sub-branch (inside #10, not a separate return):**

| Sub | Short name | Lines | ~LOC | Trigger |
|-----|------------|-------|------|---------|
| 10a | **Archive date picker modal** | 891–956 | 66 | `archivePickerOpen` inside lobby fragment |

**Notes:**

- Branches 1–4 are **today-entry routing** for the ladder vs legacy split; branch 4 hands off entirely to `DailyPuzzleLadderScreen`.
- Branches 5–7 and 10–14 are the **legacy single-puzzle / archive** path.
- `renderLeaderboardRows` (branch 8) is only consumed by branch 9 today; the post-game overlay uses a separate inline leaderboard table (branch 14).

---

## A3. State / props / hook reads per branch

### Branch 1 — Entry: ladder checking

| Reads | Callbacks / actions |
|-------|---------------------|
| `entryMode`, `selectedDateSeed`, `localDateKey` | `handleBackHome` → `onBack` |

### Branch 2 — Entry: ladder check error

| Reads | Callbacks / actions |
|-------|---------------------|
| `entryMode`, `selectedDateSeed`, `localDateKey`, `ladderStatusError`, `stableDailyTitle` | `setLadderStatusError`, `setEntryMode('checking')`, `setLadderFetchNonce`, `handleBackHome` |

### Branch 3 — Entry: ladder pending

| Reads | Callbacks / actions |
|-------|---------------------|
| `entryMode`, `ladderToday`, `selectedDateSeed`, `localDateKey`, `import.meta.env.DEV`, `ladderToday.runDate` | `setEntryMode`, `setLadderFetchNonce`, `onNavigate`, `handleBackHome` |

### Branch 4 — Entry: delegate to ladder

| Reads | Callbacks / actions |
|-------|---------------------|
| `entryMode`, `ladderToday`, `selectedDateSeed`, `localDateKey`, `user`, `profile` | `onBack`, `onNavigate`, `onOpenAuth`, `onOpenAccount` (passed through) |

### Branch 5 — Legacy: puzzle loading

| Reads | Callbacks / actions |
|-------|---------------------|
| `loading` | `handleBackHome` |

### Branch 6 — Legacy: load error

| Reads | Callbacks / actions |
|-------|---------------------|
| `loadError`, `showLobby`, `isArchiveMode`, `stableDailyTitle`, `localDateKey`, `timezone` | `handleBackHome` |

### Branch 7 — Legacy: no puzzle

| Reads | Callbacks / actions |
|-------|---------------------|
| `puzzle`, `showLobby`, `isArchiveMode`, `stableDailyTitle`, `localDateKey`, `timezone` | `handleBackHome` |

### Branch 8 — `renderLeaderboardRows` helper

| Reads | Callbacks / actions |
|-------|---------------------|
| `currentUserId` (`user?.id`), `getDisplayName`, `formatPuzzleElapsed` | None (presentational) |

### Branch 9 — Lobby: full-page leaderboard

| Reads | Callbacks / actions |
|-------|---------------------|
| `showLobby`, `dailyLeaderboardOpen`, `displayDateSeed`, `leaderboardSummaryCards`, `leaderboard`, `leaderboardLoading` | `setDailyLeaderboardOpen(false)`, `renderLeaderboardRows` |

### Branch 10 — Lobby: entry hub

| Reads | Callbacks / actions |
|-------|---------------------|
| `showLobby`, `puzzle`, `isArchiveMode`, `formattedDisplayDate`, `streakDays`, `loading`, `loadError`, `selectedPuzzleReady`, `archiveDateDirty`, `archiveTargetIsToday`, `archiveInputHasCompleteDate`, `archiveDateInput`, `selectedDateSeed`, `runtimeInitError` | `onBack`, `startDailyPuzzle`, `commitArchiveDateSelection`, `pendingStartDateRef`, `setLoadError`, `setArchivePickerOpen`, `setDailyLeaderboardOpen` |

### Branch 10a — Archive picker modal (nested)

| Reads | Callbacks / actions |
|-------|---------------------|
| `archivePickerOpen`, `archiveDateInput`, `localDateKey`, `archiveInputHasCompleteDate` | `setArchivePickerOpen`, `setArchiveDateInput`, `applyArchiveDate`, `resetArchiveToToday`, `setLoadError` |

### Branch 11 — Guard: null puzzle

| Reads | Callbacks / actions |
|-------|---------------------|
| `puzzle` | None |

### Branch 12 — In-play: board preparing

| Reads | Callbacks / actions |
|-------|---------------------|
| `runtimeState`, `stableDailyTitle` | None |

### Branch 13 — In-play: live board

| Reads | Callbacks / actions |
|-------|---------------------|
| `runtimeState`, `status`, `isArchiveMode`, `formattedPuzzleDate`, `legalMoves`, `selectedTile`, `lastPlayedTile`, `handTileSize`, `handCompactStacked`, `playableTileKeys`, `validation`, `solvableWarning`, `confettiCanvasRef` | `onPositionClick`, `resetAttempt`, `onBack`, `setSelectedTile` |

### Branch 14 — Post-game result overlay (nested in 13)

| Reads | Callbacks / actions |
|-------|---------------------|
| `status`, `completedScore` (`completedScoreForSummary`), `completionSummary` (message + `modalLeaderboard`), `bestPossibleScore`, `movesUsed`, `streakDays`, `currentUserId`, `getDisplayName`, `formatPuzzleElapsed` | `resetAttempt`, `onBack` |

**Hook / module consumption in render tree (not in handlers):**

| Extracted module | Render-tree usage in `DailyPuzzleScreen` |
|------------------|------------------------------------------|
| `useResponsiveHandTileSize` | Branch 13 hand dock: `handTileSize`, `handCompactStacked` |
| `useDailyPuzzleArchiveLeaderboard` | Branch 9: `dailyLeaderboardOpen`, `leaderboard`, `leaderboardLoading`, `leaderboardSummaryCards`, `displayDateSeed`; Branch 10: archive state + `setArchivePickerOpen`, `setDailyLeaderboardOpen`; Branch 14: `modalLeaderboardPreview` via `completionSummary` |
| `useDailyPuzzleValidatorWorker` | **Not in render tree** — `requestValidationFromWorker` / `requestBestScoreFromWorker` used in effects and `useDailyPuzzleLegacyGameplay` only |
| `useDailyPuzzleLegacyGameplay` | **Not in render tree** — `finalizeResult` / `resetSubmissionGuard` used in handlers/effects |
| `dailyPuzzlePlayMoveCompletion` | **Not in render tree** — used in `onPositionClick` and stuck-fail effect |

---

## A4. Shared JSX structure vs distinct screens

### Genuinely distinct screens

| Group | Branches | Character |
|-------|----------|-----------|
| Ladder entry router | 1–4 | Small `LayoutScreen` / `DailyPuzzleLoadingScreen` / lazy delegate — different product surface than legacy |
| Legacy error / empty | 5–7, 11–12 | `LayoutScreen` + `lobby-screen` pattern — shared chrome, different copy |
| Lobby / archive | 9–10 | `daily-dash` entry hub + `LeaderboardPageShell` — unique to legacy path |
| In-play board | 13 | `MatchLiveLayout` + `Board` + hand dock — game surface |
| Post-game overlay | 14 | `rh-result` modal — distinct from in-play |

### Shared-structure candidates

| Pattern | Where it appears | Extraction potential |
|---------|------------------|----------------------|
| **`LayoutScreen` error/empty shell** | Branches 2, 3, 6, 7, 12 | Shared wrapper with title/subtitle/children — low risk, modest LOC savings (~15–25 lines duplicated chrome) |
| **`renderLeaderboardRows` row markup** | Branch 9 | Could become `DailyPuzzleLeaderboardRowList` presentational component; branch 14 uses a **different** `rh-result__lb` table shape |
| **Hand dock tile grid** | Branch 13 | Nearly identical to ladder in-play hand dock (see Part B) — strongest cross-file shared candidate |
| **`MatchLiveLayout` solo HUD shell** | Branch 13 | Same layout primitives as ladder in-play; labels/score/actions differ |
| **`rh-result` post-game modal** | Branch 14 | Same modal family as ladder overlays (`rh-result`, `rh-result__head`, `rh-result__summary`) but different content layout |

### Not shared

- `daily-dash` lobby hub (branch 10) — legacy/archive-specific; no ladder equivalent in this file
- Ladder entry branches (1–4) — routing only, live in parent to avoid loading ladder bundle for archive users

---

## A5. Prop-count / prop-drilling risk flags

| Branch | Est. props if extracted | Risk |
|--------|-------------------------|------|
| 1–5 (small shells) | 2–4 each | **Low** — not worth standalone components alone |
| 6–7 (error screens) | 5–7 | **Low** |
| 9 (leaderboard page) | 6–8 + row renderer | **Low** — already thin wrapper around `LeaderboardPageShell` |
| **10 (lobby hub)** | **18–22** | **HIGH** — reads most archive hook surface + puzzle load state + multiple callbacks; extracting without a view-model object would be noisy |
| **10a (archive modal)** | **8–10** | **Medium** — could ride along with lobby extraction or stay inline |
| **13 (in-play board)** | **14–16** | **Medium** — many gameplay values but cohesive single surface; prop count is high yet stable (no deep drilling layers) |
| **14 (post-game overlay)** | **10–12** | **Medium** — depends on `completionSummary` bundle; could accept one view-model prop |

**Prop-drilling smell:** Extracting branch 10 (lobby) as a child of a future parent router without a grouped props/view-model object would likely require passing 15+ individual props. That is the highest-risk decomposition target in this file.

**No multi-layer drilling today:** All branches are flat early returns from the screen component — there are no intermediate layout wrappers that would force prop threading through 2–3 layers unless decomposition introduces them.

---

## A6. Cross-reference — extracted modules in render tree

| Module | Consumed in render? | Exact locations |
|--------|---------------------|-----------------|
| `useResponsiveHandTileSize` | **Yes** | Branch 13 hand dock (`handTileSize`, `handCompactStacked`) |
| `useDailyPuzzleValidatorWorker` | **No** | Effects + legacy submission hook only |
| `useDailyPuzzleArchiveLeaderboard` | **Yes** | Branches 9, 10, 10a, 14 (via `completionSummary.modalLeaderboard` ← `modalLeaderboardPreview`) |
| `useDailyPuzzleLegacyGameplay` | **No** | Handlers (`finalizeResult`, `resetSubmissionGuard`) |
| `ladderSlotRowViewModel` | **No** | Not used in this file |
| `ladderHelpers` | **No** | Not used in this file |
| `dailyPuzzleSlotHelpers` | **No** | Not used in this file |
| `dailyPuzzleLadderIcons` | **No** | Not used in this file |
| `dailyPuzzlePlayMoveCompletion` | **No** | `onPositionClick` / stuck effect only |

---

# Part B — `DailyPuzzleLadderScreen.tsx`

## B1. Current LOC

**1093 lines** (post sub-phase 7 + verification fix; measured 2026-07-05).

---

## B2. Top-level conditional render branches

| # | Short name | Lines | ~LOC | Trigger condition |
|---|------------|-------|------|-------------------|
| 1 | **Full-page ladder leaderboard** | 388–402 | 15 | `leaderboardOpen` |
| 2 | **`renderLadderOverlays()` helper** | 404–648 | 245 | Called from hub and in-play returns (not an early return) |
| 2a | Overlay: submit/finalize pending | 406–426 | 21 | `submitPending \|\| finalizePending` |
| 2b | Overlay: slot complete | 428–483 | 56 | `slotOverlay` |
| 2c | Overlay: practice complete | 485–571 | 87 | `practiceOverlay` |
| 2d | Overlay: ladder final complete | 573–646 | 74 | `finalOverlay` |
| 3 | **Hub (not in active play)** | 650–1001 | 325 | `!inActivePlay` where `inActivePlay = Boolean(activeSlot && runtimeState)` |
| 4 | **In-play: live board** | 1006–1092 | 87 | Final return when `activeSlot && runtimeState` |

**Notes:**

- Unlike legacy screen, ladder has **fewer early-return routes** — most UI is hub + overlays + in-play.
- `renderLadderOverlays()` is a **parallel layer** rendered above hub or board, not a route replacement.
- Branch 1 delegates to existing `DailyPuzzleLadderLeaderboardScreen` (already extracted).

---

## B3. State / props / hook reads per branch

### Branch 1 — Full-page ladder leaderboard

| Reads | Callbacks / actions |
|-------|---------------------|
| `leaderboardOpen`, `user`, `today.runDate`, `profile?.username`, `profile?.glicko_rating`, `user?.id` | `setLeaderboardOpen(false)`, `onNavigate`, `onOpenAuth`, `onOpenAccount` |

### Branch 2a — Pending overlay

| Reads | Callbacks / actions |
|-------|---------------------|
| `submitPending`, `finalizePending` (from `useDailyPuzzleLadderGameplay`) | None |

### Branch 2b — Slot result overlay

| Reads | Callbacks / actions |
|-------|---------------------|
| `slotOverlay` (response + rawScore), `getDailyPuzzleDisplayTitle` | `exitPlayToHub`, `setSlotOverlay`, `launchSlot` |

### Branch 2c — Practice overlay

| Reads | Callbacks / actions |
|-------|---------------------|
| `practiceOverlay` (slotIndex, slotTitle, rawScore, bestPossible) | `handleStartPractice`, `setPracticeOverlay`, `setRuntimeState`, `setActiveSlot` |

### Branch 2d — Final ladder overlay

| Reads | Callbacks / actions |
|-------|---------------------|
| `finalOverlay`, `currentSlotBreakdown`, `finalLadderShareText`, `shareDone` | `exitPlayToHub`, `onBack`, `setFinalOverlay`, `setLeaderboardOpen`, `handleShareLadderResult` |

### Branch 3 — Hub

| Reads | Callbacks / actions |
|-------|---------------------|
| `inActivePlay`, `attempt`, `today`, `finalizeReady`, `finalizePending`, `startPending`, `hubError`, `heroSrc`, `streakDisplay`, `ladderTotalPoints`, `ladderSlotRows`, `ladderStateLabel`, `primaryLabel`, `trustLine`, `isLadderComplete`, `needsFinalize`, `hubLadderShareText`, `shareDone`, `onNavigate`, `onOpenAuth`, `onOpenAccount` | `onBack`, `handleStartScored`, `handleStartPractice`, `setLeaderboardOpen`, `handleShareLadderResult`, `renderLadderOverlays` |

**Hub memos feeding render:**

- `ladderSlotRows` ← `buildLadderSlotRows` (`ladderSlotRowViewModel`)
- `ladderTotalPoints` ← `computeLadderTotalPoints` (`ladderSlotRowViewModel`)
- `currentSlotBreakdown` ← `buildLadderSlotBreakdown` (`ladderSlotRowViewModel`)
- `getLadderPuzzleCardState` (`ladderHelpers`) per row
- `formatDateLabel` (`ladderHelpers`)
- Icons: `DplIconCalendar`, `DplIconFlame`, `DplIconLayers`, `DplIconLock`, `DplIconTrophy`, `LadderIconLeaderboard`, `LadderIconOrdered`, `LadderIconSameBoard` (`dailyPuzzleLadderIcons`)

### Branch 4 — In-play board

| Reads | Callbacks / actions |
|-------|---------------------|
| `activeSlot`, `runtimeState`, `displayScore`, `legalMoves`, `selectedTile`, `lastPlayedTile`, `status`, `handTileSize`, `handCompactStacked`, `playingSlot`, `playingState` | `onPositionClick`, `onBack`, `setLeaderboardOpen`, `setSelectedTile`, `renderLadderOverlays` |

**Hook / module consumption in render tree:**

| Extracted module | Render-tree usage in `DailyPuzzleLadderScreen` |
|------------------|-----------------------------------------------|
| `useResponsiveHandTileSize` | Branch 4 hand dock |
| `useDailyPuzzleLadderGameplay` | Branch 2a: `submitPending`, `finalizePending`; handlers use `submitLadderSlot` / `runFinalize` (not render) |
| `ladderSlotRowViewModel` | Branch 3: `ladderSlotRows`, `ladderTotalPoints`; Branch 2d: `currentSlotBreakdown` |
| `ladderHelpers` | Branch 3: `formatDateLabel`, `getLadderPuzzleCardState` |
| `dailyPuzzleSlotHelpers` | **Not in render tree** — `toCuratedPuzzle` in `launchSlot` handler only |
| `dailyPuzzleLadderIcons` | Branch 3 hub badges, overview cards, progress lock icon |
| `dailyPuzzlePlayMoveCompletion` | **Not in render tree** — `onPositionClick` / stuck effect only |
| `useDailyPuzzleArchiveLeaderboard` | **Not used** in this file |
| `useDailyPuzzleValidatorWorker` | **Not used** in this file |
| `useDailyPuzzleLegacyGameplay` | **Not used** in this file |

---

## B4. Shared JSX structure vs distinct screens

### Distinct surfaces

| Surface | Branch | Notes |
|---------|--------|-------|
| Ladder leaderboard sub-screen | 1 | Already extracted to `DailyPuzzleLadderLeaderboardScreen` |
| Hub | 3 | Large `df-page` / `pvf-control-panel` layout — ladder-specific marketing + progress cards |
| Result overlays | 2a–2d | Modal stack on top of hub or board |
| In-play board | 4 | `MatchLiveLayout` solo HUD |

### Shared-structure candidates

| Pattern | Legacy equivalent | Notes |
|---------|-------------------|-------|
| **Hand dock** | `DailyPuzzleScreen` branch 13 | Same `tray-rail` / `hand-container` / `DominoTile` loop — strongest shared extraction |
| **`MatchLiveLayout` shell** | Legacy in-play | Same board/hand split; HUD strings differ |
| **`rh-result` modal family** | Legacy post-game overlay (branch 14) | Ladder has four overlay variants vs legacy one; shared header/summary/footer primitives possible |
| **`home-bg` decorative background** | Ladder hub only in this file | Not shared with legacy `daily-dash` lobby |

### Hub vs legacy lobby

These are **genuinely different screens** — ladder hub uses Play-vs-Fritz-style `df-pvf-*` panels; legacy lobby uses `daily-dash`. They should **not** be forced into one component.

---

## B5. Prop-count / prop-drilling risk flags

| Branch | Est. props if extracted | Risk |
|--------|-------------------------|------|
| 1 (leaderboard delegate) | Already extracted | **None** |
| **2 (`renderLadderOverlays`)** | **12–15** + overlay-specific data | **Medium** — four modals share overlay chrome; could be one component with discriminated union state |
| **3 (hub)** | **22–28** | **HIGH** — attempt/today/slot rows/share text/hero/pending flags + many callbacks; clear view-model candidate |
| **4 (in-play board)** | **12–14** | **Medium** — same profile as legacy in-play; overlays passed as sibling not child |

**Prop-drilling smell:** Hub extraction without a `LadderHubViewModel` (or context) would exceed 15 props and duplicate memo wiring (`ladderSlotRows`, `hubLadderShareText`, derived labels). Overlays reference hub callbacks (`launchSlot`, `exitPlayToHub`, `handleStartPractice`) — extracting overlays separately still requires threading those callbacks, but overlay state (`slotOverlay`, `practiceOverlay`, `finalOverlay`) already lives in parent state from `useDailyPuzzleLadderGameplay` setters.

---

## B6. Cross-reference — extracted modules in render tree

(See table in B3.) Key threading notes for a future extraction prompt:

- **`useDailyPuzzleLadderGameplay`** — render reads `submitPending` / `finalizePending`; overlay state blobs are parent `useState` updated by hook setters passed into hook params.
- **`ladderSlotRowViewModel`** — hub progress cards are the densest view-model consumer in render.
- **`ladderHelpers` / `dailyPuzzleLadderIcons`** — hub-only presentation helpers.
- **`useResponsiveHandTileSize`** — in-play only.
- **`dailyPuzzlePlayMoveCompletion`** — keep in parent controller; not a render concern.

---

# Part C — Recommendation

## Project standard applied

> Length is not the enemy; **undifferentiated responsibility** is. A component whose only job is "render this screen's markup" is not automatically undifferentiated just because it is long.

After sub-phases 1–7, neither file is a god-object of mixed domains. What remains is largely:

1. **Thin orchestration** (routing, load effects, gameplay handlers) — ~35–45% of LOC
2. **Distinct render surfaces** — ~55–65% of LOC

The extracted hooks already separated submission, archive/leaderboard data, validator I/O, and ladder slot APIs. The screen files are now closer to **route controllers + view markup**, which is a cohesive responsibility — but each file still hosts **multiple distinct user-facing surfaces** in one return chain.

## `DailyPuzzleScreen.tsx` — **partial decomposition worth it (2–3 targets only)**

**Verdict:** In between "full decomposition" and "not worth it."

| Priority | Target | ~LOC | Rationale |
|----------|--------|------|-----------|
| **1 (optional, cross-file)** | Shared **solo hand dock** (+ maybe `MatchLiveLayout` wrapper) | ~50 per screen | Identical structure in legacy and ladder in-play; pure presentation; low behavioral risk |
| **2 (if pursued)** | **In-play surface** (branch 13 + nested 14) | ~195 | Single cohesive game session UI; medium prop count but stable boundary |
| **3 (if pursued)** | **Legacy lobby hub** (branch 10 + 10a) | ~185 | Largest legacy-only chunk; **high prop count** — only extract alongside a `LegacyLobbyViewModel` type, not raw prop drilling |
| **Defer** | Entry router branches 1–4 | ~89 total | Small, sequential guards; splitting adds files without clarifying responsibility |
| **Defer** | `renderLeaderboardRows` alone | 71 | Only used once; extract only if building a shared leaderboard row component for branch 14 too (different markup today) |
| **Already done** | Leaderboard full page | 27 | `LeaderboardPageShell` already bounds this |

**Not worth full decomposition:** Error/loading `LayoutScreen` branches are repetitive but tiny; a shared error shell is optional polish, not a meaningful LOC win.

**Cohesive-responsibility argument for stopping early:** If sub-phase 8 extraction is limited to in-play + optional hand dock, the parent can remain the **legacy route controller** (entry routing + lobby + play) without violating domain boundaries. Peeling lobby is optional and should not precede a view-model pass.

## `DailyPuzzleLadderScreen.tsx` — **partial decomposition worth it (2 targets)**

**Verdict:** Hub and overlays are the meaningful splits; in-play is already small.

| Priority | Target | ~LOC | Rationale |
|----------|--------|------|-----------|
| **1 (if pursued)** | **`renderLadderOverlays`** (2a–2d) | ~245 | Four modals share `rh-result` chrome; natural `LadderResultOverlays` component with discriminated union props |
| **2 (if pursued)** | **Hub** (branch 3) | ~325 | Largest single block; already fed by `ladderSlotRowViewModel` — pair with explicit view-model type to avoid 22+ raw props |
| **3 (optional, cross-file)** | Shared hand dock / match shell | ~87 | Same as legacy in-play recommendation |
| **Defer** | In-play board as its own file alone | 87 | Too small to justify unless bundled with shared match shell |
| **Done** | Leaderboard | 15 | Delegated to `DailyPuzzleLadderLeaderboardScreen` |

**Not worth full file split:** After hub + overlays extraction, remaining controller logic (~387 LOC) + in-play (~87 LOC) is a reasonable single **ladder session controller** file.

## Overall go / no-go

| Question | Answer |
|----------|--------|
| Is render-tree decomposition worth doing at all? | **Yes, selectively** — not a whole-file split |
| Expected LOC impact if top targets extracted | Legacy: ~180–200 LOC moved; Ladder: ~320–370 LOC moved; shared hand dock: ~50 LOC deduplicated |
| Expected file count if pursued | +2–4 presentational/view components, +0–1 shared match UI module, optional view-model types (no ref bridges) |
| Highest risk | Lobby/hub extractions without grouped view-model props |
| Lowest risk | Shared hand dock; ladder overlay modal stack |

## Suggested sub-phase 8b scope (if approved later — not part of this task)

1. `DailyPuzzleSoloHandDock.tsx` (shared, both screens)
2. `DailyPuzzleLegacyInPlayView.tsx` (board + post-game overlay view-model prop)
3. `DailyPuzzleLadderOverlays.tsx` (four modals)
4. `DailyPuzzleLadderHubView.tsx` + `LadderHubViewModel` type (hub only)

**Explicitly out of scope for decomposition:** Entry router in parent `DailyPuzzleScreen`, gameplay handlers, hook wiring, frozen modules.

---

## Frozen scope confirmation

No files were modified. No frozen files were touched.

---

## Report path confirmation

**This file exists at:** `docs/phase-dailypuzzle-render-tree-sizing-report.md`