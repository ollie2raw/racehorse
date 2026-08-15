import { describe, expect, it } from 'vitest';
import {
  buildCircuitRunPlan,
  buildDefaultCircuitRunManifest,
  countDecisionsInDefaultRun,
  describeCircuitBankComposition,
  getCertifiedCircuitScenarios,
} from '../circuitBank';
import {
  createDecisionContextFromScenario,
  evaluateCircuitMove,
} from '../circuitEvaluate';
import { computeCircuitDecisionPoints } from '../circuitScoring';
import {
  buildCircuitGradingManifest,
  createCircuitPositionState,
  enumerateClassifiedLegalMoves,
  listLegalCircuitPlays,
  resolveGradeFromClassifications,
  validateCircuitScenario,
  validateCircuitScenarioBank,
} from '../circuitScenario';

describe('circuit certified bank', () => {
  it('validates the entire certified bank as one operation', () => {
    const scenarios = getCertifiedCircuitScenarios();
    const result = validateCircuitScenarioBank(scenarios);
    expect(result.ok).toBe(true);
    expect(scenarios.length).toBe(14);
  });

  it('documents composition clearly', () => {
    const composition = describeCircuitBankComposition();
    expect(composition).toMatchObject({
      topLevelScenarioRecords: 14,
      singleGateRecords: 12,
      checkpointHandRecords: 2,
      ordinaryGatesPerRun: 10,
      checkpointGatesPerRun: 2,
      gatesPerDefaultRun: 12,
      runOrder: 'deterministic_seeded_plan',
    });
    expect(composition.totalDecisionStates).toBe(12 + 3 + 3);
    expect(countDecisionsInDefaultRun()).toBe(10 + 3 + 3);
    const manifest = buildDefaultCircuitRunManifest();
    expect(manifest).toHaveLength(12);
    expect(manifest[4]?.kind).toBe('checkpoint_hand');
    expect(manifest[9]?.kind).toBe('checkpoint_hand');
  });

  it('grades every certified optimal and strong move via shared evaluator', () => {
    for (const scenario of getCertifiedCircuitScenarios()) {
      expect(validateCircuitScenario(scenario).ok).toBe(true);
      if (scenario.kind === 'single_gate') {
        const ctx = createDecisionContextFromScenario(scenario);
        const optimal = evaluateCircuitMove(ctx, scenario.moveClassifications.optimal);
        expect(optimal.kind).toBe('accepted');
        if (optimal.kind === 'accepted') {
          expect(optimal.grade).toBe('optimal');
          expect(optimal.strike).toBe(false);
          expect(optimal.resultingBoard).toBeTruthy();
        }
        for (const alt of scenario.moveClassifications.strong) {
          const strong = evaluateCircuitMove(ctx, alt);
          expect(strong.kind).toBe('accepted');
          if (strong.kind === 'accepted') expect(strong.grade).toBe('strong');
        }
      } else {
        expect(ctxPressure(scenario)).toBe(true);
        for (let i = 0; i < scenario.steps.length; i += 1) {
          const step = scenario.steps[i]!;
          const ctx = createDecisionContextFromScenario(scenario, i);
          expect(ctx.gateKind).toBe('pressure_gate');
          const optimal = evaluateCircuitMove(ctx, step.moveClassifications.optimal);
          expect(optimal.kind).toBe('accepted');
          if (optimal.kind === 'accepted') expect(optimal.grade).toBe('optimal');
        }
      }
    }
  });

  it('rejects illegal placements without accepting them', () => {
    const scenario = getCertifiedCircuitScenarios().find((s) => s.kind === 'single_gate');
    expect(scenario?.kind).toBe('single_gate');
    if (scenario?.kind !== 'single_gate') return;
    const ctx = createDecisionContextFromScenario(scenario);
    const illegal = {
      tile: scenario.moveClassifications.optimal.tile,
      position: (scenario.moveClassifications.optimal.position === 'left' ? 'right' : 'left') as
        | 'left'
        | 'right',
    };
    const legal = listLegalCircuitPlays(ctx.gameState);
    const isActuallyIllegal = !legal.some(
      (m) =>
        m.tile.low === illegal.tile.low &&
        m.tile.high === illegal.tile.high &&
        m.position === illegal.position,
    );
    if (!isActuallyIllegal) return;
    const result = evaluateCircuitMove(ctx, illegal);
    expect(result.kind).toBe('rejected');
  });

  it('validates every checkpoint step as an independent legal authored state', () => {
    for (const scenario of getCertifiedCircuitScenarios()) {
      if (scenario.kind !== 'checkpoint_hand') continue;
      expect(scenario.transitionModel).toBe('authored_linked_states');
      expect(scenario.pressureTitle.length).toBeGreaterThan(0);
      expect(scenario.entranceLine.length).toBeGreaterThan(0);
      for (const step of scenario.steps) {
        const state = createCircuitPositionState(step.position);
        expect(listLegalCircuitPlays(state).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('exhaustive certified-bank grading', () => {
  it('enumerates every legal move to exactly one grade across all decision states', () => {
    const scenarios = getCertifiedCircuitScenarios();
    const manifest = buildCircuitGradingManifest(scenarios);
    expect(manifest.length).toBe(18);

    for (const row of manifest) {
      expect(row.legalMoveCount).toBeGreaterThan(0);
      expect(row.grades).toHaveLength(row.legalMoveCount);
      const keys = new Set(row.grades.map((g) => g.moveKey));
      expect(keys.size).toBe(row.grades.length);
      expect(row.grades.filter((g) => g.grade === 'optimal')).toHaveLength(1);
      for (const gradeRow of row.grades) {
        expect(['optimal', 'strong', 'inaccurate', 'blunder']).toContain(gradeRow.grade);
      }
    }
  });

  it('never infers blunder from missing strong alternatives', () => {
    for (const scenario of getCertifiedCircuitScenarios()) {
      if (scenario.kind !== 'single_gate') continue;
      if (scenario.moveClassifications.strong.length > 0) continue;
      const state = createCircuitPositionState(scenario);
      const enumerated = enumerateClassifiedLegalMoves(state, scenario.moveClassifications);
      expect(enumerated.ok).toBe(true);
      if (!enumerated.ok) continue;
      for (const row of enumerated.rows) {
        if (row.grade === 'blunder') {
          expect(
            scenario.moveClassifications.blunder.some(
              (m) => `${m.tile.low}-${m.tile.high}@${m.position}` === row.moveKey,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it('resolveGradeFromClassifications is classification-only', () => {
    const classifications = {
      optimal: { tile: { low: 1, high: 4 }, position: 'left' as const },
      strong: [{ tile: { low: 3, high: 6 }, position: 'right' as const }],
      inaccurate: [{ tile: { low: 0, high: 1 }, position: 'left' as const }],
      blunder: [{ tile: { low: 2, high: 2 }, position: 'right' as const }],
    };
    expect(resolveGradeFromClassifications(classifications.optimal, classifications)).toBe('optimal');
    expect(resolveGradeFromClassifications(classifications.strong[0]!, classifications)).toBe('strong');
    expect(resolveGradeFromClassifications(classifications.inaccurate[0]!, classifications)).toBe(
      'inaccurate',
    );
    expect(resolveGradeFromClassifications(classifications.blunder[0]!, classifications)).toBe('blunder');
    expect(
      resolveGradeFromClassifications({ tile: { low: 5, high: 5 }, position: 'left' }, classifications),
    ).toBeNull();
  });
});

describe('circuit run-plan builder', () => {
  it('builds a deterministic default plan', () => {
    const a = buildCircuitRunPlan({ variant: 'default' });
    const b = buildCircuitRunPlan({ variant: 'default' });
    expect(a.gates).toEqual(b.gates);
    expect(a.gates).toHaveLength(12);
    expect(a.gates[4]?.kind).toBe('checkpoint_hand');
    expect(a.gates[9]?.kind).toBe('checkpoint_hand');
  });

  it('builds reproducible seeded variants', () => {
    const a = buildCircuitRunPlan({ seed: 'circuit:control-focus:v1', variant: 'control-focus' });
    const b = buildCircuitRunPlan({ seed: 'circuit:control-focus:v1', variant: 'control-focus' });
    expect(a.gates.map((g) => g.scenarioId)).toEqual(b.gates.map((g) => g.scenarioId));
    const scoring = buildCircuitRunPlan({ seed: 'circuit:scoring-focus:v1', variant: 'scoring-focus' });
    expect(scoring.gates).toHaveLength(12);
    expect(scoring.gates[4]?.kind).toBe('checkpoint_hand');
  });

  it('avoids immediate duplicate single-gate ids in default plan', () => {
    const plan = buildCircuitRunPlan({ variant: 'default' });
    const singles = plan.gates.filter((g) => g.kind === 'single_gate').map((g) => g.scenarioId);
    expect(new Set(singles).size).toBe(singles.length);
  });
});

describe('circuit scoring formula', () => {
  const cases: Array<{
    grade: 'optimal' | 'strong' | 'inaccurate' | 'blunder';
    difficulty: number;
    comboBefore: number;
    points: number;
    nextCombo: number;
  }> = [
    { grade: 'optimal', difficulty: 1, comboBefore: 0, points: 100, nextCombo: 1 },
    { grade: 'optimal', difficulty: 2, comboBefore: 1, points: 224, nextCombo: 2 },
    { grade: 'strong', difficulty: 3, comboBefore: 0, points: 210, nextCombo: 1 },
    { grade: 'inaccurate', difficulty: 4, comboBefore: 3, points: 109, nextCombo: 0 },
    { grade: 'blunder', difficulty: 5, comboBefore: 8, points: 0, nextCombo: 0 },
  ];

  it.each(cases)(
    '$grade d$difficulty combo$comboBefore → $points pts / combo $nextCombo',
    (row) => {
      expect(
        computeCircuitDecisionPoints({
          grade: row.grade,
          difficulty: row.difficulty,
          comboBefore: row.comboBefore,
        }),
      ).toEqual({ points: row.points, nextCombo: row.nextCombo });
    },
  );
});

function ctxPressure(scenario: { pressureTitle: string; entranceLine: string; stakesLine: string }): boolean {
  return Boolean(scenario.pressureTitle && scenario.entranceLine && scenario.stakesLine);
}
