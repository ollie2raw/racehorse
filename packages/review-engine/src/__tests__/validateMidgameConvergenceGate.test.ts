import { describe, expect, it, vi } from 'vitest';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { solveExactEndgame } from '../solveExactEndgame';
import { solveMidgameDeterminization } from '../solveMidgameDeterminization';
import {
  applyF3DecisionRule,
  canonicalActionKey,
  compareGates,
  evaluateOverlaps,
  passesExistingCoverageGate,
  passesProposedConvergenceGate,
  projectCorpusTierMix,
  sameTileDifferentEnd,
  type EvaluatedOverlap,
} from '../devtools/validateMidgameConvergenceGate';
import type { ReviewAction } from '@racehorse/game-core/review';
import type { MidgameDeterminizationResult } from '../solveMidgameDeterminization';
import type { ReviewCaptureRecord } from '../reviewCaptureSchema';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MINIMUM_COVERAGE_FLOOR } from '../gameAccuracyModel';

vi.mock('../solveExactEndgame', () => ({ solveExactEndgame: vi.fn() }));
vi.mock('../solveMidgameDeterminization', () => ({ solveMidgameDeterminization: vi.fn() }));

function play(low: number, high: number, position: 'left' | 'right' = 'left'): ReviewAction {
  return { kind: 'play', tile: { low, high }, position };
}

function midgame(overrides: {
  coverage: number;
  sameTopAction: boolean;
  valueDelta: number;
  best: ReviewAction;
}): MidgameDeterminizationResult {
  const cand = {
    action: overrides.best,
    value: { expectedPointDifferential: 1, winProbability: null },
    immediatePoints: 0,
    principalVariation: [],
  };
  return {
    best: cand,
    candidates: [cand],
    coverage: overrides.coverage,
    convergence: {
      sameTopAction: overrides.sameTopAction,
      valueDelta: overrides.valueDelta,
    },
    nodes: 1,
    depth: 1,
    hiddenStateSamples: 1,
    complete: true,
  } as MidgameDeterminizationResult;
}

function overlap(
  best: ReviewAction,
  exactBests: ReviewAction[],
  gate: { coverage: number; sameTopAction: boolean; valueDelta: number },
): EvaluatedOverlap {
  const mg = midgame({ ...gate, best });
  return {
    exactBestKeys: exactBests.map(canonicalActionKey),
    exactBestActions: exactBests,
    midgame: mg,
    decisionId: 'd',
  };
}

describe('F3a exact-ground-truth admission', () => {
  it('A: counts and excludes incomplete exact results without comparing their ranking', () => {
    vi.mocked(solveExactEndgame).mockReturnValue({
      complete: false,
    } as NonNullable<ReturnType<typeof solveExactEndgame>>);
    const locked = REVIEW_FIXTURE_CORPUS.find(
      (f) => f.snapshot.preAction.boneyard.drawableCount === 0 && f.snapshot.legalActions.length > 1,
    );
    expect(locked).toBeDefined();
    const report = evaluateOverlaps([{ snapshot: locked!.snapshot }]);
    expect(report.excludedIncompleteExact).toBe(1);
    expect(report.results).toEqual([]);
    expect(solveMidgameDeterminization).not.toHaveBeenCalled();
  });

  it('B: gate classification is deterministic for fixed coverage/convergence', () => {
    const signal = {
      coverage: 0.05,
      convergence: { sameTopAction: true, valueDelta: 0.1 },
    };
    expect(passesExistingCoverageGate(signal.coverage)).toBe(true);
    expect(passesProposedConvergenceGate(signal)).toBe(true);
    expect(passesProposedConvergenceGate({ ...signal, convergence: { ...signal.convergence, valueDelta: 0.5 } })).toBe(
      false,
    );
    expect(passesProposedConvergenceGate({ ...signal, convergence: { sameTopAction: false, valueDelta: 0 } })).toBe(
      false,
    );
  });

  it('C/D: newly-admitted and newly-rejected set differences are correct', () => {
    const exact = [play(1, 2, 'left')];
    const rows = [
      // old pass, new pass
      overlap(play(1, 2, 'left'), exact, { coverage: 0.05, sameTopAction: true, valueDelta: 0.1 }),
      // newly admitted: old fail, new pass (coverage below 0.02 but… wait, new also requires coverage >= 0.02)
      // So newly admitted needs coverage >= 0.02 AND convergence, while old fails — impossible if old is coverage-only at 0.02.
      // Newly admitted under AND gate with same minCoverage can only happen if… old uses coverage and new also needs convergence.
      // Actually newly admitted = newPass && !oldPass. If both require coverage >= 0.02, newly admitted is impossible
      // unless we had higher old threshold. Looking at F3b: same minCoverage. Newly admitted when old fails coverage?
      // That can't happen if new also requires coverage. Newly REJECTED is the main flip direction for AND gate.
      //
      // Wait — oldPass = coverage >= 0.02. newPass = coverage >= 0.02 AND sameTopAction AND valueDelta <= 0.26.
      // So newPass implies oldPass. newlyAdmitted is ALWAYS 0 for this gate shape!
      // newlyRejected = oldPass && !newPass when convergence fails.
      //
      // That's important — the AND gate can only newly REJECT, never newly ADMIT relative to coverage-only
      // when minCoverage is identical. The recovered F3a still measured newlyAdmitted for exploratory grids
      // with minCoverage=0. The product rule still applies: if newlyAdmitted=0 → insufficient → FAIL.
      overlap(play(1, 2, 'left'), exact, { coverage: 0.05, sameTopAction: false, valueDelta: 0 }),
      overlap(play(1, 2, 'left'), exact, { coverage: 0.01, sameTopAction: true, valueDelta: 0 }),
    ];
    const report = compareGates(rows);
    expect(report.newlyAdmitted.count).toBe(0);
    expect(report.newlyRejected.count).toBe(1);
    expect(report.existingGate.admitted).toBe(2);
    expect(report.convergenceGate.admitted).toBe(1);
    expect(report.flips).toBe(1);
  });

  it('E: same-tile/different-end mismatch counts as an exact-action error', () => {
    expect(sameTileDifferentEnd(play(2, 2, 'left'), play(2, 2, 'right'))).toBe(true);
    expect(canonicalActionKey(play(2, 2, 'left'))).not.toBe(canonicalActionKey(play(2, 2, 'right')));
    const report = compareGates([
      overlap(play(2, 2, 'right'), [play(2, 2, 'left')], {
        coverage: 0.05,
        sameTopAction: true,
        valueDelta: 0.1,
      }),
    ]);
    expect(report.existingGate.errors).toBe(1);
    expect(report.existingGate.sameTileWrongEnd).toBe(1);
    expect(report.existingGate.differentAction).toBe(0);
  });

  it('F: denominator arithmetic is exact', () => {
    const exact = [play(0, 1)];
    const report = compareGates([
      overlap(play(0, 1), exact, { coverage: 0.05, sameTopAction: true, valueDelta: 0 }),
      overlap(play(3, 4), exact, { coverage: 0.05, sameTopAction: true, valueDelta: 0 }),
      overlap(play(0, 1), exact, { coverage: 0.01, sameTopAction: true, valueDelta: 0 }),
    ]);
    expect(report.totalOverlapCases).toBe(3);
    expect(report.existingGate.admitted).toBe(2);
    expect(report.existingGate.errors).toBe(1);
    expect(report.existingGate.errorRate).toBeCloseTo(0.5, 10);
    expect(report.newlyAdmitted.count + report.newlyRejected.count).toBe(report.flips);
  });

  it('G: decision rule PASS fixture when new error ≤ existing error', () => {
    const ruled = applyF3DecisionRule({
      newlyAdmittedCount: 10,
      newlyAdmittedErrors: 1,
      existingAdmittedCount: 10,
      existingErrors: 2,
    });
    expect(ruled.decision).toBe('PASS');
    expect(ruled.decisionLine).toBe('F3 DECISION: PASS — convergence gate eligible for F3b');
  });

  it('H: decision rule FAIL fixture when new error > existing error', () => {
    const ruled = applyF3DecisionRule({
      newlyAdmittedCount: 10,
      newlyAdmittedErrors: 3,
      existingAdmittedCount: 10,
      existingErrors: 2,
    });
    expect(ruled.decision).toBe('FAIL');
    expect(ruled.decisionLine).toBe('F3 DECISION: FAIL — retain existing coverage gate');
  });

  it('I: tier-mix accounting totals correctly', () => {
    const mk = (
      source: 'exact' | 'search' | 'heuristic',
      coverage: number,
      convergence?: { sameTopAction: boolean; valueDelta: number },
      forced = false,
    ): ReviewCaptureRecord =>
      ({
        evaluation: {
          evidence: { source },
          candidates: forced
            ? [{ action: play(1, 1) }]
            : [{ action: play(1, 1) }, { action: play(2, 2) }],
          search: { coverage, nodes: 1, depth: 1, hiddenStateSamples: 1, complete: true },
          convergence,
        },
      }) as ReviewCaptureRecord;

    const report = projectCorpusTierMix([
      mk('exact', 0),
      mk('search', 0.05, { sameTopAction: true, valueDelta: 0 }),
      mk('search', 0.05, { sameTopAction: false, valueDelta: 0 }), // newly rejected
      mk('heuristic', 0.01, { sameTopAction: true, valueDelta: 0 }), // stays heuristic
      mk('exact', 0, undefined, true), // forced skipped
    ]);
    expect(report.totalDecisions).toBe(5);
    expect(report.nonForced).toBe(4);
    expect(report.before.exact + report.before.search + report.before.heuristic).toBe(4);
    expect(report.after.exact + report.after.search + report.after.heuristic).toBe(4);
    expect(report.newlyRejected).toBe(1);
    expect(report.newlyAdmitted).toBe(0);
    expect(report.flips).toBe(1);
  });

  it('J: study module does not mutate production MINIMUM_COVERAGE_FLOOR', () => {
    const before = MINIMUM_COVERAGE_FLOOR;
    compareGates([]);
    projectCorpusTierMix([]);
    expect(MINIMUM_COVERAGE_FLOOR).toBe(before);
    expect(MINIMUM_COVERAGE_FLOOR).toBeCloseTo(0.46808510638297873, 10);
    // Production evaluateReviewPosition source must remain coverage-only (no gate import).
    const evalSrc = fs.readFileSync(
      path.resolve(__dirname, '../evaluateReviewPosition.ts'),
      'utf8',
    );
    expect(evalSrc).not.toMatch(/passesProposedConvergenceGate|midgameConvergenceGate|PROPOSED_MAX_CONVERGENCE/);
  });
});
