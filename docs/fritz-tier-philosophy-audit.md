# Fritz Tier Philosophy & Decision Reasoning Audit

**Date:** 2026-06-12  
**Baseline:** Post–PR #2 fairness + trust guardrails (branch `hardening/fritz-trust-guardrails`)  
**Constraint:** Audit only — no bot strength, difficulty values, Daily Fritz tier, scoring, or RNG changes.

---

## Executive summary

| Question | Verdict |
|----------|---------|
| Are tiers **meaningfully different** in code? | **Yes** — four distinct evaluation/selection pipelines, not just win-rate knobs. |
| Are tiers **meaningfully different** in play? | **Rookie ↔ Standard ↔ Elite: yes.** **Elite ↔ Master: partially** — often same move in midgame (~68% overlap), diverge more in complex/endgame fixtures. |
| Is Master a **final boss**? | **Not for strong humans** — you beating Master 3/5–4/5 is consistent with audit. Master is **Elite+** in code (deeper search, deterministic picks), not a separate species. |
| Is Elite ~36–40% vs Master acceptable? | **Directionally yes, slightly soft** — Master wins ~**63%** vs Elite in bot-vs-bot (below 65–75% reference band). Not a bug; calibration headroom. |
| Should Master be buffed now? | **No** — collect human-skill benchmarks first; your results suggest label may oversell more than code under-delivers for experts. |
| Daily Fritz stay Elite? | **Recommend keep Elite for now** with honest labeling; optional future “Daily Standard” or first-run onboarding — not a fairness issue. |
| Next production PR? | **Human-skill benchmark harness + optional tier-overlap CI** — not strength tuning until product decision. |

---

## 1. Tier configuration audit

### Where tiers are defined

| Layer | File | Mapping |
|-------|------|---------|
| Product labels | `client/src/bot/fritzConfig.ts` | rookie→`casual`, standard→`standard`, elite→`hard`, master→`master` |
| PVF / Daily Fritz AI | `client/src/bot/botHeuristics.ts` | `chooseBotMove(state, BotDifficulty)` |
| Tournament AI | `server/src/bot/serverBot.ts` | `chooseBotMoveServer(state, botId, …, ServerBotTier)` — **no Rookie** |
| Tournament round tiers | `server/src/scheduledTournament/engine.ts` | QF `standard`, SF `elite`, Final `master` |
| Daily Fritz default | `server/src/index.ts` | `fritz_tier ?? 'elite'` |

### Tier behavior table

| Tier | Intended identity | Actual code behavior | Key strengths | Intentional mistakes | Risk |
|------|-------------------|----------------------|---------------|----------------------|------|
| **Rookie** (`casual`) | Forgiving learner | **Separate scorer**: immediate×10 + pip unload only. `TIER_SELECT`: pool 5, pBest 0.69, **pRandom 0.04** (~34% non-best). No MC/strategic eval. | Simple scoring plays, high pip dump | Random legal move ~4%; frequent suboptimal pool picks; ignores chains/defense | May still crush true beginners on race-to-60 |
| **Standard** | Balanced casual | **Light strategic**: immediate×60 + threat×8 + mobility×5 + self-opportunity×10. Pool 4, pBest 0.86 (~14% non-best). No MC. | Solid immediate scoring | Ignores deep chains; ~14% pick from top-4 non-best | Beats Rookie ~74% bot-vs-bot ✓ |
| **Elite** (`hard`) | Strong competitive | **Full strategic + MC×8** + chain tree. Pool 3, pBest 0.97 (~3% non-best). `defenseMultiplier` active. Optional exact chain boost ≤16 tiles. | Chains, defense near lead, inference | ~3% intentional suboptimal from pool | Daily Fritz default; hard for average humans |
| **Master** | Brutal expert | **Same eval as Elite** plus: MC×**20**, wider `dynamicChainParams`, **two-ply worst-case** always on, **IS-MCTS endgame** at ≤**12** tiles (16 samples + minimax). Pool 1, pBest 1.0 (**0% noise**). | Deterministic best line; sharper endgame | **Almost no mistakes** — only differs when search changes ranking | **Elite+ overlap ~68%** midgame; strong humans win often |

### What does **not** differ by tier

- `defenseMultiplier` (1.0→3.0 when opponent near race target) — **same all tiers** that use full eval (Standard uses threat but same proximity curve in MC path for Elite/Master)
- Deal, shuffle, FIFO draw — unchanged
- Hidden-info model — public + sampling only (post PR #2)
- Pass/draw inference (`inferMissingPips`, `opponentKnownMissing`) — same machinery when eval runs

### Play vs Fritz vs Daily Fritz vs Tournament

| Mode | Engine | Tiers available | Race target |
|------|--------|-----------------|-------------|
| Play vs Fritz | `botHeuristics.ts` | Rookie–Master | 60 |
| Daily Fritz | `botHeuristics.ts` via `FRITZ_TIERS[tier].difficulty` | Configured per day (default **elite**) | 60, BO3 |
| Tournament | `serverBot.ts` | standard / elite / master only | **30** |

Server `TIER_SELECT` differs slightly from client (e.g. Elite pBest 0.94 vs 0.97) — **parity gap**, not cheating.

---

## 2. Decision overlap audit

### Method

- **Quick sample:** `tierOverlapQuick.ts` — 296 random bot-turn states (open board 2–5, varied hands/scores).
- **Fixtures:** `tierFixtureCompare.ts` — tierDifficulty-style endgame/refill/defense positions.

### Same-move rate (generic midgame sample)

| Pair | Same move % | n |
|------|-------------|---|
| Rookie vs Standard | **46%** | 296 |
| Standard vs Elite | **32%** differ (68% same) | 296 |
| Elite vs Master | **32% differ (68% same)** | 296 |
| Standard vs Master | **41% differ (59% same)** | 296 |

**Interpretation:** On “ordinary” positions, **Elite and Master usually agree** — obvious plays dominate. Rookie diverges most. This supports **“Master = Elite+”** more than **“different play style.”**

### Fixture examples (tiers choose differently)

**Refill-pressure** (you 58, bot 55, 6 tiles each):

| Tier | Move | Immediate |
|------|------|-----------|
| Rookie | 2-4@right | 0 |
| Standard | 2-4@right | 0 |
| Elite | **1-3@left** | 0 |
| Master | **1-4@left** | 0 |

**Endgame-exit** (4 tiles total):

| Tier | Move |
|------|------|
| Rookie | 1-4@**left** |
| Standard / Elite / Master | 1-4@**right** |

**Human-near-win** (you 57, bot 52):

| Tier | Move | Immediate |
|------|------|-----------|
| Rookie | 5-5@right (double, no score) | 0 |
| Standard / Elite / Master | 2-5@left | 2 |

**Takeaway:** Tiers diverge most on **pressure/refill/endgame** — not on every turn. Elite vs Master can still **agree** when one line is clearly best (human-near-win fixture).

---

## 3. Head-to-head calibration

### Bot-vs-bot (paired seeds × 2 seats)

| Matchup | Higher tier wins | A win % (lower tier) | Avg margin | n games | vs reference |
|---------|------------------|----------------------|------------|---------|--------------|
| Rookie vs Standard | **Standard ~74%** | 25.5% | 21.3 | 200 | 65–80% ✓ |
| Standard vs Elite | **Elite ~68%** | 32.0% | 21.2 | 200 | 65–75% ✓ |
| Elite vs Master | **Master ~63%** | 37.0% | 20.9 | 100 | 65–75% **slightly low** |
| Standard vs Master | **Master ~77%** | 23.0% | 23.6 | 100 | 75–90% ✓ |

*Sources: `benchmark.ts pair` runs (100/50 seeds). Master pairs slower — moderate confidence.*

### Standard human-proxy vs Fritz (from calibration audit)

| Fritz tier | Proxy win % |
|------------|-------------|
| Rookie | 74.5% |
| Standard | 50.0% |
| Elite | 32.0% |
| Master | 21.5% |

**Gap:** Standard proxy ≠ strong human. Your **60–80% vs Master** is expected and does **not** imply Master is broken.

---

## 4. Master identity audit

### What makes Master different from Elite (code)

| Mechanism | Elite | Master |
|-----------|-------|--------|
| Top-move noise | ~3% | **0%** |
| MC samples | 8 | **20** |
| Chain depth/width | 5/3 (base) | up to **8/6** |
| Two-ply worst-case | Off (flag false) | **Always on** |
| Endgame ≤12 tiles | MC + strategic only | **16× sampled minimax** (`master-endgame`) |
| Endgame threshold | 8 tiles (minimax in older paths) | **12 tiles** for IS-MCTS block |

### Verdict: **Master is slightly distinct but underpowered as “final boss” label**

- **Distinct enough in code?** Yes — material search/noise differences.
- **Distinct enough in feel?** **Partially** — high midgame overlap with Elite; differences show in complex/endgame lines.
- **Final boss for experts?** **No** — strong humans (you) winning 60–80% aligns with Master winning only ~63% vs Elite in bot ladder.
- **Fair?** Yes — only public information + sampling.
- **Too human?** **No** — Master does not inject mistakes; Rookie/Standard/Elite do.

**Classification:** **Master is basically Elite+** with cleaner math and deeper endgame — not a separate philosophy tier.

---

## 5. Daily Fritz relevance

| Question | Recommendation |
|----------|----------------|
| Right identity? | **Elite is coherent** for “competitive daily” — but **hard for average** (~22% BO3 set win, ~50% 0–2). |
| Same as PVF Elite? | **Yes** — same `hard` difficulty via `fritzConfig`. |
| Separate daily profile? | **Future option** — e.g. slightly softer MC or Standard tier for retention; not required for fairness. |
| First-time easier? | **UX/onboarding option** — not audited in code today. |
| Labeling | **P1 UX** — “competitive Elite challenge; same deals for everyone; strong players still lose often.” |

**Do not change tier in this audit.**

---

## 6. Tournament relevance

| Round | Bot tier | Server path |
|-------|----------|-------------|
| QF | standard | `serverBot.ts` lighter MC (4) |
| SF | elite | Full MC (8) |
| Final | master | MC 20 + sampled endgame ≤6 tiles |

- **Race-to-30** compresses games → more endgame-defense zone per point → **feels sharper** than PVF race-to-60.
- Tournament proxy (standard vs elite @ 30): **~43.5%** human-proxy win — **less punishing** than race-to-60 Elite (~32%).
- Server ≠ client byte-for-byte — document as **calibration gap**, not rigging.

---

## 7. Human-skill benchmark (proposed)

| Benchmark | Purpose |
|-----------|---------|
| Standard proxy vs Master | Baseline (~21% win) — **weak human floor** |
| **Hard proxy vs Master** | Stronger bot stand-in |
| Elite proxy vs Master | Should cluster ~37–40% elite wins |
| Master vs Master | ~50% control |
| **Your replays (future)** | Ground truth for “good player” band |

**Interpretation fix:** Standard proxy losing to Master **does not** cap strong human performance. Your 60–80% vs Master suggests **labels oversell difficulty more than code delivers** for experts.

---

## 8. Findings ranked

### P0 — fairness
*None.*

### P1 — calibration / product

1. **Elite vs Master overlap ~68%** on typical states — Master may not feel like its own tier except in complex spots.
2. **Master beats Elite ~63%** — slightly below “clear step up” reference; **not urgent to buff** given strong-human results.
3. **Daily Fritz Elite + BO3** — retention-hard for average players; **label honestly**.
4. **Server vs client tier tables** — tournament/PVF may feel inconsistent.

### P2 — engineering

1. Master sims slow for CI — use capped seeds or fixture-based overlap tests.
2. No Rookie on server tournament filler bots.

### UX

1. Master label “brutal expert” oversells for players like you.
2. Elite “competitive” is accurate; Daily Fritz should say **losses are normal**.

---

## 9. Recommendation

### Now
- **No strength tuning.**
- **Collect human-skill data** (hard proxy + optional replay ingest).
- **Labels only** if needed — Master as “sharpest search, honest rules” not “unbeatable.”

### Future tuning options (do not implement yet)

| Option | When |
|--------|------|
| Increase Master endgame depth/samples | If product wants Master > Elite ~70% bot-vs-bot **and** strong humans still >50% |
| Reduce Elite/Master overlap | Separate Master “sacrifice/defense” weights |
| Daily Fritz Standard track | Retention |
| Grandmaster tier above Master | If Master feels like Elite to experts |
| **Keep Master, reframe labels** | **Best match for your experience today** |

### Next production PR (suggested)

**`hardening: tier overlap CI + human-skill benchmark harness`**

- Add `tierFixtureCompare.ts` / overlap tests to CI (fast fixtures, not 500-state MC).
- Document tier ladder targets in `docs/fritz-tier-philosophy-audit.md`.
- Optional: `fairnessSim` mode `hard` human proxy vs Master for reporting.
- **No** `TIER_SELECT` / `defenseMultiplier` changes until product signs off.

---

## Audit artifacts (uncommitted, local)

| Script | Purpose |
|--------|---------|
| `client/src/bot/tierPhilosophyAudit.ts` | Full overlap + H2H (slow on Master) |
| `client/src/bot/tierOverlapQuick.ts` | Fast same-move sampling |
| `client/src/bot/tierFixtureCompare.ts` | Fixture move explanations |
| `client/src/bot/calibrationAudit.ts` | Prior calibration matrix |
| `client/src/bot/feelsRiggedAudit.ts` | Miracle-moment rates |

### Reproduce

```bash
npx ts-node --esm src/bot/tierOverlapQuick.ts 300
npx ts-node --esm src/bot/tierFixtureCompare.ts
npx ts-node --esm src/bot/benchmark.ts pair hard master 50
```

---

## Files reviewed

- `client/src/bot/botHeuristics.ts` — `TIER_SELECT`, `chooseBotMove`, `mcEvaluateMove`, master endgame
- `client/src/bot/fritzConfig.ts`
- `client/src/bot/tierDifficulty.behaviorTests.ts`
- `client/src/bot/benchmark.ts`
- `server/src/bot/serverBot.ts`
- `server/src/scheduledTournament/engine.ts`
- `docs/fritz-calibration-perception-audit.md`
