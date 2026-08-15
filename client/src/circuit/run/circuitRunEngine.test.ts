import { describe, expect, it } from 'vitest';
import {
  continueAfterCircuitFeedback,
  startCircuitRun,
  submitCircuitDecision,
  deepestGateReached,
  circuitAccuracy,
  circuitDecisionQuality,
  personalBestDelta,
  mostCostlyDecision,
  buildImprovementTarget,
  CIRCUIT_CATEGORY_SAMPLE_MIN,
} from './circuitRunEngine.ts';
import { computeCircuitDecisionPoints } from './circuitScoring.ts';
import { evaluateCircuitDecision, createActiveDecisionFromScenario } from './circuitEvaluate.ts';
import {
  evaluateCircuitMove,
  createDecisionContextFromScenario,
  getCertifiedCircuitScenarioById,
  getCertifiedCircuitScenarios,
} from '@racehorse/game-core';

describe('circuitScoring (shared formula)', () => {
  it('matches shared optimal/combo math without speed bonus', () => {
    expect(
      computeCircuitDecisionPoints({ grade: 'optimal', difficulty: 2, comboBefore: 1 }),
    ).toEqual({ points: 224, nextCombo: 2 });
    expect(
      computeCircuitDecisionPoints({ grade: 'blunder', difficulty: 5, comboBefore: 4 }),
    ).toEqual({ points: 0, nextCombo: 0 });
  });
});

describe('UI evaluator parity with shared authority', () => {
  it('matches game-core for every certified optimal and strong move', () => {
    for (const scenario of getCertifiedCircuitScenarios()) {
      if (scenario.kind === 'single_gate') {
        const uiCtx = createActiveDecisionFromScenario(scenario);
        const coreCtx = createDecisionContextFromScenario(scenario);
        expect(evaluateCircuitDecision(uiCtx, scenario.moveClassifications.optimal)).toEqual(
          evaluateCircuitMove(coreCtx, scenario.moveClassifications.optimal),
        );
        for (const alt of scenario.moveClassifications.strong) {
          expect(evaluateCircuitDecision(uiCtx, alt)).toEqual(evaluateCircuitMove(coreCtx, alt));
        }
      } else {
        for (let i = 0; i < scenario.steps.length; i += 1) {
          const step = scenario.steps[i]!;
          const uiCtx = createActiveDecisionFromScenario(scenario, i);
          const coreCtx = createDecisionContextFromScenario(scenario, i);
          expect(evaluateCircuitDecision(uiCtx, step.moveClassifications.optimal)).toEqual(
            evaluateCircuitMove(coreCtx, step.moveClassifications.optimal),
          );
        }
      }
    }
  });
});

describe('circuitRunEngine', () => {
  it('starts a 12-gate run on certified content', () => {
    const run = startCircuitRun({ personalBest: 0, nowMs: 1_000 });
    expect(run.phase).toBe('deciding');
    expect(run.manifest).toHaveLength(12);
    expect(run.manifest[4]?.kind).toBe('checkpoint_hand');
  });

  it('rejects illegal placements without changing score, combo, strikes, or history', () => {
    let run = startCircuitRun({
      personalBest: 0,
      manifest: [{ kind: 'single_gate', scenarioId: 'circuit:certified:control-hold-left' }],
    });
    const before = {
      score: run.score,
      combo: run.combo,
      strikes: run.strikes,
      history: run.decisionHistory.length,
    };
    run = submitCircuitDecision(run, {
      tile: { low: 1, high: 4 },
      position: 'right',
    });
    expect(run.phase).toBe('deciding');
    expect(run.interactionNotice).toMatch(/does not match|cannot play/i);
    expect(run.score).toBe(before.score);
    expect(run.combo).toBe(before.combo);
    expect(run.strikes).toBe(before.strikes);
    expect(run.decisionHistory.length).toBe(before.history);
  });

  it('awards score for optimal play and advances gates with reveal board', () => {
    let run = startCircuitRun({ personalBest: 10 });
    const scenario = getCertifiedCircuitScenarioById(run.active!.scenarioId);
    expect(scenario?.kind).toBe('single_gate');
    if (scenario?.kind !== 'single_gate') throw new Error('expected single');
    run = submitCircuitDecision(run, scenario.moveClassifications.optimal);
    expect(run.phase).toBe('feedback');
    expect(run.lastOutcome?.grade).toBe('optimal');
    expect(run.lastOutcome?.resultingBoard).toBeTruthy();
    expect(run.score).toBeGreaterThan(0);
    run = continueAfterCircuitFeedback(run);
    expect(run.gateIndex).toBe(1);
  });

  it('ends after three strike-worthy legal mistakes', () => {
    let run = startCircuitRun({
      personalBest: 0,
      manifest: [
        { kind: 'single_gate', scenarioId: 'circuit:certified:control-hold-left' },
        { kind: 'single_gate', scenarioId: 'circuit:certified:control-preserve-pressure' },
        { kind: 'single_gate', scenarioId: 'circuit:certified:blocking-seal-right' },
        { kind: 'single_gate', scenarioId: 'circuit:certified:risk-avoid-bleed' },
      ],
    });

    const mistakes = [
      { tile: { low: 3, high: 6 }, position: 'right' as const },
      { tile: { low: 3, high: 4 }, position: 'right' as const },
      { tile: { low: 1, high: 4 }, position: 'right' as const },
    ];

    for (const mistake of mistakes) {
      run = submitCircuitDecision(run, mistake);
      expect(run.lastOutcome?.strike).toBe(true);
      run = continueAfterCircuitFeedback(run);
    }

    expect(run.phase).toBe('results');
    expect(run.endReason).toBe('strikes');
    expect(deepestGateReached(run)).toBeGreaterThan(0);
    expect(circuitAccuracy(run)).toBe(0);
    const quality = circuitDecisionQuality(run);
    expect(quality.mistakes).toBe(3);
    expect(quality.blunders).toBeGreaterThan(0);
  });

  it('advances Pressure Gate steps without turn-forcing', () => {
    let run = startCircuitRun({ personalBest: 0 });
    while (run.gateIndex < 4 && run.phase !== 'results') {
      if (run.phase === 'deciding' && run.active) {
        run = submitCircuitDecision(run, run.active.optimalMove);
      }
      if (run.phase === 'feedback') run = continueAfterCircuitFeedback(run);
    }
    expect(run.active?.gateKind).toBe('pressure_gate');
    expect(run.active?.stepIndex).toBe(0);
    expect(run.pressureEntrancePending).toBe(true);
    expect(run.active?.pressureTitle).toBeTruthy();
    run = submitCircuitDecision(run, run.active!.optimalMove);
    run = continueAfterCircuitFeedback(run);
    expect(run.active?.stepIndex).toBe(1);
    expect(run.active?.transitionIn).toBeTruthy();
  });

  it('tracks perfect/sound metrics and PB delta', () => {
    let run = startCircuitRun({
      personalBest: 500,
      manifest: [
        { kind: 'single_gate', scenarioId: 'circuit:certified:scoring-take-five' },
        { kind: 'single_gate', scenarioId: 'circuit:certified:tempo-claim-six' },
      ],
    });
    const first = getCertifiedCircuitScenarioById('circuit:certified:scoring-take-five');
    const second = getCertifiedCircuitScenarioById('circuit:certified:tempo-claim-six');
    if (first?.kind !== 'single_gate' || second?.kind !== 'single_gate') throw new Error('bad');
    run = submitCircuitDecision(run, first.moveClassifications.optimal);
    run = continueAfterCircuitFeedback(run);
    run = submitCircuitDecision(run, second.moveClassifications.strong[0]!);
    run = continueAfterCircuitFeedback(run);
    expect(run.phase).toBe('results');
    const quality = circuitDecisionQuality(run);
    expect(quality.perfect).toBe(1);
    expect(quality.sound).toBe(2);
    expect(quality.perfectPct).toBe(50);
    expect(quality.soundPct).toBe(100);
    expect(personalBestDelta(run)).toBe(run.score - 500);
    expect(mostCostlyDecision(run)).toBeNull();
    expect(buildImprovementTarget(run).message.length).toBeGreaterThan(0);
    expect(CIRCUIT_CATEGORY_SAMPLE_MIN).toBe(2);
  });
});
