import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { SEARCH_ESCALATION_TIERS } from '../adaptiveEvaluateReviewPosition';
import { decideSearchConvergence } from '../evaluationConvergence';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { intervalInsideOneBand } from '../gradeBands';
import { markCutEvaluation, pairedLossInterval, UNBOUNDED_LOSS } from '../partialSearch';
import { severityBadgeAllowed } from '../boundedExactSearch';
import type { MidgameDeterminizationResult, PairedSampleStats } from '../solveMidgameDeterminization';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';

/**
 * A sampled review verdict cut short by the wall-clock ceiling or a node budget (docs/review-partial-honesty-2026-11-08.md): with the option on it carries partial = true and a
 * 95% loss interval, gets a severity badge (or "Best") only when that interval lies inside one grade band, otherwise confidence 'low' and no badge; a run cut before its halfway
 * sample is no longer accepted as "stability-converged"; with the option off nothing changes. The positions below are real ones from the recorded corpus (bot play), cut by a
 * node budget that leaves about 50 of tier 1's 100 hidden hands solved, which is where a free-instance ceiling hit lands (production: 45).
 */
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const positions = replayRecordedSelfPlay(dir);
const tier1 = SEARCH_ESCALATION_TIERS[0]!.budget;
const GAME = 'self-play:demo-ordinary-pvf-1:0';

function position(actionNumber: number): ReviewPositionSnapshotV2 {
  const found = positions.find((p) => p.snapshot.identifiers.gameId === GAME && p.snapshot.identifiers.actionNumber === actionNumber);
  if (!found) throw new Error(`corpus position ${GAME}#${actionNumber} not found`);
  return found.snapshot;
}

const cutByNodes = (actionNumber: number, maxNodes: number, cutHonesty?: boolean) =>
  evaluateReviewPosition(position(actionNumber), { ...tier1, maxNodes, maxWallClockMs: 600_000 }, 0.02, undefined, cutHonesty === undefined ? undefined : { cutHonesty });

describe('pairedLossInterval', () => {
  const stats = (sum: number[], sumSquares: number[], samples = 45, playedIndex = 0): Pick<PairedSampleStats, 'samples' | 'playedIndex' | 'sum' | 'sumSquares'> => ({ samples, playedIndex, sum, sumSquares });

  it('is the best alternative\'s advantage over the played move with a normal 95% interval (a worked example)', () => {
    // alternative 1: mean advantage 1.0, variance 4 over 45 hands -> half-width 1.96 * sqrt(4/45) = 0.584; alternative 2 is clearly behind (mean -3).
    const interval = pairedLossInterval(stats([0, 45, -135], [0, 4 * 44 + 45, 0 + 45 * 9 + 44 * 1]));
    expect(interval![0]).toBeCloseTo(0.416, 2);
    expect(interval![1]).toBeCloseTo(1.584, 2);
    expect(intervalInsideOneBand(interval!)).toBe(false);
  });

  it('a played move that is clearly the best has the interval [0, 0]', () => {
    const interval = pairedLossInterval(stats([0, -90, -135], [0, 45 * 4 + 44 * 0.01, 45 * 9]));
    expect(interval).toEqual([0, 0]);
    expect(intervalInsideOneBand(interval!)).toBe(true);
  });

  it('is unbounded with fewer than 2 hands and null when the played move is not among the legal actions', () => {
    expect(pairedLossInterval(stats([0, 1], [0, 1], 1))).toEqual([0, UNBOUNDED_LOSS]);
    expect(pairedLossInterval(stats([0, 1], [0, 1], 45, -1))).toBeNull();
  });
});

describe('decideSearchConvergence: the vacuous 32 to 49 hand window', () => {
  const cut = (checkpointRecorded: boolean, samples = 45): MidgameDeterminizationResult => ({
    candidates: [],
    best: undefined as never,
    nodes: 1,
    hiddenStateSamples: samples,
    coverage: 0.0005,
    complete: false,
    // exactly what the sampler leaves when it was cut before its halfway sample: defaults, no real comparison
    convergence: { sameTopAction: true, valueDelta: 0, lossDelta: 0, rankingStable: true, sampleCount: samples, feasibleStateEstimate: 100_000 },
    pairedStats: { samples, playedIndex: 0, sum: [0, 0], sumSquares: [0, 0], checkpointRecorded },
  });

  it('today: 45 hands cut before the halfway sample are accepted as "stability-converged" with no test behind it (the defect)', () => {
    expect(decideSearchConvergence(cut(false))).toMatchObject({ accepted: true, reason: 'stability-converged' });
  });

  it('with requireCheckpoint: accepted only as a partial result carrying an interval, never as stability-converged', () => {
    expect(decideSearchConvergence(cut(false), { requireCheckpoint: true })).toMatchObject({ accepted: true, reason: 'partial-interval' });
  });

  it('a run that did record the halfway checkpoint keeps its real stability test, option or not', () => {
    expect(decideSearchConvergence(cut(true, 60), { requireCheckpoint: true })).toMatchObject({ accepted: true, reason: 'stability-converged' });
  });

  it('fewer than 32 hands are not newly accepted', () => {
    expect(decideSearchConvergence(cut(false, 20), { requireCheckpoint: true }).reason).not.toBe('partial-interval');
  });
});

describe('a sampled verdict cut by a node budget (real corpus positions, bot play)', () => {
  it('off (no option, or false): exactly what it always was, with no partialSearch', () => {
    const plain = cutByNodes(48, 2000);
    expect(plain.search.complete).toBe(false);
    expect('partialSearch' in plain).toBe(false);
    expect(cutByNodes(48, 2000, false)).toEqual(plain);
  });

  it('cut at about 50 hands with an interval across two grade bands: partial = true, confidence low, no badge', () => {
    const evaluation = cutByNodes(48, 2000, true);
    expect(evaluation.search.hiddenStateSamples).toBeLessThan(100);
    expect(evaluation.partialSearch).toMatchObject({ partial: true, reason: 'budget', samplesRequested: 100 });
    expect(evaluation.partialSearch!.samplesSolved).toBe(evaluation.search.hiddenStateSamples);
    expect(intervalInsideOneBand(evaluation.partialSearch!.lossInterval)).toBe(false);
    expect(evaluation.evidence).toMatchObject({ source: 'search', confidence: 'low' });
    expect(severityBadgeAllowed(evaluation)).toBe(false);
  });

  it('cut with an interval inside one band: keeps its verdict and its badge, still marked partial = true', () => {
    const evaluation = cutByNodes(46, 2000, true);
    expect(evaluation.partialSearch).toMatchObject({ partial: true, reason: 'budget' });
    expect(intervalInsideOneBand(evaluation.partialSearch!.lossInterval)).toBe(true);
    expect(evaluation.evidence.confidence).toBe('medium');
    expect(severityBadgeAllowed(evaluation)).toBe(true);
    // the verdict itself is the cut run's, unchanged by the option
    const off = cutByNodes(46, 2000);
    expect(evaluation.loss).toEqual(off.loss);
    expect(evaluation.best.action).toEqual(off.best.action);
  });

  it('a cut before the halfway sample (under 50 hands) is accepted as partial-interval with the option, and as stability-converged without it', () => {
    const on = cutByNodes(1, 2000, true);
    const off = cutByNodes(1, 2000);
    expect(on.search.hiddenStateSamples).toBeGreaterThanOrEqual(32);
    expect(on.search.hiddenStateSamples).toBeLessThan(50);
    expect(on.diagnostics).toContain('eval-convergence:partial-interval');
    expect(off.diagnostics).toContain('eval-convergence:stability-converged');
    expect(on.partialSearch?.partial).toBe(true);
  });

  it('a result that ran to its sample budget is unchanged by the option (no partialSearch, byte-identical)', () => {
    const off = cutByNodes(3, 4000);
    const on = cutByNodes(3, 4000, true);
    expect(off.search.complete).toBe(true);
    expect(JSON.stringify(on)).toBe(JSON.stringify(off));
  });

  it('an evaluation that is not a sampled search is returned as the very same object', () => {
    const heuristic = evaluateReviewPosition(position(48), { ...tier1, maxNodes: 50, maxWallClockMs: 600_000 }, 0.02);
    expect(heuristic.evidence.source).toBe('heuristic');
    expect(markCutEvaluation(heuristic, undefined, 'budget', 100)).toBe(heuristic);
  });
});

describe('a locked-yard exact result that was cut before every allocation was solved', () => {
  // A locked yard with several legal actions: the exact solver enumerates every hidden hand, so a small node budget cuts it part-way.
  const lockedYard = positions.find((p) => p.snapshot.preAction.boneyard.drawableCount === 0 && p.snapshot.legalActions.length >= 3 && p.evaluation.candidates.length >= 3)!.snapshot;
  const cutLockedYard = (maxNodes: number, cutHonesty?: boolean) =>
    evaluateReviewPosition(lockedYard, { ...tier1, maxNodes, maxWallClockMs: 600_000 }, 0.02, undefined, cutHonesty === undefined ? undefined : { cutHonesty });

  it('today: it still ships as "Exact analysis, high confidence" with a badge although it was cut (the defect)', () => {
    const evaluation = cutLockedYard(50);
    expect(evaluation.search.complete).toBe(false);
    expect(evaluation.search.coverage).toBeLessThan(1);
    expect(evaluation.evidence).toMatchObject({ source: 'exact', confidence: 'high', displayLabel: 'Exact analysis' });
    expect(severityBadgeAllowed(evaluation)).toBe(true);
  });

  it('with the option: partial = true, an unbounded interval, and no badge; the evidence label stays as the contract types it', () => {
    const off = cutLockedYard(50);
    const on = cutLockedYard(50, true);
    expect(on.partialSearch).toMatchObject({ partial: true, reason: 'budget', lossInterval: [0, UNBOUNDED_LOSS] });
    expect(on.partialSearch!.samplesSolved).toBe(on.search.hiddenStateSamples);
    expect(severityBadgeAllowed(on)).toBe(false);
    expect(on.evidence).toEqual(off.evidence);
    expect(on.loss).toEqual(off.loss);
  });

  it('a locked yard that was solved in full is unchanged by the option', () => {
    const off = cutLockedYard(50_000_000);
    expect(off.search.coverage).toBe(1);
    expect(JSON.stringify(cutLockedYard(50_000_000, true))).toBe(JSON.stringify(off));
  });

  it('a forced locked-yard decision (one legal action) has no verdict to mislead and is left alone even when cut', () => {
    const cutResult = cutLockedYard(50);
    const forced = { ...cutResult, candidates: [cutResult.candidates[0]!] };
    expect(markCutEvaluation(forced, undefined, 'wall-clock', 0)).toBe(forced);
  });
});

describe('a sampled verdict cut by the wall-clock ceiling', () => {
  it('carries partialSearch with reason wall-clock; without the option the same cut is labelled as before', () => {
    // A deterministic fake clock: one tick per poll, so the cut lands after a fixed amount of work whatever the machine.
    const run = (cutHonesty: boolean | undefined, ceilingMs: number) => {
      let ticks = 0;
      const now = () => (ticks += 1);
      return evaluateReviewPosition(position(48), { ...tier1, maxWallClockMs: ceilingMs }, 0.02, now, cutHonesty === undefined ? undefined : { cutHonesty });
    };
    let ceiling = 2_000;
    let on = run(true, ceiling);
    while (on.evidence.source !== 'search' || on.search.hiddenStateSamples < 40) {
      ceiling *= 2;
      on = run(true, ceiling);
      if (ceiling > 4_000_000) throw new Error('no ceiling found that leaves 40 hands');
    }
    expect(on.search.hiddenStateSamples).toBeLessThan(100);
    expect(on.diagnostics).toContain('wall-clock safety ceiling exceeded');
    expect(on.search.complete).toBe(false);
    expect(on.partialSearch).toMatchObject({ partial: true, reason: 'wall-clock', samplesRequested: 100 });
    const off = run(undefined, ceiling);
    expect(off.diagnostics).toContain('wall-clock safety ceiling exceeded');
    expect('partialSearch' in off).toBe(false);
    expect(off.loss).toEqual(on.loss);
  });
});
