/**
 * Aggregates `reviewDepthMatch.ts` shard files into one report: how often the deeper player won, over all games and over deals (each deal is played twice with
 * the seats swapped, so a deal is "won" by a depth only if it won both seatings).
 *   npx tsx src/devtools/reviewDepthMatchSummary.ts <out.md> <shard.jsonl>...
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [outPath, ...files] = process.argv.slice(2);
type Game = { dealSeed: string; seating: string; winnerDepth: number; scoreDepthA: number; scoreDepthB: number; depthA: number; depthB: number; seconds: number; labelA?: string; labelB?: string };
const games: Game[] = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Game));
if (games.length === 0) throw new Error('no games');
const A = games[0]!.depthA;
const B = games[0]!.depthB;
const nameA = games[0]!.labelA ?? `${A}-ply`;
const nameB = games[0]!.labelB ?? `${B}-ply`;

const wilson = (k: number, n: number) => {
  const z = 1.96; const p = k / n; const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return `[${((c - h) * 100).toFixed(1)}%, ${((c + h) * 100).toFixed(1)}%]`;
};
// Exact two-sided sign test against 50%.
const logChoose = (n: number, k: number) => { let s = 0; for (let i = 1; i <= k; i += 1) s += Math.log((n - k + i) / i); return s; };
const signTestP = (k: number, n: number) => {
  const lo = Math.min(k, n - k);
  let p = 0;
  for (let i = 0; i <= lo; i += 1) p += Math.exp(logChoose(n, i) - n * Math.log(2));
  return Math.min(1, 2 * p);
};

const bWins = games.filter((g) => g.winnerDepth === B).length;
const byDeal = new Map<string, Game[]>();
for (const g of games) byDeal.set(g.dealSeed, [...(byDeal.get(g.dealSeed) ?? []), g]);
const complete = [...byDeal.values()].filter((gs) => gs.length === 2);
const sweepB = complete.filter((gs) => gs.every((g) => g.winnerDepth === B)).length;
const sweepA = complete.filter((gs) => gs.every((g) => g.winnerDepth === A)).length;
const split = complete.length - sweepB - sweepA;
const meanDiff = games.reduce((s, g) => s + (g.scoreDepthB - g.scoreDepthA), 0) / games.length;
const decided = sweepA + sweepB;

const report = [
  games[0]!.labelA ? `# Match: ${nameB} vs ${nameA}` : `# Review depth match: ${B} plies vs ${A} plies`,
  '',
  games[0]!.labelA
    ? `Two players, ${nameB} against ${nameA}. Games to 60 on identical deals, seats swapped. ${games.length} games over ${complete.length} deals.`
    : `Two players choose every move with the review engine, identical but for search depth (both 2,500 sampled hidden states). Games to 60 on identical deals, seats swapped. ${games.length} games over ${complete.length} deals.`,
  '',
  `| | result |`,
  `| --- | ---: |`,
  `| games won by ${nameB} | ${bWins} of ${games.length} = ${((bWins / games.length) * 100).toFixed(1)}% ${wilson(bWins, games.length)} |`,
  `| sign test vs 50% (games) | p = ${signTestP(bWins, games.length).toFixed(4)} |`,
  `| mean score margin, ${nameB} minus ${nameA} | ${meanDiff.toFixed(1)} points per game |`,
  `| deals swept by ${nameB} (won both seatings) | ${sweepB} |`,
  `| deals swept by ${nameA} | ${sweepA} |`,
  `| deals split one each | ${split} |`,
  decided > 0 ? `| sign test on swept deals | p = ${signTestP(sweepB, decided).toFixed(4)} (${sweepB} of ${decided}) |` : '',
  `| mean seconds per game | ${(games.reduce((s, g) => s + g.seconds, 0) / games.length).toFixed(0)} |`,
  '',
].filter(Boolean).join('\n');
writeFileSync(outPath!, report);
console.log(report);
