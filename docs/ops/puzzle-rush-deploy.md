# Ops: Puzzle Rush deploy order

Puzzle Rush has a hard three-step order. Skipping a step doesn't fail loudly —
it fails as a 409 at `/api/puzzle-rush/start` for every player.

## Deploy order

1. **Apply the migration first.** `supabase/migrations/2026-08-20_puzzle_rush.sql`
   creates `puzzle_pool`, `rush_runs`, `rush_run_puzzles`. It is additive and
   touches no existing table, so it is safe to run ahead of the application
   code. Deploying the server first means every rush endpoint 500s on a missing
   relation.
2. **Deploy the server.** Nothing in Puzzle Rush is wired into the daily ladder
   or multiplayer paths, so this is not a coordinated release with anything else.
3. **Seed the pool.** Until this runs, `puzzle_pool` is empty and `/start`
   returns 409. From a shell with the server's `SUPABASE_URL` /
   `SUPABASE_SERVICE_KEY`:

   ```
   cd server
   npx tsx src/seedPuzzlePool.ts --dry-run   # sanity check, writes nothing
   npx tsx src/seedPuzzlePool.ts             # actually seeds
   ```

   The seed is idempotent — `(source, source_puzzle_id)` is unique — so re-run it
   whenever the daily ladder has produced new content. It is a read of
   `daily_puzzles` plus an insert into `puzzle_pool`; it never modifies the daily
   ladder's own rows.

## What a healthy `--dry-run` looks like

Measured against production on 2026-08-20:

```
[puzzle-pool-seed] {
  dryRun: true,
  scanned: 2284,
  seeded: 2284,
  byTier: { quick_line: 106, tactical_setup: 104, master_chain: 2074 },
  difficultyRange: { min: 17, max: 828 },
  skipped: 0,
  skipReasons: {}
}
```

What to check:

- **`scanned` should match `select count(*) from daily_puzzles`.** If it is
  exactly `1000`, the pagination in `listDailyPuzzleSourceRows` has regressed —
  PostgREST caps a single response at 1000 rows regardless of `limit`, and the
  script pages around that. A silent `1000` means most of the bank was skipped.
- **`seeded` should be close to `scanned`.** Skips are reported by reason;
  `missing_board_or_hand` and `no_best_possible_score` are the only two. A large
  skip count means the daily rows are missing content, not that rush is broken.
- **`byTier` is heavily skewed and that is expected** — roughly 91%
  `master_chain`, ~5% each for the other two. This is real content imbalance
  (the pre-ladder single daily puzzle and the Aug 2026 five-slot era were both
  big-hand puzzles), not a mislabelling artifact: `tier is null` is 0 rows, and
  master_chain rows have a median hand of 10 tiles.
- **`difficultyRange` should span roughly 17-830.** The tiers cluster tightly:
  quick_line 17-80, tactical_setup 371-440, master_chain 743-828. The ramp bands
  in `PUZZLE_RUSH_CONFIG.run.stages` are set from exactly these windows.

## 409 "Puzzle Rush pool is empty"

Operationally this means `puzzle_pool` returned no `enabled` rows. In order of
likelihood:

1. **The seed was never run** after the migration — run step 3 above.
2. **The seed ran against the wrong project** (staging creds in a prod shell, or
   vice versa). Check `select count(*) from puzzle_pool;` against the same
   database the server is pointed at.
3. **Every row was disabled.** `enabled` is only ever set false by hand; if rows
   exist but the count of `enabled = true` is zero, someone disabled the bank.

It is never a symptom of load, of the daily ladder, or of a bad run — the
selection query reads only `puzzle_pool`, deliberately so that rush never
contends with the ladder's readiness path.

## "run selection degraded" warnings

`/start` logs `[puzzle-rush] run selection degraded` when a run could not be
filled from its own tier/band. This is **pool health telemetry, not an error** —
the run still went out, with puzzles borrowed from the nearest adjacent band,
and never with a repeated puzzle inside one run.

- `fallbacks: { "quick_line:tier_exhausted": N }` → that tier is short of
  content for its stage's ordinal span (each fallback also carries the
  `stageKey` it belongs to). Seed more (re-run step 3), or generate more of
  that tier via `seedDailyPuzzleLadder`.
- `fallbacks: { "...:band_exhausted": N }` → the tier has content but not inside
  the configured band. Usually means `PUZZLE_RUSH_CONFIG.run.stages` has drifted
  from the real difficulty distribution; re-measure with `--dry-run` and re-tune
  the bands. A test (`each stage band contains its own tier`) pins the current
  windows, so this should fail in CI before it reaches production.
- `shortfall: true` → the pool holds fewer distinct puzzles than one run's
  length, so the run was served short. Only possible on a nearly-empty pool.

A steady trickle of these is a content signal. A sudden onset right after a
deploy points at a config change, not at the pool.

## Backlog: the two thin tiers cap the mode at three stages

**Not scheduled — a note so this is findable when someone asks why Puzzle Rush
only has three stages.**

The pool is lopsided:

| tier | rows | difficulty window |
|---|---|---|
| `quick_line` | 106 | 17-80 |
| `tactical_setup` | 104 | 371-440 |
| `master_chain` | 2074 | 743-828 |

Two consequences, both currently accepted rather than worked around:

1. **The run has three felt stages, not more.** `PUZZLE_RUSH_CONFIG.run.stages`
   is three entries because difficulty only changes when the *tier* changes —
   `deriveDifficultyScore` barely spreads within a tier at real best scores
   (quick_line clusters at ~41, tactical at ~391, master at ~765). Splitting a
   stage in two today would produce two stages of identical difficulty.
2. **The thin tiers set the ceiling on stage length.** `warm_up` needs 6
   distinct `quick_line` puzzles and `building` needs 12 `tactical_setup`; 106
   and 104 rows cover that comfortably, but they are the constraint if stages
   ever get longer or a stage is split.

To unlock more stages later, generate more `quick_line` and `tactical_setup`
content. The machinery already exists — `seedDailyPuzzleLadder.ts` has a
`manual` budget (`maxAttemptsPerSlot: 2100`, `maxMsPerSlot: 180000`) built for
exactly this kind of offline bulk work, and generation at those bands is cheap
(the `quick_line` profile generates in ~1ms; `tactical_setup` is the expensive
one at ~850ms p50). Seed the new rows into `daily_puzzles`, re-run
`seedPuzzlePool.ts`, then re-measure with `--dry-run` before touching the stage
config.

A finer `deriveDifficultyScore` — driven by observed solve rates from
`puzzle_pool.play_count` and `rush_run_puzzles`, rather than by
`best_possible_score` — would be the other half of that work, and is what would
let a single tier support more than one stage.

## The ladder generator must keep running

**`seedDailyPuzzleLadder.ts` is not retired, even though the ladder UI is.**

Daily Puzzle now launches straight into Puzzle Rush and the ladder screens are
unreachable from the app. The generator behind them is still the only source of
new puzzle content:

```
seedDailyPuzzleLadder.ts  ->  daily_puzzles  ->  seedPuzzlePool.ts  ->  puzzle_pool  ->  Rush runs
```

Turn that script (or its scheduled warmup) off and nothing breaks loudly — Rush
keeps serving the ~2,300 puzzles already in the pool. It degrades quietly
instead: no new content, staler rotation, and the `play_count`-based variety
spread flattens as every puzzle gets played. If the ladder is ever truly deleted,
the generator has to be re-pointed at `puzzle_pool` first.

## Daily official run vs all-time personal best

Two different boards read the same table:

- **Daily** (`listOfficialRushRunsForDate` + `buildDailyPuzzleRushLeaderboard`)
  filters `is_official = true`. A user's **first run of a Pacific calendar day**
  is the official one; the partial unique index
  `rush_runs_one_official_per_user_day_idx` guarantees at most one per user per
  day.
- **All-time personal best** (`listCompletedRushRuns` +
  `buildPuzzleRushLeaderboard`) reads **every** completed run, official or not.
  A for-fun third run of the day can still set a personal best.

**The streak reads neither.** It counts any *completed* run that day
(`listCompletedPuzzleRushDatesForUser`), so abandoning the official run and
finishing a later one the same day keeps a streak alive.

## Rollback

The migration's own rollback block is commented at the bottom of the SQL file.
Dropping the tables destroys all rush history; the pool itself is re-seedable
from `daily_puzzles` at any time, so it carries no unique state.
