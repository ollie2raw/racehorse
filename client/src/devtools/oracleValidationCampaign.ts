/** Offline Phase F experiments. No network, database, credentials, or live UI. */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeHeadToHead, type GameResult, type OracleVariant } from './oracleVsFritzHeadToHead.ts';

const harness = join(dirname(fileURLToPath(import.meta.url)), 'oracleVsFritzHeadToHead.ts');
const variants: OracleVariant[] = ['default', 'oracle-fallback-to-fritz-master-heuristic'];
type BatchResult = { games: GameResult[]; loadExceeded: boolean; elapsedMs: number };
type LoadSample = { at: string; loadavg: number[] };

export function sampleStats(values: readonly number[]) {
  const n = values.length;
  const mean = n ? values.reduce((sum, value) => sum + value, 0) / n : 0;
  const variance = n > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1) : 0;
  const standardError = n ? Math.sqrt(variance / n) : 0;
  return { n, mean, standardError, ci95: [mean - 1.96 * standardError, mean + 1.96 * standardError] };
}

export function masterScores(games: readonly GameResult[]) {
  return sampleStats(games.map(game => game.finalScore['fritz-master']));
}

export function compareMasterScores(baseline: readonly GameResult[], repeated: readonly GameResult[]) {
  if (baseline.length !== repeated.length || baseline.some((game, index) => game.seed !== repeated[index].seed || game.gameIndex !== repeated[index].gameIndex)) {
    throw new Error('Score comparison requires identical ordered seeds.');
  }
  const reference = masterScores(baseline);
  const repeat = masterScores(repeated);
  const difference = repeat.mean - reference.mean;
  // Pre-run convention: compare the absolute mean change with the baseline
  // batch's between-seed SEM, not a fitted or selected post-result threshold.
  return { reference, repeat, difference, threshold: reference.standardError, passed: Math.abs(difference) <= reference.standardError };
}

export function moveDivergence(first: readonly GameResult[], second: readonly GameResult[]) {
  let comparable = 0;
  let different = 0;
  let firstMasterDecisions = 0;
  let secondMasterDecisions = 0;
  const bySeed = first.map((game, index) => {
    const rerun = second[index];
    if (!rerun || game.seed !== rerun.seed || game.gameIndex !== rerun.gameIndex) throw new Error('Rerun seed mismatch.');
    const key = (row: GameResult['replayTrace'][number]) => `${row.stateDigest}:${row.actor}`;
    const original = game.replayTrace.filter(row => row.masterConsulted);
    const repeated = rerun.replayTrace.filter(row => row.masterConsulted);
    const other = new Map(repeated.map(row => [key(row), row]));
    let matched = 0;
    let changed = 0;
    for (const row of original) {
      const samePosition = other.get(key(row));
      if (!samePosition) continue;
      matched += 1;
      if (JSON.stringify(row.action) !== JSON.stringify(samePosition.action)) changed += 1;
    }
    comparable += matched;
    different += changed;
    firstMasterDecisions += original.length;
    secondMasterDecisions += repeated.length;
    return { seed: `${game.seed}:game${game.gameIndex}`, comparable: matched, different: changed, first: original.length, second: repeated.length };
  });
  if (first.length !== second.length) throw new Error('Rerun size mismatch.');
  return { seeds: first.length, comparable, different, divergenceRate: comparable ? different / comparable : null,
    firstMasterDecisions, secondMasterDecisions, unmatchedFirst: firstMasterDecisions - comparable,
    unmatchedSecond: secondMasterDecisions - comparable, bySeed,
    denominator: 'Master decisions at identical state digests and actors across two independent seeded reruns; divergent downstream positions are separately reported, not treated as equal moves.' };
}

export function d1Result(games: readonly GameResult[]) {
  const difference = sampleStats(games.map(game => game.winnerPolicy === 'oracle-top-move' ? 1 : game.winnerPolicy === 'fritz-master' ? -1 : 0));
  const branch = difference.ci95[0] <= 0 && difference.ci95[1] >= 0 ? 'indistinguishable'
    : difference.mean > 0 ? 'oracle-stronger-search-authoritative' : 'fritz-stronger-block-F2-prose';
  return { ...summarizeHeadToHead(games), winRateDifference: difference, branch };
}

async function batch(root: string, label: string, seed: string, gameCount: number, workers: number, variant: OracleVariant = 'default', startIndex = 0): Promise<BatchResult> {
  const out = join(root, label);
  mkdirSync(out, { recursive: true });
  const start = Date.now();
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn('caffeinate', ['-i', process.execPath, '--import', 'tsx', harness,
      '--seed', seed, '--games', String(gameCount), '--workers', String(workers), '--variant', variant,
      '--start-index', String(startIndex), '--out', out], { stdio: ['ignore', 'ignore', 'inherit'] });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolveRun() : reject(new Error(`${label} failed: ${code ?? signal}`)));
  });
  const name = `h2h--variant-${variant}--seed-${seed}--start-${startIndex}--games-${gameCount}`;
  const result = JSON.parse(readFileSync(join(out, `${name}.results.json`), 'utf8')) as { status: string; games: GameResult[]; loadExceeded: boolean };
  if (result.status !== 'complete' || result.games.length !== gameCount) throw new Error(`${label}: incomplete results`);
  return { games: result.games, loadExceeded: result.loadExceeded, elapsedMs: Date.now() - start };
}

async function main() {
  const mode = process.argv[2];
  if (!['timing', 'calibration', 'divergence', 'campaign'].includes(mode)) throw new Error('Mode: timing|calibration|divergence|campaign');
  const root = resolve(process.argv[3] ?? '/private/tmp/racehorse-f1-results');
  mkdirSync(root, { recursive: true });
  const resultPath = join(root, `${mode}.json`);
  const loadSamples: LoadSample[] = [];
  let progress: Record<string, unknown> = { status: 'running', mode, pid: process.pid };
  const save = () => writeFileSync(resultPath, JSON.stringify({ ...progress, loadSamples, loadExceeded: loadSamples.some(row => row.loadavg[0] > 6) }, null, 2));
  const sample = () => { loadSamples.push({ at: new Date().toISOString(), loadavg: loadavg() }); save(); };
  sample();
  const timer = setInterval(sample, 300_000);
  try {
    if (mode === 'timing') {
      const result = await batch(root, 'timing-2-games', 'f1-timing-v1', 2, 1);
      const projectedMs = result.elapsedMs / 2 * 2 * 600;
      progress = { ...progress, elapsedMs: result.elapsedMs, projectedMs, gamesPerVariant: projectedMs > 8 * 3600_000 ? 400 : 600,
        projection: 'Conservative single-worker projection; includes process startup.', batchLoadExceeded: result.loadExceeded };
    } else if (mode === 'calibration') {
      const baseline = await batch(root, 'calibration-w1', 'f1-load-calibration-v1', 40, 1);
      const comparisons = [];
      let workers = 1;
      for (const candidate of [4, 3, 2]) {
        const repeat = await batch(root, `calibration-w${candidate}`, 'f1-load-calibration-v1', 40, candidate);
        const comparison = compareMasterScores(baseline.games, repeat.games);
        comparisons.push({ workers: candidate, ...comparison, loadExceeded: baseline.loadExceeded || repeat.loadExceeded });
        progress = { ...progress, comparisons }; save();
        if (comparison.passed) { workers = candidate; break; }
      }
      progress = { ...progress, workers, baseline: masterScores(baseline.games), comparisons,
        convention: 'Absolute mean change <= baseline between-seed standard error; candidates tested 4,3,2, otherwise baseline 1.' };
    } else if (mode === 'divergence') {
      const first = await batch(root, 'divergence-first', 'f1-rerun-v1', 50, 1);
      const second = await batch(root, 'divergence-second', 'f1-rerun-v1', 50, 1);
      progress = { ...progress, ...moveDivergence(first.games, second.games), batchLoadExceeded: first.loadExceeded || second.loadExceeded };
    } else {
      const timing = JSON.parse(readFileSync(join(root, 'timing.json'), 'utf8'));
      const calibration = JSON.parse(readFileSync(join(root, 'calibration.json'), 'utf8'));
      const divergence = JSON.parse(readFileSync(join(root, 'divergence.json'), 'utf8'));
      if ([timing, calibration, divergence].some(value => value.status !== 'complete')) throw new Error('Prerequisites incomplete.');
      const workers: number = calibration.workers;
      const count: number = timing.gamesPerVariant;
      if (![400, 600].includes(count) || !Number.isInteger(workers) || workers < 1 || workers > 4) throw new Error('Invalid campaign configuration.');
      const thermalStart = await batch(root, 'thermal-start', 'f1-thermal-v1', 40, workers);
      const games: GameResult[][] = [[], []];
      let anyBatchLoadExceeded = thermalStart.loadExceeded;
      for (let startIndex = 0; startIndex < count; startIndex += 100) {
        for (let index = 0; index < variants.length; index += 1) {
          const result = await batch(root, `variant-${index}-chunk-${startIndex}`, 'f1-production-study-v1', Math.min(100, count - startIndex), workers, variants[index], startIndex);
          games[index].push(...result.games);
          anyBatchLoadExceeded ||= result.loadExceeded;
          progress = { ...progress, workers, gamesPerVariant: count, completedGames: games.map(group => group.length), phase: 'interleaved-chunks' }; save();
        }
      }
      const thermalEnd = await batch(root, 'thermal-end', 'f1-thermal-v1', 40, workers);
      anyBatchLoadExceeded ||= thermalEnd.loadExceeded;
      const thermal = compareMasterScores(thermalStart.games, thermalEnd.games);
      const valid = thermal.passed && !anyBatchLoadExceeded && !loadSamples.some(row => row.loadavg[0] > 6);
      const outcome = (game: GameResult) => game.winnerPolicy === 'oracle-top-move' ? 1 : game.winnerPolicy === 'fritz-master' ? 0 : 0.5;
      const fallbackComparison = sampleStats(games[1].map((game, index) => outcome(game) - outcome(games[0][index])));
      progress = { ...progress, thermal, anyBatchLoadExceeded, valid,
        invalidReason: !thermal.passed ? 'thermally-compromised: rerun lower workers or shorter chunks with cooldown' : !valid ? 'load-exceeded-6' : null,
        // No D1 verdict is emitted for compromised experiments.
        d1: valid ? games.map(group => d1Result(group)) : null,
        fallbackComparison: valid ? { ...fallbackComparison, proposalOnly: fallbackComparison.ci95[0] > 0 } : null };
    }
    progress = { ...progress, status: 'complete' };
  } catch (error) {
    progress = { ...progress, status: 'failed', error: String(error) };
    process.exitCode = 1;
  } finally {
    clearInterval(timer);
    loadSamples.push({ at: new Date().toISOString(), loadavg: loadavg() });
    if (mode === 'campaign' && loadSamples.some(row => row.loadavg[0] > 6)) {
      progress = { ...progress, valid: false, d1: null, fallbackComparison: null,
        invalidReason: progress.invalidReason ?? 'load-exceeded-6' };
    }
    save();
  }
  console.log(JSON.stringify({ resultPath, status: progress.status }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
