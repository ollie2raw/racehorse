# Fritz node budget (roadmap 4.1 / decision 2.5)

## What it is

Fritz's exhaustive searches (the master endgame search, the exact turn-chain solver, and the minimax under them) were bounded by wall-clock deadlines: 90 ms and 45 ms. How deep Fritz looked therefore depended on the device and on whatever else the machine was doing, so the same position could get a different move, bot strength varied by phone, and every study over the recorded corpus jittered between runs (the "contested flag nondeterministic" known defect in AGENTS.md section 11).

`client/src/modules/fritz/searchBudget.ts` replaces the raw deadline with a budget object. In **time** mode (the default, and what ships today) it behaves exactly as before. In **node** mode it counts checks instead, `ms * NODES_PER_MS` of them (85 per ms, so 7,650 for the endgame search and 3,825 for the chain solver), and the same position always gets the same search.

Nothing changes for players until the mode is switched: `setSearchBudgetMode('nodes')` in code, or `VITE_FRITZ_NODE_BUDGET=1` at build time.

## Calibration (2026-11-02, development laptop)

`npx tsx scripts/fritzNodeBudgetCalibration.ts 8 40`:

| Measure | Result |
|---|---|
| Searches that ran out of time under the clock | 26.3% of 977 |
| Checks per ms when they did | p10 47.8, median 85.2, p90 113.5 |
| Searches that finished inside the budget | p50 1,970 checks, p99 9,291, max 10,981 |
| Two clock-mode runs of the same 8 seeds | agree on 785 of 994 opening moves (the noise floor) |
| Node mode against itself | identical move for move (unit test) |
| Master vs hard, 80 games per mode (colours swapped) | clock 63.7% won, mean margin 7.4; nodes 70.0% won, mean margin 7.3 |

`NODES_PER_MS = 85` is the median, so on this laptop a node budget is about as generous as the clock was. A slower phone under the clock searched less and therefore played weaker than this; in node mode every device plays the laptop's strength, only slower. On 80 games the win-rate gap (63.7% against 70.0%) is inside the noise, and the margins are the same, so there is no measured strength change on this machine.

## Decision for the owner

Switching on node mode changes what Fritz does on slow devices (stronger, because it no longer cuts the search short) and makes it reproducible everywhere. The cost is that a slow phone takes longer for the same move: the worst measured search is about 11,000 checks, which is roughly 130 ms at the laptop's speed and several times that on an old phone. Before switching it on for production:

1. Time `chooseBotMove('master')` in the endgame on the slowest phone you care about (the `Fritz` dev log prints it).
2. If that is too slow, lower `NODES_PER_MS` (the budgets shrink with it) and rerun the calibration for strength.

Daily Fritz is unaffected either way: its policy (v3) is already a pure function of the state.

## What this does not do

It does not split `botHeuristics.ts` into eval, search and tiers (the second half of roadmap 4.1), and it does not touch the Monte Carlo and strategic evaluation, which were already seeded per position.
