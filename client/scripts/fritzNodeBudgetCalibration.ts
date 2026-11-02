/**
 * Calibrates the Fritz node budget against the wall-clock budget it replaces.
 *
 *   npx tsx scripts/fritzNodeBudgetCalibration.ts [matches=8] [strengthMatches=40]
 *
 * Part 1 plays master-vs-master in time mode and reports how many checks the time budgets allowed per millisecond
 * (that is NODES_PER_MS) and how many searches ran out of time.
 * Part 2 is the noise floor: the same seeds again in time mode, to see how far a run disagrees with itself.
 * Part 3 is strength, the question the owner has to decide on: master against hard on the same seeds with each budget,
 * with the colours swapped so the deal does not decide it.
 */
import { playSeededMatch, type SelfPlayResult } from '../src/modules/fritz/fritzSelfPlay.ts';
import {
  finishSearchBudgetStats,
  NODES_PER_MS,
  setSearchBudgetMode,
  startSearchBudgetStats,
  type SearchBudgetMode,
} from '../src/modules/fritz/searchBudget.ts';

const matches = Number(process.argv[2] ?? 8);
const strengthMatches = Number(process.argv[3] ?? 40);
const seeds = Array.from({ length: matches }, (_, i) => 1000 + i);

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
};

const sharedPrefix = (a: string[], b: string[]): number => {
  const common = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < common && a[prefix] === b[prefix]) prefix += 1;
  return prefix;
};

console.log('--- 1. what the time budgets allow');
setSearchBudgetMode('time');
startSearchBudgetStats();
const firstRuns: SelfPlayResult[] = seeds.map((seed) => playSeededMatch(seed, 'master', 'master'));
const records = finishSearchBudgetStats();

const ranOut = records.filter((record) => record.elapsedMs >= record.ms);
const rates = ranOut.map((record) => record.budget.used / record.elapsedMs);
console.log(`${records.length} budgets created, ${ranOut.length} ran out of time (${((ranOut.length / records.length) * 100).toFixed(1)}%)`);
if (rates.length > 0) {
  console.log(
    `checks per ms when the budget ran out: p10 ${percentile(rates, 0.1).toFixed(1)}, median ${percentile(rates, 0.5).toFixed(1)}, p90 ${percentile(rates, 0.9).toFixed(1)} (NODES_PER_MS is ${NODES_PER_MS})`,
  );
}
const finished = records.filter((record) => record.elapsedMs < record.ms).map((record) => record.budget.used);
if (finished.length > 0) {
  console.log(`searches that finished inside the budget used p50 ${percentile(finished, 0.5)}, p99 ${percentile(finished, 0.99)}, max ${Math.max(...finished)} checks`);
}

console.log('--- 2. noise floor: time mode against itself, same seeds');
let agreed = 0;
let compared = 0;
seeds.forEach((seed, i) => {
  const again = playSeededMatch(seed, 'master', 'master');
  agreed += sharedPrefix(firstRuns[i].moves, again.moves);
  compared += Math.min(firstRuns[i].moves.length, again.moves.length);
});
console.log(`identical opening prefix between two time-mode runs: ${agreed}/${compared} moves`);

console.log('--- 3. strength: master vs hard, each budget');
const strengthSeeds = Array.from({ length: strengthMatches }, (_, i) => 5000 + i);
function masterVsHard(mode: SearchBudgetMode): { wins: number; games: number; margin: number } {
  setSearchBudgetMode(mode);
  let wins = 0;
  let margin = 0;
  for (const seed of strengthSeeds) {
    const asFirst = playSeededMatch(seed, 'master', 'hard');
    const asSecond = playSeededMatch(seed, 'hard', 'master');
    if (asFirst.bot > asFirst.you) wins += 1;
    if (asSecond.you > asSecond.bot) wins += 1;
    margin += asFirst.bot - asFirst.you + (asSecond.you - asSecond.bot);
  }
  return { wins, games: strengthSeeds.length * 2, margin: margin / (strengthSeeds.length * 2) };
}
for (const mode of ['time', 'nodes'] as const) {
  const result = masterVsHard(mode);
  console.log(
    `${mode}: master won ${result.wins}/${result.games} (${((result.wins / result.games) * 100).toFixed(1)}%), mean margin ${result.margin.toFixed(1)}`,
  );
}
