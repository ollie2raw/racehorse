# Self-play corpus for win-probability calibration and learned-leaf training (2026-11-08)

**What this is.** A seeded, resumable generator that plays full Racehorse games to 60 between mixed Fritz and noisy policies and logs, for every decision of every seat, the *public* features at decision time plus the outcomes joined after the hand and the game. It exists to (1) calibrate a win-probability loss and the advantage graph (`docs/review-single-depth-design-2026-11-08.md`, item 4: the blocker was that 10 recorded games are too few) and (2) feed a learned leaf value later. **Nothing is trained here.** Bot play only. Laptop only; no production code is touched.

All counts below are *measured* on the laptop unless marked *guess*.

## Where things live

| What | Where |
|---|---|
| Generator and features | `client/src/devtools/selfplayCorpus.ts` |
| CLI (generate, resume, summarize) | `client/scripts/generateSelfplayCorpus.ts` |
| Tests | `client/src/devtools/selfplayCorpus.test.ts` (10 tests) |
| Tiny sample (25 decisions of one game, plain JSONL) | `docs/selfplay-corpus-sample.jsonl` |
| **The data (not in git)** | `/Users/olivermorid/racehorse-selfplay-data/` : `manifest.json` plus `selfplay-s1-k<shard>.jsonl.gz` |

Regenerate or extend:

```sh
cd client
nice -n 15 npx tsx scripts/generateSelfplayCorpus.ts --out /Users/olivermorid/racehorse-selfplay-data --seed 1 --games-per-shard 25 --max-minutes 75
npx tsx scripts/generateSelfplayCorpus.ts --out /Users/olivermorid/racehorse-selfplay-data --summarize --report /tmp/summary.md
```

A shard is a pure function of `(seed, shard index, policy mix)` and is written atomically; a rerun skips shards already in `manifest.json` (resumable). The manifest records the seed, mix, games per shard, the search-budget mode (`nodes`), the Node version and each shard's size and SHA-256.

## Determinism (measured by test)

- Fritz's search is wall-clock bounded by default, which makes strength and moves device-dependent. The generator switches it to the **node budget** (`setSearchBudgetMode('nodes')`, `searchBudget.ts` from #486) and replaces `Math.random` with a per-game seeded stream for the length of a game. Every policy tier (casual, standard, hard, master) therefore replays identically.
- Tested: a shard rerun with the same seed is **byte-identical** (gzip header carries no timestamp); a different seed is not; a master-vs-hard game reruns to the identical JSONL.
- Note the node budget is calibrated at 85 checks per ms on this laptop, so Fritz master here plays like the shipped time-bounded Fritz does on this machine, not like one on a slower phone.

## Policies

| Policy id | What it does |
|---|---|
| `fritz-master`, `fritz-hard`, `fritz-standard`, `fritz-casual` | `chooseBotMove` at that tier (node-budgeted) |
| `eps0.1-master` | master, but with probability 0.1 a uniformly random legal play instead |
| `eps0.3-standard` | standard, but with probability 0.3 a uniformly random legal play instead |
| `uniform-random` | a uniformly random legal play every time |

Mix, in percent of **seat-games** (each seat of each game draws its own policy, so both seats vary and mismatched pairings are common): master 30, hard 20, standard 15, casual 10, eps0.1-master 10, eps0.3-standard 10, uniform-random 5. Decision shares differ from this (see results) because weaker policies play longer and score differently, and because forced decisions are not policy-dependent.

Every record says which policy produced the move and `moveSource`: `forced` (exactly one legal play; no policy ran), `greedy` (the policy's own choice) or `explore` (an epsilon or uniform move).

## What is a decision

A decision is a turn where the seat has **at least one legal play**. Draws and passes are not decisions (nothing is chosen) but are recorded as context: `drewBefore` (tiles drawn since the seat's previous decision) and the absence evidence below. A double or scoring play continues the turn, so a seat can make several consecutive decisions; `chainIndex` is how deep in such a chain the decision is (0 for a fresh turn).

## Schema (version 1)

One JSON object per line. Tile index order everywhere: `index(low, high) = high * (high + 1) / 2 + low` with `low <= high`, so (0-0)=0, (0-1)=1, (1-1)=2, (0-2)=3, ... (6-6)=27. Masks are integers with bit *i* set when tile *i* is in the set.

| Field | Meaning |
|---|---|
| `decisionId`, `gameId`, `hand`, `seq` | ids; `seq` is the 0-based decision ordinal within the game (both seats) |
| `seat` | 0 = the engine's `you` seat (opens odd hands), 1 = `bot` |
| `policy`, `moveSource` | see above |
| `move` | `{ tile: index, position: 'left' \| 'right' \| 'branch-h-a' }` |
| `drewBefore`, `chainIndex` | context, see above |
| `features.ownHandMask` | the acting seat's hand, 28-bit |
| `features.playedMask` | tiles on the board (public), 28-bit. The unseen pool is everything else (opponent hand plus boneyard), so it is derivable |
| `features.openEndPips`, `numEnds` | the playable pip at each open end (sorted), and how many ends |
| `features.openSum`, `openSumMod5` | the canonical scoring sum of the open ends (doubles scored as scored) and that sum mod the scoring multiple (5) |
| `features.hubDoubles`, `mainLineLength` | board structure: branch hubs and main-line length |
| `features.ownScore`, `oppScore` | scores at decision time |
| `features.oppTileCount`, `boneyardCount` | sizes only; the contents are hidden |
| `features.legalActionCount` | number of legal plays |
| `features.handStarterIsSelf` | 1 when the acting seat opened this hand |
| `features.oppAbsentPassMask` | 7-bit mask of pips the opponent **passed** on this hand. **Permanent**: a player passes only when nothing can be drawn, so its hand is final |
| `features.oppAbsentDrawMask` | 7-bit mask of pips the opponent lacked when it last **drew** this hand. **Provisional**: the draw may have refilled it, so treat as a hint |
| `features.oppDrawCount`, `ownDrawCount` | tiles each seat has drawn this hand |
| `outcome.ptsSelfToHandEnd`, `ptsOppToHandEnd` | points each seat scored from this decision to the end of the hand, including the end-of-hand award |
| `outcome.handEndDiffDelta` | end-of-hand score differential (self minus opponent) minus the differential at decision time (= `ptsSelf - ptsOpp`) |
| `outcome.wonHand` | 1 the acting seat won the hand, 0 it lost, -1 no winner |
| `outcome.handEndReason` | `domino` or `blocked` |
| `outcome.wonGame`, `finalMargin`, `gameHands` | the game result from the acting seat's view (margin = self minus opponent) and the number of hands played |

**Public information only.** No feature reads the opponent's hand or the boneyard contents; a test swaps the opponent's hand with boneyard tiles (same counts, different hidden contents) and requires every feature to be unchanged. A second test checks the absence evidence against the *real* hands: a player that could not play held no tile with an open-end pip when it started to draw, and a pass leaves a final hand with none.

**Every feature is an integer** (masks, pips, counts, scores), so a model trained on this data can run identically on a device and on a server without floating-point differences between engines.

## Results (measured)

Run: one niced shard (`nice -n 15`), seed 1, 25 games per shard, 93 shards, on a shared laptop.

| | |
|---|---|
| **Corpus size** | **2,325 games, 280,780 decisions, 10.45 MB gzipped** (about 11 MB on disk, 93 shards) |
| **Throughput** | **about 1,920 games per hour** over the 92 normal shards (71.7 minutes); median shard 46 s for 25 games = 1,977 games per hour |
| Decisions per game | 120.8 (both seats) |
| Forced decisions (one legal play, no policy ran) | 70,637 (**25.2%**) |
| Exploratory moves (epsilon or uniform) | 18,928 (6.7% of decisions) |
| Final game margin \|self - opponent\| | p25 12, median 22, p75 34, p90 44 |

One shard (shard 92) shows 43.9 minutes against about 46 seconds for the rest: the laptop went to sleep during the run. It is excluded from the throughput figure above (the recorded wall time of that shard is in `manifest.json`); its games are complete and in the corpus. Generation speed depends on the mix (master and hard are the slow tiers) and on what else the machine is doing, so treat 1,900 games per hour as this laptop's figure for this mix. The run had a 75-minute cap on wall-clock time; the sleeping shard pushed the clock past it, so the run ended after shard 92 with about 72 minutes of actual generation. It is resumable: rerunning the same command (same seed and mix) continues from shard 93.

### Share of decisions per policy

Seat-games were drawn at 30 / 20 / 15 / 10 / 10 / 10 / 5 (master, hard, standard, casual, eps0.1-master, eps0.3-standard, uniform); the realized shares are within a point of that.

| policy | decisions | share of decisions | share of seat-games | greedy | explore | forced |
|---|---:|---:|---:|---:|---:|---:|
| fritz-master | 85,260 | 30.4% | 30.3% | 64,812 | 0 | 20,448 |
| fritz-hard | 55,549 | 19.8% | 20.0% | 41,123 | 0 | 14,426 |
| fritz-standard | 42,680 | 15.2% | 14.8% | 31,399 | 0 | 11,281 |
| eps0.3-standard | 28,531 | 10.2% | 10.0% | 14,785 | 6,307 | 7,439 |
| fritz-casual | 27,611 | 9.8% | 10.0% | 20,537 | 0 | 7,074 |
| eps0.1-master | 27,243 | 9.7% | 9.6% | 18,559 | 2,092 | 6,592 |
| uniform-random | 13,906 | 5.0% | 5.4% | 0 | 10,529 | 3,377 |

### Coverage of the position space

| leader's score at decision time | decisions | share |
|---|---:|---:|
| < 10 | 45,547 | 16.2% |
| 10 to 19 | 41,958 | 14.9% |
| 20 to 29 | 43,599 | 15.5% |
| 30 to 39 | 44,240 | 15.8% |
| 40 to 49 | 44,554 | 15.9% |
| 50 and over | 60,882 | 21.7% |

| score margin at decision time | decisions | share |
|---|---:|---:|
| under 5 | 88,698 | 31.6% |
| 5 to 9 | 61,755 | 22.0% |
| 10 to 19 | 75,911 | 27.0% |
| 20 to 29 | 36,530 | 13.0% |
| 30 and over | 17,886 | 6.4% |

| hand | decisions | share |
|---|---:|---:|
| hand 1 | 39,084 | 13.9% |
| hand 2 | 38,679 | 13.8% |
| hands 3-4 | 77,584 | 27.6% |
| hands 5-6 | 70,580 | 25.1% |
| hands 7 and later | 54,853 | 19.5% |

| points self minus opponent, decision to hand end | decisions | share |
|---|---:|---:|
| below -5 | 50,559 | 18.0% |
| -5 to -1 | 63,316 | 22.6% |
| 0 | 15,092 | 5.4% |
| 1 to 5 | 82,210 | 29.3% |
| 6 to 10 | 45,719 | 16.3% |
| 11 and over | 23,884 | 8.5% |

Early and late positions are both well covered; close positions (margin under 10) are 54% of decisions and lopsided ones (margin 20 or more) 19%. Turn structure: 53.1% of decisions open a fresh turn, 29.0% are the second decision of a turn (after a double or scoring play), 11.2% the third, 6.7% deeper. Public absence evidence is sparse by nature: the opponent has passed on some pip in 0.9% of decisions, and has drawn this hand in 18.0% (the draw mask is non-zero in 17.3%).

### Is the signal usable for win probability? (sanity check, measured)

Share of decisions whose acting seat went on to win the game, by score margin at decision time:

| margin (self - opponent) | decisions | acting seat wins the game |
|---|---:|---:|
| below -30 | 6,795 | 0.4% |
| -30 to -21 | 15,243 | 3.9% |
| -20 to -11 | 33,011 | 15.6% |
| -10 to -6 | 27,615 | 29.7% |
| -5 to -1 | 42,125 | 44.2% |
| 0 to 4 | 53,110 | 57.3% |
| 5 to 9 | 32,339 | 72.1% |
| 10 to 19 | 40,466 | 85.4% |
| 20 to 29 | 19,895 | 96.4% |
| 30 and over | 10,181 | 99.5% |

It is monotone and smooth, so a win-probability curve can be fitted from margin and hands remaining. Two caveats: the margin buckets mix policy strengths (a strong seat is more likely both to be ahead and to win), so a calibrated model should either condition on the policy or be trained on strength-matched pairs; and decisions within a game are correlated, so any fit or evaluation must split by **game**, never by decision.

## Coverage caveat (read before training)

- **Bot play only.** Every game is between software policies. Nothing here is a human game.
- **What the variety does cover:** weaker and noisier play (casual and standard tiers, 10% and 30% random-move noise, and a fully random policy), mismatched pairings (each seat draws its own policy, so strong-vs-weak, weak-vs-weak and noisy-vs-strong are all common), and positions off the strong-play path: 6.7% of all decisions are exploratory moves, which land the game in states pure Fritz would not reach.
- **What it does not cover:** real human tendencies (favoured tiles, sentimental or inattentive plays, bluffing about the hand, tilt), human pace, humans' errors that are *systematic* rather than random (epsilon noise is uniform over legal plays, human mistakes are not), and any play that depends on a person's belief about a particular opponent. A leaf value or win-probability curve trained on this corpus will be well calibrated on bot-like positions and its calibration on human games is **unverified**; a small human validation set (20 to 50 games) is still the gate before anyone calls it validated.
- **Fritz here uses the node budget, calibrated on this laptop.** Master and hard play at this machine's strength, not at the speed-limited strength of a phone.
- **Hand 1 and parity:** the generator follows the existing self-play harness (7 tiles each, odd hands opened by seat 0). It does not model the pre-game draw or the tournament 30-point race, only the standard race to 60.
- **Absence evidence is conservative.** The provisional draw mask can be stale after a draw; the pass mask is exact but rare. A learned model should treat them as hints and use the draw counts alongside.
- **No training or fitting was done.** The tables above are descriptive statistics of the corpus.
