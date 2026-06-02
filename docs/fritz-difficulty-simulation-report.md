# Fritz Difficulty — Simulation Report

**Date:** 2026-06-01  
**Reference audit:** `docs/fritz-difficulty-tiers-source-of-truth-audit.md`  
**Raw data:** `docs/fritz-tier-benchmark-200.json` (interim: `docs/fritz-tier-benchmark-50.json`)  
**Harness:** `client/src/bot/benchmark.ts`  
**No gameplay, Daily Fritz default, skunk, or UI changes in this pass.**

---

## Methodology

### What we simulated

- **Head-to-head Fritz tiers** playing full **race-to-60** matches (7-tile deals, same rules as client `botEngine.ts`).
- Each **seed** runs **two games** with swapped seat/difficulty (P1 = `bot` seat, P2 = `you` seat) to reduce first-player bias.
- **Paired reporting:** “Tier A win%” = wins for the first difficulty in the matchup label, across both seatings.
- **Fair bot visibility:** `toBotVisibleState()` before every `chooseBotMove()` (matches production bot matches).

### Tier names

| Product | `BotDifficulty` in code |
|---------|-------------------------|
| Rookie | `casual` |
| Standard | `standard` |
| Elite | `hard` |
| Master | `master` |

### Metrics

| Metric | Definition |
|--------|------------|
| **Win rate** | % of games won by Tier A (400 games per row at 200 seeds) |
| **Avg \|margin\|** | Mean absolute score difference at game end (winner − loser) |
| **Median \|margin\|** | Median of absolute margins |
| **Skunk rate** | % of games where **loser’s race score &lt; 30** (Daily Fritz skunk threshold proxy) |
| **Margin ≥ 30** | % of games with final margin ≥ 30 (blowout proxy) |
| **Avg hands / game** | Hands completed before someone reaches 60 |
| **Avg moves / game** | Play/draw steps counted per game |

### Seeds and runtime

- **Primary run:** **200 seeds** → **400 games** per matchup row (~2,800 games total).
- **Wall time:** ~30 minutes on Apple Silicon (Master-heavy pairings dominate: ~857s for `hard vs master`, ~900s for `casual vs master`).
- **Reproduce:**

```bash
cd client
npm run test:bot:tier
npx ts-node --esm src/bot/benchmark.ts ladder-json 200 ../docs/fritz-tier-benchmark-200.json
```

Console table: `npx ts-node --esm src/bot/benchmark.ts ladder 200`

### What we did *not* simulate

- Daily Fritz **best-of-3 set** or server deal files (proxy = single race-to-60 games).
- Human players, coaching, or UI think-delay (1500ms not modeled).
- **Server tournament bot** (`serverBot.ts`) — see § Server/client parity.

---

## Tier ladder results (200 seeds)

| Matchup | Tier A win% | Avg \|margin\| | Med \|margin\| | Skunk% | Avg hands | Avg moves | Margin≥30% |
|---------|------------:|---------------:|---------------:|-------:|----------:|----------:|-------------:|
| Rookie vs Standard | **25.0%** | 21.9 | 21.0 | 14.8% | 6.79 | 155 | 26.8% |
| Rookie vs Elite | **13.0%** | 25.5 | 24.5 | 25.0% | 6.26 | 140 | 39.0% |
| Standard vs Elite | **29.5%** | 20.1 | 18.0 | 11.5% | 6.40 | 142 | 22.8% |
| Elite vs Master | **38.3%** | 19.7 | 18.0 | 11.5% | 5.99 | 132 | 23.5% |
| Rookie vs Master | **8.0%** | 30.1 | 31.0 | 35.3% | 5.89 | 131 | 52.0% |

**Monotonic strength (win rate when facing strictly stronger tier):** Rookie &lt; Standard &lt; Elite &lt; Master — **confirmed** on this harness.

**95% CI (illustrative, Elite vs casual proxy):** 87% ± ~3.3% on n=400 (binomial).

---

## Daily Fritz harshness proxy (200 seeds)

Simulates “one race-to-60 game” with **Elite (`hard`)** as Fritz vs weaker tier (stand-in for casual player skill).

| Matchup | Elite win% | Skunk% (loser &lt; 30) | Margin≥30% | Med \|margin\| |
|---------|----------:|------------------------:|------------:|---------------:|
| **Elite vs Rookie** | **87.0%** | **25.0%** | **38.8%** | 24.5 |
| **Elite vs Standard** | **70.5%** | **11.5%** | **22.8%** | 18.0 |

**Interpretation**

- Against a **Rookie-level** opponent proxy, Elite wins **~7 of 8** games; **1 in 4** ends with the loser still under 30 points (skunk-equivalent).
- Against **Standard**, Elite still wins **~7 in 10** — material but not total domination.
- **~39% blowouts** (margin ≥ 30) vs Rookie suggests many games feel “over before they start” for weak play.

This supports the product intuition that **fixed Elite Daily Fritz** is punishing for players who would otherwise play Rookie/Standard in PVF.

---

## Surprising findings

1. **Elite beats Master ~38% of the time** in race-to-60 bot-vs-bot. Master is stronger overall but not crushing Elite; both tiers are near ceiling for dominoes AI. Product impact: Master is mainly for experts/tournaments, not a huge step up from Elite in single-game race mode.

2. **Rookie wins 25% vs Standard** — Rookie is weak but not useless; mistake injection still wins a quarter of games against Standard.

3. **Skunk proxy is high vs weak tiers:** Rookie vs Master → **35%** skunk rate and **52%** margin≥30. Daily Fritz skunk rules would amplify “bad day” feeling when the human plays like Rookie vs Elite.

4. **Master speeds up games** (~5.9 hands vs ~6.8 Rookie vs Standard) — stronger play closes races faster (fewer comeback beats).

5. **Existing `test:bot` regression:** `botHeuristics.behaviorTests.ts` **Test 6** (refill-risk) **fails** on current heuristics (pre-existing; not introduced by this pass). **Tier tests pass:** `npm run test:bot:tier`.

---

## Tier behavior sanity tests

**File:** `client/src/bot/tierDifficulty.behaviorTests.ts`  
**Command:** `npm run test:bot:tier`

| Test | Assertion |
|------|-----------|
| Rookie vs Elite fixture | Elite **avoids** unsupported early **3-3** double Rookie may consider |
| Standard vs Elite fixture | Standard and Elite **do not always** pick same tile/side/immediate score |
| Master vs Elite endgame (4 tiles left) | Both move; Master **immediate ≥** Elite on exit line |

These prove tiers are **not cosmetic** without locking full heuristic scores.

---

## Server / client parity note

| Aspect | Client (`botHeuristics.ts`) | Server (`serverBot.ts`) |
|--------|----------------------------|-------------------------|
| Tiers | Rookie, Standard, Elite, Master | **Standard, Elite, Master only** |
| Suboptimal picks | Seeded PRNG per board state | `Math.random()` in `tierSelect` |
| Rookie / casual | Full separate eval path | **Not present** |
| Tournament mapping | N/A | QF standard → SF elite → F master |

**Recommendation:** Treat this report as authoritative for **PVF + Daily Fritz (client)**. Before tuning **tournament** bots, run a small **position-export parity** script (same legal positions → compare moves) or mirror `benchmark.ts` against `chooseBotMoveServer`. **Not run in this pass.**

---

## Is Rookie actually beginner-friendly?

**Partially in code, not in outcomes.**

- **Code:** Simpler eval + ~34% intentional suboptimal/random moves — real downgrade.
- **Sim:** Rookie wins **13%** vs Elite and **8%** vs Master; loses **75%** vs Standard.
- **Verdict:** Fine as “learning” opponent if the player expects to lose often and improve. **Not** beginner-friendly if the goal is ~40–50% win rate for morale. Tuning would require higher `pRandom` / weaker eval — **out of scope here**.

---

## Is Standard a better default for casual users?

**Yes, vs Elite default.**

| Opponent | Standard win% (200 seeds) |
|----------|---------------------------|
| vs Elite | **29.5%** |
| vs Master | (not run directly; Rookie vs Master 8%) |

Elite vs Standard proxy: Elite wins **70.5%** — still favored but **~17 points** more winnable than Elite vs Rookie (87%).

**Suggestion:** Default PVF to **Standard** for new/casual accounts (product change only; not implemented).

---

## Is Daily Fritz Elite too punishing for casual players?

**Likely yes**, for players whose true skill is closer to Rookie/Standard:

| Signal | Value |
|--------|------|
| Elite vs Rookie proxy win% | **87%** |
| Skunk-equivalent rate | **25%** |
| Blowout (margin≥30) | **~39%** |

Combined with real Daily Fritz **G1 skunk → instant 0–2 set** (see skunk doc), a bad first game can end the **entire daily** quickly with little recovery.

**Mitigations to consider later (product only):**

- Separate **Daily Fritz Casual** run (`standard` tier) + leaderboard track
- Keep Elite daily for competitive streak; route new users to Standard PVF + Casual daily
- Soften skunk **only** on casual track — not recommended for Elite LB integrity

---

## Recommended product decision (no code in this pass)

1. **Keep Elite Daily Fritz** for the competitive daily identity **if** the audience is experienced players.
2. **Add or promote a softer on-ramp:** Standard (or Rookie) in **PVF default** + optional **second daily track** at Standard tier with separate LB.
3. **Do not nerf Elite heuristics** until sims show Rookie/Standard at target win rates (e.g. Rookie 35–45% vs Standard).
4. **Schedule server bot parity check** before changing tournament tiers.
5. **Fix or quarantine** failing `botHeuristics` Test 6 separately from tier work.

---

## Validation

| Check | Result |
|-------|--------|
| `npm run test:bot:tier` | **Pass** |
| `npm run test:bot` | **Fail** — Test 6 refill-risk (pre-existing) |
| `npm run build` (client) | **Pass** |
| Server build | **Not run** (no server changes) |

---

## Artifacts added/changed

| File | Purpose |
|------|---------|
| `client/src/bot/benchmark.ts` | Extended sim + `ladder` / `ladder-json` CLI |
| `client/src/bot/tierDifficulty.behaviorTests.ts` | Tier differentiation tests |
| `client/package.json` | `benchmark:tier`, `test:bot:tier` scripts |
| `docs/fritz-tier-benchmark-200.json` | Raw 200-seed results |
| `docs/fritz-tier-benchmark-50.json` | Raw 50-seed cross-check |
| `docs/fritz-difficulty-simulation-report.md` | This report |

---

## Suggested next prompt

> Using `docs/fritz-difficulty-simulation-report.md`, propose a minimal product PR: (1) change Play vs Fritz default tier to Standard for accounts with &lt;5 PVF games, (2) spec a `daily_fritz_runs.fritz_tier = 'standard'` casual track with separate leaderboard — no heuristic changes until Rookie vs Standard sim hits 40%±5% win rate after any mistake-rate tweak.
