/**
 * Canonical certified Circuit bank + composition helpers.
 * Static data may be bundled; schema/validation/grading remain shared.
 */

import type { CircuitScenario, CircuitStrategyCategory } from './circuitScenario';
import { validateCircuitScenarioBank } from './circuitScenario';
import certifiedSeed from './circuitCertifiedSeed.json';
import { buildDefaultCircuitRunManifest } from './circuitRunPlan';

export const CIRCUIT_CERTIFIED_SCENARIOS = certifiedSeed as unknown as CircuitScenario[];

const bankValidation = validateCircuitScenarioBank(CIRCUIT_CERTIFIED_SCENARIOS);
if (!bankValidation.ok) {
  const details = bankValidation.results
    .filter((r) => !r.ok)
    .map((r) => `${r.scenarioId}: ${('issues' in r ? r.issues : []).map((i) => i.message).join('; ')}`)
    .join(' | ');
  throw new Error(`[Circuit] Certified seed bank failed validation: ${details}`);
}

export function getCertifiedCircuitScenarios(): readonly CircuitScenario[] {
  return CIRCUIT_CERTIFIED_SCENARIOS;
}

export function getCertifiedCircuitScenarioById(id: string): CircuitScenario | null {
  return CIRCUIT_CERTIFIED_SCENARIOS.find((s) => s.id === id) ?? null;
}

export type { CircuitRunManifestGate } from './circuitRunPlan';
export { buildDefaultCircuitRunManifest, buildCircuitRunPlan } from './circuitRunPlan';

export type CircuitBankComposition = {
  readonly topLevelScenarioRecords: number;
  readonly singleGateRecords: number;
  readonly checkpointHandRecords: number;
  readonly totalDecisionStates: number;
  readonly ordinaryGatesPerRun: number;
  readonly checkpointGatesPerRun: number;
  readonly decisionsPerCheckpoint: Readonly<Record<string, number>>;
  readonly categoryDistribution: Readonly<Record<CircuitStrategyCategory, number>>;
  readonly difficultyDistribution: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
  readonly runOrder: 'deterministic_seeded_plan';
  readonly gatesPerDefaultRun: number;
};

export function describeCircuitBankComposition(
  scenarios: readonly CircuitScenario[] = CIRCUIT_CERTIFIED_SCENARIOS,
): CircuitBankComposition {
  const singles = scenarios.filter((s) => s.kind === 'single_gate');
  const checkpoints = scenarios.filter((s) => s.kind === 'checkpoint_hand');
  const decisionsPerCheckpoint: Record<string, number> = {};
  let totalDecisionStates = singles.length;
  for (const cp of checkpoints) {
    if (cp.kind !== 'checkpoint_hand') continue;
    decisionsPerCheckpoint[cp.id] = cp.steps.length;
    totalDecisionStates += cp.steps.length;
  }

  const categoryDistribution = {
    scoring: 0,
    board_control: 0,
    blocking: 0,
    counting: 0,
    opening: 0,
    endgame: 0,
    tempo: 0,
    risk_management: 0,
  } as Record<CircuitStrategyCategory, number>;
  const difficultyDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;

  for (const s of scenarios) {
    difficultyDistribution[s.difficulty] += 1;
    for (const cat of s.categories) categoryDistribution[cat] += 1;
  }

  return {
    topLevelScenarioRecords: scenarios.length,
    singleGateRecords: singles.length,
    checkpointHandRecords: checkpoints.length,
    totalDecisionStates,
    ordinaryGatesPerRun: 10,
    checkpointGatesPerRun: 2,
    decisionsPerCheckpoint,
    categoryDistribution,
    difficultyDistribution,
    runOrder: 'deterministic_seeded_plan',
    gatesPerDefaultRun: 12,
  };
}

export function countDecisionsInDefaultRun(
  scenarios: readonly CircuitScenario[] = CIRCUIT_CERTIFIED_SCENARIOS,
): number {
  const manifest = buildDefaultCircuitRunManifest(scenarios);
  let total = 0;
  for (const gate of manifest) {
    const scenario = scenarios.find((s) => s.id === gate.scenarioId);
    if (!scenario) continue;
    total += scenario.kind === 'checkpoint_hand' ? scenario.steps.length : 1;
  }
  return total;
}
