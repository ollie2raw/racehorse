# Fritz Calibration & Perception Audit

**Date:** 2026-06-12  
**Baseline:** `main` @ `5ac6523` (post–PR #2 fairness hardening, post–`P0fixes` revert)  
**Constraint:** Audit + measurement only — no gameplay, difficulty, or bot-strength changes in this pass.

---

## Executive summary

| Question | Verdict |
|----------|---------|
| **Is Fritz technically fair?** | **Yes** — hidden hand and boneyard-order oracle edges removed in PR #2; FIFO draws unchanged; 0 illegal AI moves in all sims. |
| **Are difficulty tiers calibrated for labels?** | **Partially** — tiers differentiate in bot-vs-bot ladder, but **Elite/Master are much stronger than player-facing copy implies** for typical humans. Rookie is appropriately forgiving vs a standard-skilled opponent. |
| **Is Daily Fritz too hard for average players?** | **Likely yes** — default **Elite** + best-of-3 ⇒ ~**23–32% set win** for a *standard-tier bot proxy*; real casual humans likely lower. |
| **Are “feels rigged” moments cheating?** | **Mostly no** — miracle rates (draw→score, back-to-back scores, 3-in-6 windows) are within **~6–10%** of symmetric same-tier controls → **variance + skill**, not hidden rules. |
| **Safe to plan next hardening PR?** | **Yes** — focus on calibration, engine parity tests, trust UX, and tournament/client bot alignment (not anti-cheat). |

---

## 1. Difficulty calibration audit

### Method

- **Primary harness:** `client/src/bot/fairnessSim.ts` — 400 seeds × 2 seat swaps = **800 games** per row (standard human proxy vs Fritz tier).
- **Ladder cross-check:** `client/src/bot/benchmark.ts pair` — 200 seeds × 2 = 400 games per bot-vs-bot pairing.
- **Tier mapping (product → engine):** `client/src/bot/fritzConfig.ts`

| Product tier | `BotDifficulty` | Intended feel |
|--------------|-----------------|---------------|
| Rookie | `casual` | Forgiving / beatable |
| Standard | `standard` | Balanced casual |
| Elite | `hard` | Strong competitive |
| Master | `master` | Brutal but honest |

**Important limitation:** Simulated “human” is a **standard-tier bot**, not real players. Absolute win rates understate how hard Elite feels to casual humans; **relative tier ordering** is still valid.

### Results — standard proxy vs each Fritz tier (race to 60)

| Fritz tier | Human win rate | Seat you | Seat bot | Avg margin | Fritz comeback ≥15 | Human comeback ≥15 | Illegal moves |
|------------|----------------|----------|----------|------------|--------------------|--------------------|---------------|
| **Rookie** (`casual`) | **75.5%** | 70.0% | 81.0% | — | 4.4% | 9.1% | 0 |
| **Standard** | **50.0%** | 50.5% | 49.5% | — | 8.3% | 8.3% | 0 |
| **Elite** (`hard`) | **31.5%** | 30.8% | 32.3% | — | 8.6% | 4.9% | 0 |
| **Master** | **~29.7%** | 26.7% | 32.7% | — | 8.0% | 4.7% | 0 |

*Master row: 150-seed run (slower endgame search). Elite/others: 400 seeds.*

### Bot-vs-bot ladder (validates tier ordering)

| Matchup (A vs B) | A win % | Avg \|margin\| | Skunk % | Avg hands | Blowout ≥30 |
|------------------|---------|----------------|---------|-----------|-------------|
| casual vs standard | 28.0% | 20.5 | 11.8% | 6.93 | 25.8% |
| casual vs hard | 12.5% | 24.7 | 20.8% | 6.30 | 35.5% |
| standard vs hard | 29.8% | 21.4 | 13.5% | 6.32 | 26.3% |

### Calibration verdict by tier

| Tier | Verdict | Classification |
|------|---------|----------------|
| **Rookie** | Standard proxy wins ~3 in 4 — **beatable** for learning | ✅ Matches “beginner” if player is intermediate; may still stomp true novices |
| **Standard** | 50/50 vs standard proxy | ✅ Balanced casual |
| **Elite** | Proxy wins ~1 in 3 — **dominant** | ⚠️ **Calibration** — label says “competitive,” not “you should lose 2 of 3” |
| **Master** | ~30% proxy win — only ~2pp stronger than Elite in sim | ⚠️ **Calibration** — Master endgame search is costly; margin over Elite may be understated in short runs |

**Seat/order bias:** Elite seat spread **30.8% vs 32.3%** (~1.5pp). Hand-1 starter alternates by `handNumber`. **Minor**, not P0.

---

## 2. “Feels rigged” moment audit

### Method

- **Harness:** `client/src/bot/feelsRiggedAudit.ts` (local, uncommitted) — 250 seeds × 2 seats = 500 games per scenario.
- Compared **standard vs elite** to **symmetric controls** (`hard vs hard`, `standard vs standard`).

### Events per game (mean count)

| Event | Std vs Elite | Hard vs Hard (control) | Std vs Std (control) | Interpretation |
|-------|--------------|------------------------|----------------------|----------------|
| Fritz draw → score | 2.47 | 2.25 | 2.75 | **Normal** (+10% vs hard control) |
| Fritz back-to-back scores | 7.24 | 6.84 | 6.07 | **Normal** (+6%) |
| Fritz 3+ scores in 6 turns | 8.52 | 8.01 | 6.56 | **Normal** (+6%; std control lower due to weaker play) |
| Fritz comeback win (trailed ≥15) | 0.076 | 0.088 | 0.094 | **Normal** (slightly *fewer* than controls) |
| Fritz wins after human near-win (≥59) | 0.056 | 0.064 | 0.084 | **Normal** |
| Human draw → score | 2.36 | 2.25 | 2.75 | Symmetric band |
| Endgame Fritz scoring turns | 10.63 | 9.73 | 10.36 | **Calibration** — +9% vs hard-hard when human is only standard |
| Endgame human scoring turns | 8.65 | 9.73 | 10.36 | Human underperforms in endgame vs Elite |

**Conclusion:** Spikes players describe as “rigged” (lucky draw, consecutive scores, late steals) occur at rates **consistent with symmetric bot controls**. The standout asymmetry is **endgame scoring volume** when the human side is weaker — **skill/calibration**, not hidden information.

---

## 3. Endgame sharpness audit

### Code reviewed

| File | Mechanism |
|------|-----------|
| `client/src/bot/botHeuristics.ts` | `defenseMultiplier` (1.0→3.0 when opponent ≥50–85% of race target); master sampled endgame at ≤12 tiles |
| `server/src/bot/serverBot.ts` | Same `defenseMultiplier` curve; sampled endgame at ≤6 tiles |

```1360:1363:client/src/bot/botHeuristics.ts
  const defenseMultiplier =
    youProximity >= 0.85 ? 3.0 :
    youProximity >= 0.7  ? 1.8 :
    youProximity >= 0.5  ? 1.2 : 1.0;
```

### Measurements

- **Endgame turns/game:** ~60 (std vs elite), ~56 (hard vs hard).
- **Fritz endgame scoring rate:** 10.63/59.87 ≈ **17.8%** of endgame turns score (elite matchup); human **14.5%**.
- **Master vs Elite:** Sim win-rate delta small (~2pp) — Master’s extra strength is **concentrated in endgame search depth**, not deal rigging.

### Verdict

| Finding | Severity | Type |
|---------|----------|------|
| `defenseMultiplier` up to **3×** threat weight when human near race target | **P1** | **Calibration / perception** — can feel like “God mode” after one mistake |
| Elite/Master endgame sampled search | **P1** | **Calibration** — honest but sharp |
| No hidden endgame information post PR #2 | — | Fair |

**Do not tune `defenseMultiplier` yet** — measure in production telemetry first if available.

---

## 4. Seat / order fairness

| Metric | Value |
|--------|-------|
| Human win rate (seat `you`) vs Elite | 30.8% |
| Human win rate (seat `bot`) vs Elite | 32.3% |
| Hand-1 starter | Fritz (`bot`) in PVF sim; alternates each hand |
| Daily Fritz deals | Server-seeded fixed order per day/game/hand — **fair across players**, not per-user bias |

**Verdict:** **P2** minor seat skew; Daily Fritz seed is symmetric. Tournament bracket seeding by rating is intentional.

---

## 5. Rules symmetry / engine parity audit

### Files compared

| Client (Fritz modes) | Server (multiplayer / tournament) |
|----------------------|-----------------------------------|
| `client/src/bot/botEngine.ts` | `server/src/game/engine.ts` |
| `client/src/bot/botHeuristics.ts` | `server/src/bot/serverBot.ts` |

### Aligned (verified)

| Rule | Client | Server |
|------|--------|--------|
| FIFO boneyard draw | `const [drawn, ...rest] = boneyard` | Same |
| Boneyard lock (2 dead) | `BONEYARD_LOCKED_COUNT = 2` | `deadTileCount` in config |
| Blocked pip tie → no hand winner | `lastHandWinner: null` | `handWinnerId = null` |
| Race-to-N tied leaders continue | `winnerFromScores` null on tie | `checkForGameWinner` null if multiple leaders |
| Multiples-of-five scoring | `computePlayScore` | `computePlayScore` (shared scoring module on server) |

### Known intentional differences

| Area | Client | Server |
|------|--------|--------|
| Opponent pip inference on draw | `opponentKnownMissing` updated when **human** draws (`botEngine.ts` ~985) | Multiplayer inference via room state / UI |
| Blocked hand config | Always lowest-pips bonus path in bot engine | `blockedHandRule` config (`lowestPips` vs `noScore`) |
| Tournament race length | PVF default 60 | Tournament rooms **`winningScore: 30`** |

### Drift risks (unintentional)

| Risk | Severity | Notes |
|------|----------|-------|
| **Dual engines** — legal moves, opening rules, forced draw | **P1** | No shared conformance suite; future rule edits can diverge silently |
| **Dual bot brains** — `botHeuristics` vs `serverBot` | **P1** | Similar structure, different `TIER_SELECT` / search depths / no rookie on server |
| Opening double/scoring detection | **P2** | Separate implementations — behavior tests on client only |
| Hub doubles / complex board | **P2** | Client `botEngine` has Racehorse board model; server `engine.ts` documents hub doubles |

### Missing conformance tests

- Golden-scenario parity: same seed → same legal move sets (client vs server).
- Blocked hand, 61–61 continuation, tournament race-to-30 game-end.
- Cross-bot: PVF Elite move vs server Elite on identical exported state.

---

## 6. Tournament bot parity audit

### Code reviewed

| File | Role |
|------|------|
| `server/src/bot/serverBot.ts` | Tournament Fritz decisions |
| `server/src/multiplayer/roomSession.ts` | `chooseBotMoveServer(..., tier)` |
| `server/src/scheduledTournament/engine.ts` | `botTierForRound`: QF **standard**, SF **elite**, Final **master** |
| `server/src/rooms.ts` | `scheduledTournamentBotTier`, `winningScore: 30` |

### Fairness (post PR #2)

| Check | Status |
|-------|--------|
| No real human hand in endgame | ✅ `chooseEndgameMoveSampled` |
| No boneyard stack order in AI | ✅ `estimateDrawCostFromPublicInfo` |
| Legal moves / pass when blocked | ✅ `serverBot.fairness.test.ts` |

### Parity gaps

| Gap | Severity |
|-----|----------|
| Server has **no Rookie/casual** tier | P2 |
| `TIER_SELECT` differs (e.g. client standard `pBest: 0.86`, server `0.82`) | P1 perception |
| Tournament **race-to-30** vs PVF **race-to-60** | P1 calibration — games end in endgame-defense zone more often |
| Round-based tier ramp (std→elite→master) | Intentional — late rounds feel harder |

**Verdict:** Tournament Fritz is **fair** but **not the same species** as Play vs Fritz Elite — different engine path, scoring target, and tier table.

---

## 7. Daily Fritz fairness / retention audit

### Configuration (code)

| Setting | Value | Source |
|---------|-------|--------|
| Default `fritz_tier` | **`elite`** | `server/src/index.ts` `generateDailyFritzRun(..., options?.fritzTier ?? 'elite')` |
| Format | **Best of 3**, race to **60** | `dailyFritz.ts`, `DailyFritzSetResult` |
| Deals | Server-seeded per day/game/hand | `generateDailyFritzRun` / `getDailyFritzGameSeed` |
| Client difficulty | `FRITZ_TIERS[fritz_tier].difficulty` → Elite = `hard` | `fritzConfig.ts`, `BotMatchScreen.tsx` |

### Simulated retention signals (standard bot proxy vs Elite)

| Metric | Estimate |
|--------|----------|
| Single game win rate | **~31.5%** |
| **Best-of-3 set win rate** | **~23–24%** (`p²(3−2p)` at p≈0.315) |
| Brutal **0–2** set loss | **~47%** (`(1−p)²`) |
| Split-then-loss paths | Remaining ~30% |

### Options (recommend only — not implemented)

| Option | Pros | Cons |
|--------|------|------|
| Keep Elite, improve labeling | Honest daily challenge | High churn for casual hero mode |
| Daily = **Standard** tier | Better retention / wider completion | Veterans may find too easy |
| **First-run Standard**, recurring Elite | Onboarding + prestige | More product logic |
| BO3 → single game for first week | Lower commitment | Changes leaderboard semantics |

**Verdict:** **P1 calibration + UX** — Daily Fritz is likely **too hard** for average players relative to “hero mode” retention goals, even though it is **fair**.

---

## 8. Human-facing trust UX recommendations

Accurate, non-deceptive copy only:

| Recommendation | Priority | Notes |
|----------------|----------|-------|
| **Difficulty labels with expected outcome band** | P1 UX | e.g. “Elite — strong; most players lose more than half of matches” |
| **Daily Fritz up-front tier disclosure** | P1 UX | “Today’s Fritz: Elite (competitive)” already partially present — add win-rate band |
| **Post-game one-liner** | P2 UX | “Same shuffle and draw order for both sides.” / “Fritz does not see your hand.” — **true post PR #2** |
| **Optional “swing turn” highlight** | P2 UX | Largest scoring turn differential — explain skill, not luck |
| **Dev fairness log** (`fairnessLog.ts`, `VITE_FAIRNESS_LOG`) | P2 | Already exists — document for internal QA |
| **Do not claim** “perfect play” or “certified random” without audit scope | — | Avoid overclaim |

---

## 9. Findings ranked

### P0 — actual unfairness

*None identified on current `main` after PR #2.*

### P1 — calibration / drift / retention

1. **Elite/Master too strong vs typical humans** for product copy (“balanced”, “hero mode”).
2. **Daily Fritz default Elite + BO3** → low set win rate for average skill.
3. **`defenseMultiplier`** late-game defensive sharpness — perception of “punish after one miss”.
4. **Dual engine + dual bot** drift risk without conformance tests.
5. **Tournament bot ≠ PVF bot** (tier table, race length, heuristic constants).

### P2 — minor / engineering

1. ~1.5pp seat bias in sim.
2. Server bot lacks Rookie tier.
3. Master sim/runtime cost for CI benchmarking.
4. Blocked-tie null winner UX (lose SFX) — from prior audit.

### UX / perception (not bugs)

1. “Miracle” moments match symmetric bot variance — **education** problem.
2. Difficulty picker does not set **expectations**.
3. No post-game fairness framing.

### Normal domino variance

- Draw-then-score chains, pip bonuses, 10–15 point swings, occasional Fritz comeback wins at rates **≤ symmetric controls**.

---

## 10. Recommended next PR scope

**Shipped in `hardening/fritz-trust-guardrails`:** engine parity tests, bot honesty tests, trust UX copy, `docs/fritz-trust-guardrails.md`. See that doc for drift risks and test pack locations.

**PR title (suggested):** `hardening: fritz calibration baseline + engine parity tests + trust UX (no strength nerf)`

### In scope

1. **Engine parity test pack** — golden positions: legal moves, blocked tie, 61–61, forced draw, FIFO draw order (`botEngine` ↔ `engine.ts`).
2. **Trust UX pass** — difficulty labels, Daily Fritz tier expectation copy, post-game fairness one-liner (accurate only).
3. **Telemetry hooks** (if lightweight) — endgame scoring rate, defenseMultiplier active flag, match tier — for production calibration.
4. **Document** tier sim baselines in `docs/` (this report + JSON artifacts).

### Explicitly out of scope (follow-up PR)

- `defenseMultiplier` tuning or bot strength nerf.
- Daily Fritz tier change without product decision.
- Tournament race length change.
- Merging `botEngine` and `engine.ts` (large refactor).

---

## Artifacts & local files (uncommitted)

| File | Purpose |
|------|---------|
| `client/src/bot/calibrationAudit.ts` | Full matrix + BO3 + tournament proxy (slow on Master) |
| `client/src/bot/feelsRiggedAudit.ts` | Miracle-moment counters |
| `/tmp/feels-rigged.json` | 250-seed miracle run output |
| Existing: `client/src/bot/fairnessSim.ts`, `benchmark.ts` | Tier win rates, ladder |

### Commands to reproduce

```bash
# Tier win rates (800 games each)
npx ts-node --esm src/bot/fairnessSim.ts 400 standard casual   # vs Rookie
npx ts-node --esm src/bot/fairnessSim.ts 400 standard standard
npx ts-node --esm src/bot/fairnessSim.ts 400 standard hard     # vs Elite
npx ts-node --esm src/bot/fairnessSim.ts 200 standard master

# Bot ladder
npx ts-node --esm src/bot/benchmark.ts pair standard hard 200

# Miracle moments
npx ts-node --esm src/bot/feelsRiggedAudit.ts 250
```

---

## Files / functions reviewed

| Area | Files |
|------|-------|
| Client bot | `botEngine.ts`, `botHeuristics.ts`, `fritzConfig.ts`, `publicDrawCost.ts`, `fairnessSim.ts`, `benchmark.ts`, `BotMatchScreen.tsx` |
| Server bot | `serverBot.ts`, `publicDrawCost.ts`, `serverBot.fairness.test.ts` |
| Server rules | `game/engine.ts`, `game/scoring.ts` |
| Daily Fritz | `dailyFritz.ts`, `dailyFritzSkunk.ts`, `index.ts` (generate/run APIs) |
| Tournament | `scheduledTournament/engine.ts`, `matchDispatch.ts`, `roomSession.ts`, `rooms.ts` |
| Prior audit | `docs/fritz-fairness-audit-report.md` |
