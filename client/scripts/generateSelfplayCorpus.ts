/**
 * Generates and summarizes the self-play corpus (see src/devtools/selfplayCorpus.ts).
 *
 *   nice -n 15 npx tsx scripts/generateSelfplayCorpus.ts --out /Users/olivermorid/racehorse-selfplay-data --seed 1 \
 *     --games-per-shard 25 --max-minutes 75
 *   npx tsx scripts/generateSelfplayCorpus.ts --out <dir> --summarize [--report path.md]
 *
 * Resumable: shard k of seed s is a pure function of (s, k, mix), written atomically as selfplay-s<seed>-k<shard>.jsonl.gz
 * and listed in manifest.json; a rerun skips shards already listed. The data lives OUTSIDE the repo.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  buildShard,
  CORPUS_SCHEMA_VERSION,
  DEFAULT_MIX,
  shardFileName,
  type DecisionRecord,
  type PolicyMix,
} from '../src/devtools/selfplayCorpus.ts';

interface ShardEntry {
  index: number;
  file: string;
  games: number;
  decisions: number;
  bytes: number;
  sha256: string;
  elapsedMs: number;
}

interface Manifest {
  schemaVersion: number;
  seed: number;
  mix: PolicyMix;
  gamesPerShard: number;
  searchBudgetMode: 'nodes';
  node: string;
  shards: ShardEntry[];
}

const argv = process.argv.slice(2);
const arg = (name: string, fallback?: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : fallback;
};
const flag = (name: string): boolean => argv.includes(`--${name}`);

const outDir = arg('out', '/Users/olivermorid/racehorse-selfplay-data')!;
mkdirSync(outDir, { recursive: true });
const manifestPath = path.join(outDir, 'manifest.json');

function generate(): void {
  const seed = Number(arg('seed', '1'));
  const gamesPerShard = Number(arg('games-per-shard', '25'));
  const maxMinutes = Number(arg('max-minutes', '75'));
  const maxShards = Number(arg('max-shards', '100000'));
  const mix: PolicyMix = arg('mix') ? (JSON.parse(arg('mix')!) as PolicyMix) : DEFAULT_MIX;
  const manifest: Manifest = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
    : { schemaVersion: CORPUS_SCHEMA_VERSION, seed, mix, gamesPerShard, searchBudgetMode: 'nodes', node: process.version, shards: [] };
  if (manifest.seed !== seed || manifest.gamesPerShard !== gamesPerShard || JSON.stringify(manifest.mix) !== JSON.stringify(mix)) {
    throw new Error('manifest.json in --out was made with a different seed, games-per-shard or mix: use a fresh --out');
  }
  const done = new Set(manifest.shards.map((s) => s.index));
  const started = Date.now();
  let made = 0;
  for (let shard = 0; made < maxShards; shard++) {
    if (done.has(shard)) continue;
    if ((Date.now() - started) / 60000 >= maxMinutes) break;
    const t0 = Date.now();
    const { bytes, decisions } = buildShard(seed, shard, gamesPerShard, mix);
    const file = shardFileName(seed, shard);
    const tmp = path.join(outDir, `${file}.tmp`);
    writeFileSync(tmp, bytes);
    renameSync(tmp, path.join(outDir, file));
    manifest.shards.push({
      index: shard,
      file,
      games: gamesPerShard,
      decisions,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      elapsedMs: Date.now() - t0,
    });
    manifest.shards.sort((a, b) => a.index - b.index);
    const manifestTmp = `${manifestPath}.tmp`;
    writeFileSync(manifestTmp, JSON.stringify(manifest, null, 2));
    renameSync(manifestTmp, manifestPath);
    made += 1;
    const games = manifest.shards.reduce((n, s) => n + s.games, 0);
    const minutes = (Date.now() - started) / 60000;
    console.log(
      `shard ${shard}: ${gamesPerShard} games, ${decisions} decisions, ${(bytes.length / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(0)} s | total ${games} games in ${minutes.toFixed(1)} min`,
    );
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────

const pct = (n: number, d: number): string => (d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`);

/** Label for `value` against ascending upper-exclusive edges: "<10", "10-19", ..., "60+". */
function bucket(value: number, edges: number[]): string {
  for (let i = 0; i < edges.length; i++) {
    if (value < edges[i]!) return i === 0 ? `<${edges[0]}` : `${edges[i - 1]}..${edges[i]! - 1}`;
  }
  return `${edges[edges.length - 1]}+`;
}

function summarize(): string {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const files = readdirSync(outDir).filter((f) => f.endsWith('.jsonl.gz')).sort();
  let games = 0;
  let decisions = 0;
  let bytes = 0;
  let forced = 0;
  let explore = 0;
  let wonHand = 0;
  let wonGame = 0;
  const byPolicy: Record<string, number> = {};
  const seatGamesByPolicy: Record<string, number> = {};
  const seenGames = new Set<string>();
  const seenSeatGames = new Set<string>();
  const leaderScore: Record<string, number> = {};
  const scoreMargin: Record<string, number> = {};
  const handNumber: Record<string, number> = {};
  const handOutcome: Record<string, number> = {};
  const finalMargins: number[] = [];
  for (const file of files) {
    const raw = readFileSync(path.join(outDir, file));
    bytes += raw.length;
    for (const line of gunzipSync(raw).toString('utf8').split('\n')) {
      if (!line) continue;
      const d = JSON.parse(line) as DecisionRecord;
      decisions += 1;
      if (!seenGames.has(d.gameId)) {
        seenGames.add(d.gameId);
        games += 1;
        finalMargins.push(Math.abs(d.outcome.finalMargin));
      }
      const seatGame = `${d.gameId}:${d.seat}`;
      if (!seenSeatGames.has(seatGame)) {
        seenSeatGames.add(seatGame);
        seatGamesByPolicy[d.policy] = (seatGamesByPolicy[d.policy] ?? 0) + 1;
      }
      byPolicy[d.policy] = (byPolicy[d.policy] ?? 0) + 1;
      if (d.moveSource === 'forced') forced += 1;
      if (d.moveSource === 'explore') explore += 1;
      if (d.outcome.wonHand === 1) wonHand += 1;
      if (d.outcome.wonGame === 1) wonGame += 1;
      const lead = bucket(Math.max(d.features.ownScore, d.features.oppScore), [10, 20, 30, 40, 50]);
      leaderScore[lead] = (leaderScore[lead] ?? 0) + 1;
      const margin = bucket(Math.abs(d.features.ownScore - d.features.oppScore), [5, 10, 20, 30]);
      scoreMargin[margin] = (scoreMargin[margin] ?? 0) + 1;
      const hand = d.hand <= 2 ? `hand ${d.hand}` : d.hand <= 4 ? 'hands 3-4' : d.hand <= 6 ? 'hands 5-6' : 'hands 7+';
      handNumber[hand] = (handNumber[hand] ?? 0) + 1;
      const net = bucket(d.outcome.ptsSelfToHandEnd - d.outcome.ptsOppToHandEnd, [-5, 0, 1, 6, 11]);
      handOutcome[net] = (handOutcome[net] ?? 0) + 1;
    }
  }
  // A shard that took more than 5x the median is the laptop sleeping or being busy, not generation: report both.
  const shardMs = manifest.shards.map((s) => s.elapsedMs).sort((a, b) => a - b);
  const medianShardMs = shardMs[Math.floor(shardMs.length / 2)] ?? 0;
  const slowShards = manifest.shards.filter((s) => s.elapsedMs > 5 * medianShardMs);
  const elapsedMs = manifest.shards.filter((s) => s.elapsedMs <= 5 * medianShardMs).reduce((n, s) => n + s.elapsedMs, 0);
  const gamesInElapsed = manifest.shards.filter((s) => s.elapsedMs <= 5 * medianShardMs).reduce((n, s) => n + s.games, 0);
  const gamesPerHour = elapsedMs > 0 ? (gamesInElapsed / elapsedMs) * 3_600_000 : 0;
  const gamesPerShard = manifest.gamesPerShard;
  const medianGamesPerHour = medianShardMs > 0 ? (gamesPerShard / medianShardMs) * 3_600_000 : 0;
  const table = (title: string, rec: Record<string, number>, total: number, order?: string[]): string => {
    const keys = order ?? Object.keys(rec).sort((a, b) => (rec[b] ?? 0) - (rec[a] ?? 0));
    return [`| ${title} | count | share |`, '|---|---:|---:|', ...keys.filter((k) => rec[k] !== undefined).map((k) => `| ${k} | ${rec[k]} | ${pct(rec[k]!, total)} |`)].join('\n');
  };
  const sorted = [...finalMargins].sort((a, b) => a - b);
  const q = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return [
    `corpus: ${games} games, ${decisions} decisions, ${(bytes / 1048576).toFixed(2)} MB gzipped in ${files.length} shards`,
    `generation (one niced shard): ${(elapsedMs / 60000).toFixed(1)} min over ${manifest.shards.length - slowShards.length} normal shards = ${gamesPerHour.toFixed(0)} games/hour (median shard ${(medianShardMs / 1000).toFixed(0)} s = ${medianGamesPerHour.toFixed(0)} games/hour); ${(decisions / Math.max(1, games)).toFixed(1)} decisions/game`,
    slowShards.length > 0
      ? `excluded as sleep/busy outliers (more than 5x the median shard): ${slowShards.map((s) => `shard ${s.index} took ${(s.elapsedMs / 60000).toFixed(1)} min`).join(', ')}`
      : 'no outlier shards',
    `forced decisions (one legal play): ${forced} (${pct(forced, decisions)}); exploratory moves (epsilon/uniform): ${explore} (${pct(explore, decisions)})`,
    `acting seat won the hand on ${pct(wonHand, decisions)} of decisions and the game on ${pct(wonGame, decisions)}`,
    `final game margin |self - opponent| over games: p25 ${q(0.25)}, median ${q(0.5)}, p75 ${q(0.75)}, p90 ${q(0.9)}`,
    '',
    table('policy (share of decisions)', byPolicy, decisions),
    '',
    table('policy (share of seat-games)', seatGamesByPolicy, seenSeatGames.size),
    '',
    table('leader score at decision time', leaderScore, decisions, ['<10', '10..19', '20..29', '30..39', '40..49', '50+']),
    '',
    table('score margin at decision time', scoreMargin, decisions, ['<5', '5..9', '10..19', '20..29', '30+']),
    '',
    table('hand number', handNumber, decisions, ['hand 1', 'hand 2', 'hands 3-4', 'hands 5-6', 'hands 7+']),
    '',
    table('points self minus opponent, decision to hand end', handOutcome, decisions, ['<-5', '-5..-1', '0..0', '1..5', '6..10', '11+']),
  ].join('\n');
}

if (flag('summarize')) {
  const text = summarize();
  console.log(text);
  if (arg('report')) writeFileSync(arg('report')!, text + '\n');
} else {
  generate();
}
