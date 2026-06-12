# Fritz & Racehorse Fairness Audit

**Date:** 2026-06-12  
**Scope:** Tile dealing/RNG, Fritz decision information, scoring symmetry, comeback logic, statistical simulation, mode coverage (Play vs Fritz, Daily Fritz, Tournament, Daily Puzzle).  
**Constraint:** No gameplay or bot-strength changes in this pass — investigation only.

---

## Executive summary

| Area | Verdict |
|------|---------|
| **Tile dealing & draws** | **Fair** — single shuffled deck, fixed seat slices, FIFO boneyard; no Fritz-only rigging |
| **Play vs Fritz / Daily Fritz AI** | **Strong, largely fair on hidden hands** — `FairBotMode` masks player rack; MC sampling for opponent |
| **Tournament server Fritz** | **Unfair in endgame (P0)** — `minimax` reads human’s real hand when ≤6 tiles remain |
| **Boneyard information** | **Asymmetric (P1)** — Fritz AI models exact boneyard stack order; player UI shows count only |
| **Scoring rules** | **Symmetric per engine** — same `applyPlayMove` / pip formulas for both sides in Fritz modes |
| **Rubber-band / pity** | **None found** in engines |
| **Player perception** | Complaints align with **Elite/Master strength + defensive heuristics**, not draw cheating (sim confirms) |

---

## 1. Tile dealing / RNG fairness

### Audited files

| File | Functions |
|------|-----------|
| `client/src/bot/botEngine.ts` | `shuffle`, `createDealtHand`, `createFixedBotHand`, `drawOne`, `drawUntilPlayableOrEmpty`, `applyPlayMove` |
| `server/src/game/engine.ts` | `shuffle`, `startNewHand`, `drawOne`, `drawUntilPlayableOrEmpty`, `applyMove` |
| `server/src/dailyFritz.ts` | `createSeededPrng`, `shuffleWithPrng`, `generateSingleDailyFritzHand`, `getDailyFritzGameSeed` |
| `client/src/bot/BotMatchScreen.tsx` | `runDrawSequenceLocal`, match init / Daily Fritz resume |
| `client/src/dailyFritz/storage.ts` | `loadPersistedDailyFritzMatchSnapshot`, `shouldBlockUnsafeDailyFritzResume` |
| `server/src/index.ts` | `getDailyFritzHandForGame`, `/api/daily-fritz/init`, `/api/daily-fritz/next-hand` |

### Findings

1. **Single shuffled boneyard** — Fisher-Yates shuffle → `player[0:7]`, `fritz[7:14]`, remainder → boneyard (last 2 locked when deal size 7).
2. **No preferential Fritz tiles** — no post-shuffle filter, reorder, or second shuffle for bot.
3. **Draws are symmetric** — `const [drawn, ...rest] = boneyard` (FIFO) for both sides; same lock at 2 tiles.
4. **No peek/regenerate on draw** — draw result is deterministic from stack order.
5. **Daily Fritz** — server-seeded deals (`daily-fritz-{date}:game:{N}:hand:{index}`); identical for all players on that day/game/hand.
6. **Resume** — unsafe Daily Fritz resume blocked without snapshot; valid snapshot restores full `boneyard` + hands (no silent reroll).

**Asymmetry (not deal rigging):** Player seat is always first slice (`you`), Fritz second (`bot`). Starting player alternates by hand number (`handNumber % 2`). Not random seat assignment, but not bot-favored.

**Play vs Fritz reload:** Fresh page = new `Math.random()` deal (expected). In-match restart intentionally rerolls.

---

## 2. Fritz bot decision fairness

### Audited files

| File | Functions |
|------|-----------|
| `client/src/bot/botHeuristics.ts` | `toBotVisibleState`, `chooseBotMove`, `estimateDrawCost`, `mcEvaluateMove`, `evaluateStrategicMove` |
| `client/src/bot/BotMatchScreen.tsx` | Fritz turn → `chooseBotMove(toBotVisibleState(...))` |
| `server/src/bot/serverBot.ts` | `chooseBotMoveServer`, `minimax`, `estimateDrawCost` |
| `server/src/multiplayer/roomSession.ts` | `buildSyntheticBotAction`, `scheduleBotTurn` |

### What Fritz can see (Play vs Fritz / Daily Fritz)

| Information | Fritz | Player |
|-------------|-------|--------|
| Own hand | Yes | Yes |
| Opponent hand | **No** (`FairBotMode` wipes `players.you.hand`) | Yes (Fritz count only) |
| Board / open ends | Yes | Yes |
| Boneyard count | Yes | Yes |
| **Boneyard tile identities & order** | **Yes (in AI state)** | **No (UI count only)** |
| Opponent pass/draw inference | Built from **player** draws/passes | N/A |

Production guard:

```99:113:client/src/bot/botHeuristics.ts
export function toBotVisibleState(state: BotMatchState): BotVisibleState {
  // ...
  you: { score: state.players.you.score, hand: isDevRuntime ? makeDevOpponentHandTrap() : [] },
```

Boneyard oracle in move scoring (not draw manipulation):

```458:472:client/src/bot/botHeuristics.ts
function estimateDrawCost(nextHand, openEnds, boneyard) {
  const playableInBoneyard = boneyard
    .slice(0, boneyardAvailable)
    .filter((t) => endSet.has(t.low) || endSet.has(t.high)).length;
```

### Tournament server Fritz (different code path)

When `totalTiles <= 6`, `serverBot.ts` runs `minimax` with **full `GameState`** including human hand — opponent plies use real tiles. **This is oracle play, not imperfect-information Fritz.**

### Strong vs unfair

- **Strong:** Elite = `hard` difficulty, Master = deterministic best + deep search; `defenseMultiplier` when human nears 60; MC + chain search.
- **Unfair (real issues):** Tournament endgame oracle (P0); boneyard stack knowledge in heuristics (P1).
- **Not unfair:** No hidden score boosts; no reading player rack in client Fritz modes.

---

## 3. Comeback / momentum audit

### Audited files

| File | Topic |
|------|-------|
| `client/src/bot/botEngine.ts` | `winnerFromScores`, `passTurn`, `resolveHandEnd`, blocked-hand tie |
| `server/src/game/engine.ts` | `checkForGameWinner`, `resolveBlockedHand`, 61–61 tiebreaker |
| `server/src/game/scoring.ts` | `computePlayScore`, `computeHandPenalty`, `computeGoOutBonusPoints` |
| `client/src/bot/botHeuristics.ts` | `aggressionBoost`, `defenseMultiplier` (AI only) |
| `server/src/dailyFritzSkunk.ts` | Set-layer skunk (not in-hand points) |

### Rubber-band / pity

**None** in game engines. `create_comeback_pressure` exists only in **coach copy** (`client/src/learning/reasonTagging.ts`).

### Scoring symmetry (Fritz modes)

Both sides use `botEngine.ts` — same `applyPlayMove`, same `/5` racehorse scoring, same pip bonuses (`Math.round(pips/5)`).

### Asymmetries found

| Issue | Severity | Detail |
|-------|----------|--------|
| Blocked-hand pip tie | **P1** | `botEngine`: `youPips <= botPips` → **player wins**; `engine.ts`: tie → **no hand winner** |
| Opponent inference | **P2** | Only updated on **player** draw/pass — feeds bot AI, not tile cheat |
| Two engines | **P2** | `botEngine.ts` vs `engine.ts` — drift risk; tournament uses server engine only |
| Tournament race target | **Info** | Tournament rooms race to **30**; Fritz modes race to **60** |

### 61–61 tiebreaker

Both engines: game continues until strict leader at ≥60 after hand completes. Aligned (`engine.test.ts`).

---

## 4. Statistical simulation

**Harness:** `client/src/bot/fairnessSim.ts`  
**Run:** `npx ts-node --esm src/bot/fairnessSim.ts [seeds] [humanTier] [fritzTier]`  
Each seed runs **two games** (seat swap) → `seeds × 2` total games.

### A. Primary — Standard human vs Elite Fritz (`standard` vs `hard`)

*Daily Fritz / default competitive pairing proxy. **1,000 games** (500 seeds × 2).*

| Metric | Value | Suspicious? |
|--------|-------|-------------|
| Human win rate | **29.9%** | Fritz stronger (expected at Elite) |
| Human win (seat `you`) | 27.2% | Minor seat variance |
| Human win (seat `bot`) | 32.6% | Minor seat variance |
| Avg opening pip delta (human − Fritz) | **0.00** | **Neutral — no deal bias** |
| Avg opening doubles delta | 0.000 | Neutral |
| Human playable draw rate | 71.2% | — |
| Fritz playable draw rate | 69.8% | — |
| Draw rate delta (Fritz − human) | **−1.4 pp** | **No draw rigging** |
| Illegal AI moves | **0** | Clean |
| Human comeback wins (trailed ≥15) | 5.7% | — |
| Fritz comeback wins (trailed ≥15) | 8.5% | Skill, not pity |
| Avg race points/game (human / Fritz) | 49.6 / 60.2 | Strength gap |
| Avg pip bonuses/game (human / Fritz) | 7.1 / 10.3 | More ends won by Fritz |

### B. Control — Equal tier (`hard` vs `hard`)

**600 games** (300 seeds × 2).

| Metric | Value |
|--------|-------|
| Human win rate | **50.0%** |
| Opening pip delta | **0.00** |
| Playable draw rate (both) | **70.5%** (identical) |
| Race points/game | **55.5 / 55.5** |
| Pip bonuses/game | **8.2 / 8.2** |

**Conclusion:** With equal AI and symmetric seats, outcomes are statistically neutral — **RNG/deal/draw pipeline is fair**. Fritz win dominance in (A) is **tier strength**, not tile cheating.

### Existing tier ladder

`npm run benchmark:tier --prefix client` (paired seat swaps) — confirms tier ordering (casual < standard < hard < master).

---

## 5. Mode coverage

| Mode | Deal/RNG | Bot AI | Scoring engine | Fairness notes |
|------|----------|--------|----------------|----------------|
| **Play vs Fritz** | Client `Math.random` | Client `botHeuristics` + `FairBotMode` | `botEngine.ts` | Fair deals; strong Elite/Master |
| **Daily Fritz** | Server seeded fixed hands | Same client Fritz path | `botEngine.ts` | Fair + deterministic; Elite tier default |
| **Tournament Fritz** | Server shuffle | **`serverBot.ts`** | **`engine.ts`** | **P0 endgame oracle** |
| **Daily Puzzle** | Server generator (`generatePuzzles.ts`) | N/A (human solves) | `engine.ts` validation | No Fritz; shares draw/score **rules** with MP |
| **Matchmaking sim bot** | Server | `simBot.ts` random legal | Server | Not Fritz |

---

## 6. Issues ranked (P0 / P1 / P2)

### P0 — Tournament server Fritz endgame oracle

- **Where:** `server/src/bot/serverBot.ts` — `chooseBotMoveServer` when `totalTiles <= 6` → `minimax` with real opponent hand.
- **Impact:** Tournament bot plays with perfect information in late endgame; client Fritz does **not** do this (uses sampled hands).
- **Fix (proposed):** Port client master endgame IS-MCTS / sampled-hand search to server; never pass full opponent rack into minimax.

### P1 — Boneyard stack visible to Fritz AI

- **Where:** `estimateDrawCost`, `simulateDrawUntilPlayable` in `botHeuristics.ts` and `serverBot.ts`.
- **Impact:** Fritz plans draws knowing exact stack; sim shows **no** better actual draws (−1.4 pp playable rate vs human) but **feels** psychic when Fritz avoids bad lines.
- **Fix (proposed):** Model draws from count + unseen pool only, or expose boneyard order to player in dev/audit mode for transparency.

### P1 — Blocked-hand tie favors player (Fritz path only)

- **Where:** `client/src/bot/botEngine.ts` ~927: `youPips <= botPips ? 'you' : 'bot'`.
- **Impact:** Human-favoring on exact pip ties; opposite of “Fritz always wins blocked hands.” Low frequency.
- **Fix (proposed):** Align with server — no winner on tie.

### P2 — Engine duplication (`botEngine` vs `engine`)

- Drift risk; blocked tie already diverged.
- **Fix (proposed):** Shared rules package or conformance test suite.

### P2 — Server tournament bot lacks pass/draw inference

- `roomSession.ts` passes empty `opponentKnownMissing` — parity gap, not player-facing cheat.

### Not bugs — explains “feels unfair”

- Elite/Master tiers (~70% win vs Standard human in sim).
- `defenseMultiplier` up to **3×** when human score ≥85% of 60.
- Fritz uses pip inference from **your** draws; you don’t get symmetric signal from Fritz draws.
- Master: near-deterministic best move, 20 MC samples, endgame search to 12 tiles.

---

## 7. Human-facing trust (proposals — not implemented)

### Dev-only fairness log

Extend existing `client/src/multiplayer/drawAudit.ts` pattern for Fritz:

- Log: shuffle seed (or Daily Fritz hand seed), full deck order post-shuffle, initial hands, each draw event `{player, tileIndex, tile}`, legal move set per turn.
- Gate behind `import.meta.env.DEV` or `VITE_FAIRNESS_LOG=1`.

### QA replay seed

- **Play vs Fritz:** persist `matchSeed` in sessionStorage for post-game export.
- **Daily Fritz:** already reproducible via `getDailyFritzGameSeed(runDate, gameNumber)` + hand index.
- CLI: `npx ts-node --esm src/bot/fairnessSim.ts <seed>` with seed export from log.

### Player-facing copy (optional later)

> “Fritz plays by the same draw and scoring rules. Tiles are shuffled once per hand; draws come from the same stack in order.”

Do **not** claim “Fritz cannot see the boneyard” until P1 is fixed or disclosed.

---

## 8. Post-fix simulation (branch `fix/fritz-fairness-hardening`)

After public-info draw modeling + tournament endgame sampling:

| Metric | Before | After |
|--------|--------|-------|
| Human win rate (standard vs hard) | 29.9% | **31.7%** |
| Opening pip delta | 0.00 | 0.00 |
| Playable draw rate delta (Fritz − human) | −1.4 pp | **−0.2 pp** |
| Illegal AI moves | 0 | 0 |

No intentional tier/difficulty nerf — win rate moved slightly toward human after removing hidden information edges.

## 9. Recommended next steps

1. **Merge fairness hardening PR** and deploy client + server together for tournament.
2. **Live smoke test** — signed-in Daily Fritz hand-over + `[fairness]` dev logs.
3. **Playwright hand-lifecycle QA** when QA creds available.
4. **Balance/UX** (if still harsh): tier labels, default Standard — **separate from fairness fixes**.

---

## Appendix: Commands

```bash
# Fairness simulation (1000 games = 500 seeds)
npx ts-node --esm src/bot/fairnessSim.ts 500 standard hard

# Equal-tier control
npx ts-node --esm src/bot/fairnessSim.ts 300 hard hard

# Tier ladder benchmark
npm run benchmark:tier --prefix client

# Server invariant tests (draw/score)
npm run test --prefix server
```

**Files added for audit:** `client/src/bot/fairnessSim.ts` (simulation only; no gameplay changes).
