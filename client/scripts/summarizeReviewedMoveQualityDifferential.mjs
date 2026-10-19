#!/usr/bin/env node
/**
 * Summarises the opt-in legacy-vs-V2 avgMoveQuality audit (src/analyzer/reviewedMoveQuality.differential.test.ts).
 *   node scripts/summarizeReviewedMoveQualityDifferential.mjs /tmp/mq.jsonl
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: summarizeReviewedMoveQualityDifferential.mjs <mq.jsonl>');
  process.exit(2);
}
const rows = readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (x) => (num(x) ? x.toFixed(2) : String(x));

const both = rows.filter((r) => num(r.legacy) && num(r.v2));
const diffs = both.map((r) => r.v2 - r.legacy);
const abs = diffs.map(Math.abs);

console.log(`game-seats: ${rows.length}  games: ${new Set(rows.map((r) => r.id)).size}  with both stats: ${both.length}`);
console.log(`V2 unavailable: ${rows.filter((r) => r.v2Status !== 'available').length} ${JSON.stringify(rows.filter((r) => r.v2Status !== 'available').map((r) => [r.id, r.seat, r.v2Reason]))}`);
console.log(`legacy null: ${rows.filter((r) => !num(r.legacy)).length}`);
console.log(`V2 JSON round trip identical on every row: ${rows.every((r) => r.v2RoundTripEqual)}`);
if (both.length) {
  console.log(`\nV2 - legacy:  mean ${fmt(mean(diffs))}  median ${fmt(median(diffs))}  mean|d| ${fmt(mean(abs))}  median|d| ${fmt(median(abs))}  max|d| ${fmt(Math.max(...abs))}`);
  console.log(`legacy mean ${fmt(mean(both.map((r) => r.legacy)))} (sd-range ${fmt(Math.min(...both.map((r) => r.legacy)))}..${fmt(Math.max(...both.map((r) => r.legacy)))})   V2 mean ${fmt(mean(both.map((r) => r.v2)))} (${fmt(Math.min(...both.map((r) => r.v2)))}..${fmt(Math.max(...both.map((r) => r.v2)))})`);
  const corr = (() => {
    const xs = both.map((r) => r.legacy); const ys = both.map((r) => r.v2);
    const mx = mean(xs); const my = mean(ys);
    const cov = mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
    return cov / (Math.sqrt(mean(xs.map((x) => (x - mx) ** 2))) * Math.sqrt(mean(ys.map((y) => (y - my) ** 2))));
  })();
  console.log(`Pearson r (legacy, V2): ${fmt(corr)}`);

  console.log('\nlargest differences (replay: makeGame(\'multiplayer-quality-v2\', n)):');
  [...both].sort((a, b) => Math.abs(b.v2 - b.legacy) - Math.abs(a.v2 - a.legacy)).slice(0, 8).forEach((r) => {
    console.log(`  ${r.id} seat=${r.seat} policy=${r.policy} legacy=${fmt(r.legacy)} v2=${fmt(r.v2)} diff=${fmt(r.v2 - r.legacy)}  decisions=${r.decisions} graded=${r.v2Graded} forced=${r.v2Forced} draws=${r.draws} passes=${r.passes} doubles=${r.doubles} branch=${r.branchPlays} legacyConst80/84/72/46=${r.legacyDetail.onlyLegalConst80}/${r.legacyDetail.forcedDrawPassConst84}/${r.legacyDetail.noEngineConst72}/${r.legacyDetail.nonPlayWithPlays46}`);
  });

  // Same game, both seats: does the better player change?
  const byGame = new Map();
  for (const r of both) byGame.set(r.id, { ...(byGame.get(r.id) ?? {}), [r.seat]: r });
  const pairs = [...byGame.entries()].filter(([, v]) => v.you && v.bot);
  const flips = pairs.filter(([, v]) => Math.sign(v.you.legacy - v.bot.legacy) !== Math.sign(v.you.v2 - v.bot.v2));
  console.log(`\nseat ranking within a game (you vs bot): ${pairs.length} games with both seats; ordering changes in ${flips.length}`);
  flips.forEach(([id, v]) => console.log(`  ${id}: legacy you=${fmt(v.you.legacy)} bot=${fmt(v.bot.legacy)} | v2 you=${fmt(v.you.v2)} bot=${fmt(v.bot.v2)} | policies you=${v.you.policy} bot=${v.bot.policy}`));

  // Does each stat follow play strength? mean by policy.
  console.log('\nmean by policy (legacy | V2):');
  for (const policy of [...new Set(both.map((r) => r.policy))].sort()) {
    const rs = both.filter((r) => r.policy === policy);
    console.log(`  ${policy.padEnd(8)} n=${rs.length}  legacy ${fmt(mean(rs.map((r) => r.legacy)))}  v2 ${fmt(mean(rs.map((r) => r.v2)))}`);
  }

  const total = (key) => both.reduce((a, r) => a + r.legacyDetail[key], 0);
  const moves = both.reduce((a, r) => a + r.legacyDetail.moves, 0);
  console.log(`\nlegacy rows averaged: ${moves} moves; fixed constants: only-legal(80)=${total('onlyLegalConst80')}  forced draw/pass(84)=${total('forcedDrawPassConst84')}  no-engine/no-plays(72)=${total('noEngineConst72')}  non-play-with-plays(46)=${total('nonPlayWithPlays46')}`);
  console.log(`V2 graded decisions: ${both.reduce((a, r) => a + r.v2Graded, 0)}  forced (excluded): ${both.reduce((a, r) => a + r.v2Forced, 0)}`);
}
const ms = rows.map((r) => r.ms);
console.log(`\nV2 job wall time per game-seat: median ${fmt(median(ms) / 1000)}s  max ${fmt(Math.max(...ms) / 1000)}s`);
