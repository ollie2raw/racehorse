import { OPEN_END_DISCIPLINE_VARIANT_SET_ID, OPEN_END_DISCIPLINE_SCENARIOS, type OpenEndDisciplineScenario } from './openEndDisciplineScenarios.ts';

export type OpenEndDisciplineVariantResolution =
  | { kind: 'resolved'; scenario: OpenEndDisciplineScenario }
  | { kind: 'exhausted'; variantSetId: string };

export function resolveOpenEndDisciplineVariant({ variantSetId, previouslyUsedScenarioIds }: { variantSetId: string; previouslyUsedScenarioIds: string[] }): OpenEndDisciplineVariantResolution {
  const candidates = OPEN_END_DISCIPLINE_SCENARIOS
    .filter((scenario) => scenario.variantSetId === variantSetId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const next = candidates.find((scenario) => !previouslyUsedScenarioIds.includes(scenario.id));
  return next ? { kind: 'resolved', scenario: next } : { kind: 'exhausted', variantSetId };
}

export function validateOpenEndDisciplineVariantSet(variantSetId: string): string[] {
  if (variantSetId !== OPEN_END_DISCIPLINE_VARIANT_SET_ID) return [`Unknown Open-End Discipline variant set ${variantSetId}.`];
  const scenarios = OPEN_END_DISCIPLINE_SCENARIOS.filter((scenario) => scenario.variantSetId === variantSetId);
  return new Set(scenarios.map((scenario) => scenario.id)).size >= 3 ? [] : [`Variant set ${variantSetId} needs at least three scenarios.`];
}
