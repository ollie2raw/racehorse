/**
 * Certified bank re-export from shared authority.
 * Client must not redefine scenario answers or validators.
 */
export {
  CIRCUIT_CERTIFIED_SCENARIOS,
  buildCircuitRunPlan,
  buildDefaultCircuitRunManifest,
  countDecisionsInDefaultRun,
  describeCircuitBankComposition,
  getCertifiedCircuitScenarioById,
  getCertifiedCircuitScenarios,
  type CircuitBankComposition,
  type CircuitRunManifestGate,
  type CircuitRunPlan,
} from '@racehorse/game-core';
