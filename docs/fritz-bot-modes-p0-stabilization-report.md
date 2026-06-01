# Fritz / Bot Modes — P0 Stabilization Report

**Date:** 2026-05-31  
**Scope:** Hand-transition safety, bot async stale-closure guards, Daily Fritz set/record dedupe — no UI redesign, no rule changes.

Reference audit: `docs/fritz-bot-modes-source-of-truth-audit.md`

---

## Root risks addressed

| Risk | Mitigation |
|------|------------|
| Fritz acts after `handOver` / `gameOver` / set complete | `shouldAllowBotAction` + `isDailyFritzSetTerminal` at effect entry and inside think timer; `shouldApplyBotActionResult` before `applyAndNotify` |
| Stale bot timer applies move on outdated `match` closure | Bot turn uses `matchRef.current` as `working` state; apply path re-checks live ref |
| Hand reveal from superseded hand replaces current UI | `shouldShowHandRevealForHand` in reveal `setTimeout` |
| Double next-hand advance (PVF) | `handTransitionInFlightRef` set for local `startNextBotHand` path (same ref as Daily Fritz) |
| Advance after game/set terminal | `advanceHand` early return when PVF `gameOver` or DF `set_result.setWinner` |
| Duplicate Daily Fritz record/complete API | `recordGameInFlightRef` + `completedAttemptIdRef` in parent screen |
| 409 end-of-run stuck in reveal | Existing `handleEndOfRun` unchanged; advance blocked when set terminal so no competing fetch after complete |

---

## Files changed

| File | Change |
|------|--------|
| `client/src/bot/handLifecycle.ts` | New pure guards: `shouldAllowBotAction`, `shouldApplyBotActionResult`, `isDailyFritzSetTerminal`, `shouldShowHandRevealForHand` |
| `client/src/bot/handLifecycle.behaviorTests.ts` | Tests for all new helpers |
| `client/src/bot/BotMatchScreen.tsx` | Wired guards into bot effect, reveal timer, `advanceHand`, PVF in-flight |
| `client/src/dailyFritz/DailyFritzScreen.tsx` | Record-game and complete-set in-flight dedupe refs |
| `docs/fritz-bot-modes-p0-stabilization-report.md` | This report |

---

## Exact guards added

### `handLifecycle.ts`

- **`shouldAllowBotAction`** — `currentPlayer === 'bot' && !handOver && !gameOver`
- **`shouldApplyBotActionResult`** — reject if live `gameOver` and result is not ending game; reject if live `handOver` without `result.handEnded`
- **`isDailyFritzSetTerminal`** — `Boolean(setResult?.setWinner)`
- **`shouldShowHandRevealForHand`** — `liveHandNumber === endedHandNumber`

### `BotMatchScreen.tsx`

- Bot effect guard uses `shouldAllowBotAction(matchRef.current)` instead of inline `match` fields
- Skip bot when `isDailyFritzSetTerminal(dailyFritzPackage?.set_result)`
- Think timer: re-read `matchRef.current`, re-check allow + set terminal
- Before `applyAndNotify`: `shouldApplyBotActionResult(matchRef.current, result)`
- Max-thinking fallback: same apply guard
- Hand reveal timer: skip if hand number drifted
- `advanceHand`: skip when PVF `gameOver` or DF set terminal; PVF next hand sets/clears `handTransitionInFlightRef`

### `DailyFritzScreen.tsx`

- **`recordGameInFlightRef`** — blocks overlapping `recordDailyFritzGame`
- **`completedAttemptIdRef`** — blocks duplicate `completeDailyFritz` per `attempt_id`

---

## Tests added/updated

| Test | Command |
|------|---------|
| `handLifecycle.behaviorTests.ts` — bot allow/apply, set terminal, reveal hand match | `npm run test:hand-lifecycle --prefix client` |
| `dailyFritzSkunk.test.ts` (unchanged, regression) | `npm test -- dailyFritzSkunk` in `server/` |

New cases:

- Bot ignored when hand over / game over / player turn
- Stale bot result dropped after hand/game over; hand-ending move still allowed
- Daily Fritz set terminal detection
- Stale reveal timer skipped when hand number advanced

---

## Build / test results

| Check | Result |
|-------|--------|
| `npm run test:hand-lifecycle --prefix client` | **Pass** |
| `npm run build --prefix client` | **Pass** |
| `npm run build --prefix server` | **Pass** (no server code changed) |
| `npm test -- dailyFritzSkunk` (server) | **Run for regression** |

---

## Remaining risks (not in P0)

- **`BotMatchScreen` monolith** — still ~8k lines; guards are localized, not structural
- **Shared timer constant names** (`DAILY_FRITZ_*` used for PVF) — behavior unchanged; rename is P3
- **Prefetch 409 during reveal** — relies on existing `handleEndOfRun`; no new E2E test
- **`chooseBotMove` CPU** — P1 performance
- **Board triple layout** — P1 performance
- **No Fritz smoke in CI** — manual PVF + DF hand loop still required
- **Guided/ghost paths** — only touched where shared guards apply; not fully re-audited

---

## Deferred to P1 performance pass

- Memoize `DailyFritzScreen` → `BotMatchScreen` props beyond countdown fix
- Single `computeLayout` pass in `Board.tsx`
- DEV `chooseBotMove` timing budget / tier caps
- Optional shorter PVF hand pacing (product decision)
- Fritz-specific smoke script

---

## Recommended next prompt

> **Fritz P0 verification + P1a board layout (optional)**  
> Manually play one PVF match and one Daily Fritz set (hand-end → next hand → game-over → between-game). Confirm no Fritz move after hand reveal, no double-advance, 409/end-of-run clears reveal. If clean, do P1a: dedupe `Board.tsx` layout projection only (mirror multiplayer P1a), no `BotMatchScreen` split.

---

## Definition of done

- [x] Shared hand-transition guards testable in `handLifecycle`
- [x] Bot async uses live ref checks before apply
- [x] PVF and DF share in-flight advance protection
- [x] Daily Fritz record/complete dedupe
- [x] Client build + hand lifecycle tests pass
- [x] No gameplay/skunk/scoring rule changes
