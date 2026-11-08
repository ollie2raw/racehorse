/**
 * Item 4 support (docs/review-single-depth-design-2026-11-08.md): where would a win-probability loss differ from the point loss the review shows today? A point of loss means more
 * when the game is close to its end. This counts, over the recorded corpus, how the decisions and the bad moves are spread over the score context (points to go for the player who
 * moves and for the opponent), using the shipped evaluations of wholeGameRun.ts (flag on, unscaled).
 *   npx tsx packages/review-engine/src/devtools/scoreContextStats.ts <run.jsonl>...
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { meanOf, quantile } from './reviewSamplingStudyLib';

type Wg = { gameId: string; move: number; loss: number; grade: string; lifecycle: string; source: string };
const runs = process.argv.slice(2).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Wg));
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const ctx = new Map(replayRecordedSelfPlay(dir).map(({ snapshot }) => [`${snapshot.identifiers.gameId}#${snapshot.identifiers.actionNumber}`, snapshot.preAction]));
const say = (line = '') => process.stdout.write(`${line}\n`);

const scored = runs.filter((r) => r.lifecycle === 'SCORED' && r.source !== 'heuristic');
const rows = scored.map((r) => {
  const p = ctx.get(`${r.gameId}#${r.move}`)!;
  const mine = p.winningTarget - p.scores.actor;
  const theirs = p.winningTarget - p.scores.opponent;
  return { ...r, mine, theirs, closest: Math.min(mine, theirs), diff: p.scores.actor - p.scores.opponent };
});
say(`${rows.length} scored decisions (search or exact evidence); winning target ${[...new Set([...ctx.values()].map((p) => p.winningTarget))].join(', ')} points\n`);
say('| points to go for whoever is closest to the target | decisions | share | Mistake or Blunder | mean point loss of non-Best | max point loss |\n|---|---|---|---|---|---|');
for (const [lo, hi] of [[46, 999], [31, 45], [16, 30], [0, 15]] as const) {
  const set = rows.filter((r) => r.closest >= lo && r.closest <= hi);
  const bad = set.filter((r) => r.grade === 'mistake' || r.grade === 'blunder');
  const nonBest = set.filter((r) => r.grade !== 'best');
  say(`| ${lo === 46 ? '46 or more (early)' : `${lo} to ${hi}${hi === 15 ? ' (endgame)' : ''}`} | ${set.length} | ${((set.length / rows.length) * 100).toFixed(0)}% | ${bad.length} (${set.length ? ((bad.length / set.length) * 100).toFixed(1) : '0'}%) | ${meanOf(nonBest.map((r) => r.loss))?.toFixed(2) ?? 'n/a'} | ${set.length ? Math.max(...set.map((r) => r.loss)).toFixed(1) : 'n/a'} |`);
}
const losses = rows.map((r) => r.loss).filter((x) => x > 0);
say(`\nPoint loss of the played move, all scored decisions with loss above 0 (${losses.length}): median ${quantile(losses, 0.5)?.toFixed(2)}, p90 ${quantile(losses, 0.9)?.toFixed(2)}, p99 ${quantile(losses, 0.99)?.toFixed(2)}, max ${Math.max(...losses).toFixed(1)}.`);
const spread = rows.map((r) => Math.abs(r.diff));
say(`Score difference between the players at the decision: median ${quantile(spread, 0.5)}, p90 ${quantile(spread, 0.9)}, max ${Math.max(...spread)}.`);
