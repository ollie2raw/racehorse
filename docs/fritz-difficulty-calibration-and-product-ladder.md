# Fritz Difficulty — Calibration & Product Ladder

**Date:** 2026-06-01  
**Inputs:** `docs/fritz-difficulty-tiers-source-of-truth-audit.md`, `docs/fritz-difficulty-simulation-report.md`, `docs/fritz-tier-benchmark-200.json`  
**Mode:** Read-only product/calibration analysis — no gameplay, UI, Daily Fritz default, or skunk changes.

---

## Executive summary

**Mechanically:** Rookie → Standard → Elite → Master are **real, ordered tiers** with distinct evaluators and mistake rates.

**Calibrated to numbers:** The displayed **600 / 1000 / 1800 / 2400** are **Glicko opponent anchors** for ranked Play vs Fritz — **not** calibrated win-rate labels and **not** honest Elo for humans.

**Product gap:** The ladder is **too steep at the bottom** (Rookie loses ~87% to Elite) and **too flat at the top** (Elite wins ~38% vs Master in sim). **Standard** is the best “true casual” tier; **Elite Daily Fritz** is credible for competitive players but **hostile** to casual skill levels.

**Recommendation now:** **Two-track daily** (Casual = Standard, Classic = Elite) + **Play vs Fritz default Standard** for low-experience accounts + **reframe tier numbers as approximate strength**, not precise ratings. Do **not** lower Classic Daily Fritz to Standard or add four daily tracks.

---

## 1. Tier separation

### Simulation baseline (200 seeds, race-to-60, bot-vs-bot)

| Matchup | Weaker tier win% | Δ from 50/50 | Skunk% | Blowout (margin≥30) |
|---------|-----------------:|-------------:|-------:|--------------------:|
| Rookie vs **Standard** | 25.0% | **−25 pp** | 14.8% | 26.8% |
| Rookie vs **Elite** | 13.0% | **−37 pp** | 25.0% | 39.0% |
| **Standard** vs Elite | 29.5% | **−20.5 pp** | 11.5% | 22.8% |
| **Elite** vs Master | 38.3% | **−11.7 pp** | 11.5% | 23.5% |
| Rookie vs Master | 8.0% | **−42 pp** | 35.3% | 52.0% |

*pp = percentage points vs an even match.*

### Rookie vs Standard gap

- **Meaningfully separated:** Rookie wins **1 in 4** vs Standard (400 games). Code gap is large (simple immediate-score eval vs threat/mobility heuristic; ~34% vs ~14% suboptimal pick rate).
- **Human extrapolation:** A player who plays like Rookie will lose **~75%** to Standard Fritz — still punishing, but not hopeless.
- **Verdict:** Gap is **real and useful** as “learning” vs “fundamentals.” Not wide enough if the product promise is “beginners win sometimes.”

### Standard vs Elite gap

- **Largest product-relevant step:** Standard wins **29.5%** vs Elite; Elite proxy beats Standard **70.5%** in Daily Fritz–style single games.
- Code gap is **structural:** Standard skips strategic/MC stack; Elite runs full heuristic + MC + chain search.
- **Verdict:** **Well separated** — this is the main difficulty cliff players feel when moving from practice to Daily Fritz.

### Elite vs Master gap

- **Smallest gap:** Elite wins **38.3%** vs Master — Master only **~62%** favorite.
- Margins and skunk rates are **nearly identical** to Standard vs Elite (median margin 18, skunk ~11.5%).
- Master adds endgame IS-MCTS (≤12 tiles), 20 MC samples, always-on 2-ply — but in race-to-60 bot-vs-bot, **Elite already plays near ceiling**.
- **Verdict:** **Too close for marketing “2400 vs 1800.”** Master is an expert/challenge tier, not a distinct “league” above Elite for most players.

### Is Elite too close to Master?

**Yes, for product positioning.** Sim suggests:

- Strong players may not **feel** a clear step up from Elite → Master in a single race.
- Master’s value is **credibility** (tournaments, bragging rights, deterministic perfection) more than **domination**.

If the product needs a visible top tier, either **widen Master mechanically** (later tuning) or **sell Master as “perfect endgame”** rather than a 600-point rating jump.

### Is Rookie actually beginner-friendly?

**Mechanically yes; experientially no** (for typical “casual game” expectations).

| Criterion | Assessment |
|-----------|------------|
| Weaker AI / mistakes | Yes — separate eval, ~34% non-best moves |
| Win rate vs next tier | **25%** vs Standard — low morale for “beginner” |
| Win rate vs Elite (Daily proxy) | **13%** — effectively no chance |
| Skunk/blowout vs strong tiers | **25–52%** skunk/blowout vs Elite/Master |

**Beginner-friendly** if framed as: *“Fritz makes mistakes; learn rules and scoring here.”*  
**Not beginner-friendly** if framed as: *“Fair fight; you should win ~40% once you know the basics.”*

**Target for polished casual product:** Rookie should win **~35–45%** vs Standard before we call it “Beginner” in marketing (tuning pass, not done here).

### Is Standard the true casual / default tier?

**Yes.**

| Signal | Why Standard fits “default casual” |
|--------|-------------------------------------|
| vs Elite | **29.5%** win — losing more than winning, but competitive |
| Learn/recorder | Guided capture uses **Standard** |
| Tournament QF bots | **Standard** — inclusive bracket floor |
| vs Rookie | Standard is clearly stronger (+25 pp) without being absurd |

**Elite as default** (current PVF + Daily Fritz) optimizes for **strong players** and **competitive identity**, not **first-time / older casual** retention.

---

## 2. Rating number honesty

### What the numbers are today

| Tier | UI label | Code / ranked usage |
|------|----------|---------------------|
| Rookie | **600** | `FRITZ_ROOKIE_RATING` — Glicko opponent when resolving verified PVF vs Rookie id |
| Standard | **1000** | `FRITZ_STANDARD_RATING` |
| Elite | **1800** | `FRITZ_RATING` (default Fritz system id) |
| Master | **2400** | `FRITZ_MASTER_RATING` |

**Also in product:**

- Daily Fritz hub: **“Elite (1800)”** (`DailyFritzScreen.tsx`).
- Play vs Fritz cards: **elo: 600 / 1000 / 1800 / 2400** (`PlayVsFritz.tsx`).
- Player **human** Glicko defaults ~**800**; leaderboard tier bands use **1000 / 1300 / 1600** for Rookie/Standard/Elite/**Master** labels (`LeaderboardScreen.tsx`) — **not the same numbers as Fritz cards**.

### What they are *not*

- **Not** human win-rate calibrated (no data ties 1000 Standard ≈ 50% vs average human).
- **Not** chess.com-style Elo you can compare across platforms.
- **Not** consistent with the human rating scale (human default 800 vs Fritz “Standard 1000” implies Standard Fritz is stronger than a new human — plausible as **opponent** rating, but confusing on cards).

### Recommended classification

| Surface | Treat numbers as |
|---------|------------------|
| Ranked PVF backend | **Real Glicko opponent ratings** (keep as-is internally) |
| Fritz tier cards / Daily hub | **Approximate strength flavor** — not literal player Elo |
| Marketing / onboarding | **Descriptive tiers** preferred over numbers |

### Presentation recommendation

| Option | Recommendation |
|--------|----------------|
| Keep exact **600 / 1000 / 1800 / 2400** on main cards | **No** — overclaims precision |
| **“Approx. 600”** / tooltip | **Acceptable** interim |
| **Hide numbers** on main cards; show in stats/ranked detail | **Good** for premium polish |
| **Beginner / Casual / Competitive / Expert** (+ optional approx band) | **Best** for large-scale product clarity |

**Do not** remove Glicko opponent ratings from ranked math. **Do** decouple **display copy** from **rating engine constants**.

Suggested card copy pattern:

- **Rookie** — Beginner · *Fritz makes frequent mistakes*
- **Standard** — Casual · *Solid fundamentals*
- **Elite** — Competitive · *The Daily Fritz opponent*
- **Master** — Expert · *Near-perfect endgame*

Optional secondary line: `~1000 strength` only in ranked/advanced views.

---

## 3. Product difficulty ladder

### Player segments → recommended modes

| Segment | Skill / mindset | Primary path | Secondary |
|---------|-----------------|--------------|-----------|
| **First-time player** | Does not know Racehorse scoring, hubs, skunks | **Learn** (guided) → **PVF Rookie** | Short tooltips; no Daily Fritz day 1 |
| **Casual older player** | Knows dominoes loosely; wants relaxed session | **PVF Standard** (default) | Casual Daily Fritz when available; skip Master |
| **Average player** | Understands scoring; plays sometimes | **PVF Standard** → **Casual Daily Fritz** | Classic Daily when ready |
| **Strong family player** | Regular; wants challenge | **Classic Daily Fritz (Elite)** | PVF Elite; tournaments |
| **Competitive player** | Optimizes; cares about LB | **Classic Daily Fritz** | PVF Master; tournaments (SF/F Master bots) |

### Mode roles (canonical)

| Mode | Role in ladder |
|------|----------------|
| **Learn** | Rules + scoring literacy; **no rating pressure** |
| **PVF Rookie** | Mistake-rich sparring; **confidence building** (after tuning: target 40% vs Standard bot) |
| **PVF Standard** | **Default practice** — “real” Fritz without Elite brutality |
| **Daily Fritz (Classic / Elite)** | **One shared daily challenge** for engaged/competitive players |
| **Daily Fritz (Casual / Standard)** | **Retention daily** for average/casual — separate LB |
| **PVF Master** | Expert challenge; **not** daily default |
| **Tournaments** | Competitive ceiling; bot tier ramps Standard → Elite → Master |

### Anti-patterns today

- First session: Home → **Daily Fritz (Elite)** with **G1 skunk** risk → **0–2 set** → churn.
- PVF default **Elite** while cards say Rookie is “for beginners.”
- Coach/Learn references **hard** best moves while daily uses **Elite**.

---

## 4. Daily Fritz product structure

Scoring: **1 = weak, 5 = strong** (higher is better for that dimension).

| Option | Description | Simple | Retention | LB integrity | Casual friendly | Competitive cred | Impl complexity | Long-term quality |
|--------|-------------|-------:|----------:|-------------:|----------------:|-----------------:|----------------:|------------------:|
| **A** | One daily, **Elite only** (status quo) | **5** | 2 | **5** | 1 | **5** | **5** | 3 |
| **B** | One daily, **Standard only** | **5** | 4 | 3 | **4** | 2 | **5** | 2 |
| **C** | **Two tracks:** Casual (Standard) + Classic (Elite) | 4 | **5** | **4** | **5** | **5** | 3 | **5** |
| **D** | Four dailies (one per tier) | 1 | 3 | 2 | 3 | 3 | 1 | 2 |
| **E** | Adaptive daily by skill | 2 | 4 | 2 | 4 | 4 | 1 | 3 |

### Option notes

**A — Elite only**  
Keeps NYT-hard-wordle energy for core fans. Sacrifices casual retention; sim supports **87%** Elite win vs Rookie-level play + harsh skunk meta.

**B — Standard only**  
Helps casuals but **dilutes brand** for strong players; one LB mixes incompatible skill targets.

**C — Two tracks (recommended)**  
- **Classic Daily Fritz** — Elite, existing LB/streak/skunk prestige.  
- **Casual Daily Fritz** — Standard, **separate** `run_date` key or `track` column, **separate LB**, softer copy; **same skunk rules initially** (can relax later only on casual track).  
Balances **Wordle-hard** + **Wordle-easy** analog without four products.

**D — Four dailies**  
Ops/noise heavy; Rookie/Master dailies have weak sim justification (Master ≈ Elite).

**E — Adaptive**  
Requires skill model, anti-smurf, LB fairness — **phase 2** after metrics.

---

## 5. Recommended final product decision

### Firm recommendations (now)

| Question | Decision |
|----------|----------|
| **What should Daily Fritz be?** | **Two-track:** **Classic Daily Fritz = Elite** (primary brand daily) + **Casual Daily Fritz = Standard** (on-ramp daily). |
| **Casual Daily Fritz?** | **Yes** — separate leaderboard + hub entry; not a replacement for Classic. |
| **Play vs Fritz default?** | **Standard** for accounts with **&lt; N** completed PVF games (N ≈ 3–5) or no Daily Fritz completion; **Elite** remains one tap away. |
| **Tier rating numbers on cards?** | **Reframe:** descriptive tier first; demote **600/1000/1800/2400** to “Approx.” in advanced/ranked context or remove from primary cards. |
| **Post-loss / skunk nudges?** | **Yes** — after Daily **Classic** loss or skunk, nudge to **PVF Standard** or **Casual Daily** (copy only in v1; no skunk rule change yet). |

### What not to do yet

- Do **not** nerf Elite heuristics globally to help casuals.
- Do **not** merge Casual and Classic leaderboards.
- Do **not** lower Classic Daily to Standard-only (Option B).
- Do **not** implement adaptive daily (Option E) before baseline metrics.

---

## 6. Metrics needed before / after launch

### Tier & mode health

| Metric | Source / notes |
|--------|----------------|
| **PVF win rate by tier** | `statsApi` `tierRecords` + verified matches; segment by deal size |
| **User-chosen tier distribution** | PVF start events: `fritzTier` at match start |
| **Standard practice after DF loss** | Funnel: Classic DF complete (loss) → next PVF tier within 24h |

### Daily Fritz

| Metric | Purpose |
|--------|---------|
| **Completion rate** | `daily_fritz_attempts` started → completed, by track |
| **Skunk rate** | `set_result.games[].skunk`, by track and game number (G1 vs G2) |
| **Games per set** | Detect instant 0–2 skunk endings |
| **Return rate D+1 / D+7** | By first outcome (win / loss / skunk loss) and track |

### Retention & routing

| Metric | Purpose |
|--------|---------|
| **First-time player return** | D1 after first Learn vs first PVF vs first Daily |
| **Loss streak length** | Consecutive Classic DF losses before abandon |
| **Mode switch after loss** | Classic DF loss → Casual daily / PVF Rookie / churn |
| **Time-to-first Classic DF** | Ensure casuals aren’t pushed too early |

### Calibration (post-tuning)

| Metric | Target (hypothesis) |
|--------|---------------------|
| Human vs Rookie win% | **35–45%** (once tuning done) |
| Human vs Standard win% | **40–50%** for median account |
| Human vs Elite (Classic DF) | **25–40%** for engaged players |

---

## 7. Tuning plan (order only — no implementation)

If sims + human metrics show tiers misaligned:

### Phase 1 — Rookie / Standard morale (highest ROI for casual)

1. **Mistake frequency** — `TIER_SELECT.casual`: raise `pRandom` / lower `pBest` until Rookie vs Standard sim → **~40%** Rookie wins.  
2. **Candidate pool size** — widen pool before rank-decay sample (more diverse mistakes).  
3. **Scoring aggression** — Rookie: reduce weight on immediate-only if it still chains too well.

### Phase 2 — Standard vs Elite cliff

4. **Blocking / threat awareness** — Standard tier: optionally add light threat term (already partial); avoid full MC.  
5. **Randomness** — Standard `pBest` 0.86 → ~0.80 if Standard still stomps casual humans.

### Phase 3 — Elite vs Master differentiation (only if product needs clearer top)

6. **Endgame strength** — Master-only: lower endgame threshold or raise sample count (Elite stays unchanged).  
7. **Elite** — do **not** weaken; differentiate Master upward.

### Phase 4 — Casual track only (product, not global AI)

8. **Skunk behavior** — Casual daily only: consider G1 instant-set skunk **softening** (product rule), not AI change.  
9. Re-measure skunk rate and D+1 retention on Casual track.

**Do not tune** thinking delay, deal generation, or Elite global eval until Phases 1–2 metrics are collected.

---

## 8. Next implementation prompt

Copy-paste for the **smallest first product change** (no AI tuning):

---

> **Fritz product v1 — Casual daily track + PVF default (no AI/skunk changes)**  
>  
> Based on `docs/fritz-difficulty-calibration-and-product-ladder.md`:  
>  
> 1. **Play vs Fritz:** Default selected tier to **Standard** when the user has **&lt; 5** completed PVF games (use existing stats or local counter); Elite remains selectable; no change to `chooseBotMove`.  
> 2. **Daily Fritz two-track spec + minimal backend:** Add `track: 'classic' | 'casual'` to daily run model (`classic` = `fritz_tier: elite`, `casual` = `fritz_tier: standard`). Separate leaderboard queries by track. Hub shows two cards: **Classic Daily Fritz** (existing Elite branding) and **Casual Daily Fritz** (Standard, separate LB). Same deals structure per track per date (deterministic seed includes track). **Do not** change skunk rules yet.  
> 3. **Copy-only tier presentation on PVF cards:** Primary label = Beginner / Casual / Competitive / Expert; move **600/1000/1800/2400** to secondary “Approx. strength” line or ranked tooltip — no Glicko math changes.  
> 4. **Post-loss nudge (Classic DF only):** On set loss overlay, one line + button: “Try Casual Daily Fritz” / “Practice vs Standard Fritz” — routes only, no new AI.  
>  
> Out of scope: `botHeuristics` tuning, skunk changes, adaptive daily, four tracks.  
> Add analytics events listed in calibration doc §6 (tier at PVF start, DF track, completion, skunk).

---

## Definition of done

You can decide with confidence:

| Decision | Answer |
|----------|--------|
| Keep one Daily Fritz? | **No** — add **Casual** track; keep **Classic Elite** as flagship. |
| Add Casual Daily Fritz? | **Yes.** |
| Change PVF default? | **Yes → Standard** for low-experience users. |
| Adjust rating presentation? | **Yes → descriptive tiers**; numbers approximate/hidden on primary UI. |
| Tiers separated correctly? | **Bottom/middle yes; top too flat; Rookie not casual enough.** |
| Next step | **Product v1 prompt above**, then metrics, then Rookie mistake tuning if needed. |

---

*Read-only calibration doc — 2026-06-01.*
