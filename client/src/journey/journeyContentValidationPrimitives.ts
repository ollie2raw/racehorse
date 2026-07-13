import {
  CORE_JOURNEY_RULESET_ID,
  type JourneyContentDescriptor,
  type JourneyLessonDefinition,
} from './journeyContentContract.ts';
import type { JourneyChapterDefinition } from './journeyTypes.ts';

export type JourneyContentValidationContext = {
  canonicalNodeIds: ReadonlySet<string>;
  chapterByNodeId: ReadonlyMap<string, string>;
  knownContentIds: ReadonlySet<string>;
  premiumRuntimeHostContentIds?: ReadonlySet<string>;
};

const RUNTIME_KINDS = new Set([
  'briefing_acknowledgement', 'static_decision', 'interactive_board_decision',
  'bot_match', 'boss_match', 'lesson_sequence', 'external_navigation', 'unsupported',
]);
const COMPLETION_KINDS = new Set([
  'briefing_acknowledged', 'decision_correct', 'interactive_scenario_success',
  'bot_result', 'boss_result', 'lesson_controller_result', 'external_navigation', 'none',
]);
const SUPPORT_STATUSES = new Set(['supported', 'legacyFallback', 'placeholder', 'unsupported']);
const MIGRATION_CLASSES = new Set(['legacy', 'premium']);
const RULESET_KINDS = new Set(['core_journey', 'table_tradition']);
const STAGE_KINDS = new Set([
  'frame', 'board_demo', 'decision', 'guided_practice', 'independent_practice',
  'authored_scenario', 'mastery', 'review',
]);
const RETRY_KINDS = new Set(['same_scenario', 'fresh_variant', 'controller_defined']);
const FEEDBACK_KINDS = new Set(['outcome_bundle', 'controller_defined']);
const EVIDENCE_ROLES = new Set(['none', 'practice', 'proof', 'review']);
const FAILURE_POLICIES = new Set(['retry_required', 'allow_continue', 'finish_attempt']);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function idOf(value: unknown): string {
  return nonEmpty(value) ? value : 'unknown-content';
}

function validateFeedback(errors: string[], stageId: string, feedback: unknown): void {
  if (!feedback || typeof feedback !== 'object') {
    errors.push(`${stageId}: missing feedback reference`);
    return;
  }
  const ref = feedback as { kind?: unknown; id?: unknown };
  if (!FEEDBACK_KINDS.has(String(ref.kind))) errors.push(`${stageId}: unknown feedback reference kind`);
  if (!nonEmpty(ref.id)) errors.push(`${stageId}: feedback reference requires a non-empty ID`);
}

function validateRetry(errors: string[], stageId: string, retry: unknown, required: boolean): void {
  if (!retry) {
    if (required) errors.push(`${stageId}: retry policy is required`);
    return;
  }
  if (typeof retry !== 'object') {
    errors.push(`${stageId}: invalid retry policy`);
    return;
  }
  const value = retry as { kind?: unknown; variantSetId?: unknown };
  if (!RETRY_KINDS.has(String(value.kind))) errors.push(`${stageId}: unknown retry policy kind`);
  if (value.kind === 'fresh_variant' && !nonEmpty(value.variantSetId)) {
    errors.push(`${stageId}: fresh_variant retry requires a non-empty variant-set ID`);
  }
}

function validateStage(errors: string[], stage: unknown, stageIds: Set<string>): void {
  if (!stage || typeof stage !== 'object') {
    errors.push('future lesson has an invalid stage');
    return;
  }
  const value = stage as Record<string, unknown>;
  const stageId = idOf(value.id);
  if (!nonEmpty(value.id)) errors.push('future lesson stage is missing an ID');
  else if (stageIds.has(value.id)) errors.push(`future lesson has duplicate stage ID ${value.id}`);
  else stageIds.add(value.id);

  if (!STAGE_KINDS.has(String(value.kind))) {
    errors.push(`${stageId}: unsupported stage kind`);
    return;
  }
  if (!EVIDENCE_ROLES.has(String(value.evidenceRole))) errors.push(`${stageId}: missing or unknown evidence role`);
  if (value.kind === 'frame') {
    if (!nonEmpty(value.copyRef)) errors.push(`${stageId}: frame requires copyRef`);
    if (value.evidenceRole !== 'none') errors.push(`${stageId}: frame must use none evidence role`);
    if (value.retry !== undefined) errors.push(`${stageId}: non-interactive stage cannot declare retry policy`);
    if (value.failurePolicy !== undefined) errors.push(`${stageId}: non-interactive stage cannot declare failure policy`);
    validateRetry(errors, stageId, value.retry, false);
    return;
  }
  if (!nonEmpty(value.scenarioRef)) errors.push(`${stageId}: ${String(value.kind)} requires scenarioRef`);
  if (value.kind === 'board_demo') {
    if (value.evidenceRole !== 'none') errors.push(`${stageId}: board_demo must use none evidence role`);
    if (value.retry !== undefined) errors.push(`${stageId}: non-interactive stage cannot declare retry policy`);
    if (value.failurePolicy !== undefined) errors.push(`${stageId}: non-interactive stage cannot declare failure policy`);
    validateRetry(errors, stageId, value.retry, false);
    return;
  }
  if (!FAILURE_POLICIES.has(String(value.failurePolicy))) errors.push(`${stageId}: failure policy is required and must be known`);
  if (value.kind === 'independent_practice' && value.evidenceRole !== 'practice') errors.push(`${stageId}: independent practice must use practice evidence role`);
  if (value.kind === 'mastery' && value.evidenceRole !== 'proof') errors.push(`${stageId}: mastery must use proof evidence role`);
  if (value.kind === 'review' && value.evidenceRole !== 'review') errors.push(`${stageId}: review must use review evidence role`);
  if (value.kind !== 'review' && value.evidenceRole === 'review') errors.push(`${stageId}: review evidence role requires review stage`);
  if (value.evidenceRole === 'proof' && value.kind !== 'mastery') errors.push(`${stageId}: proof evidence role requires mastery stage`);
  validateFeedback(errors, stageId, value.feedbackRef);
  validateRetry(errors, stageId, value.retry, true);
}

export function createJourneyContentValidationContext(
  chapters: JourneyChapterDefinition[],
  knownContentIds: ReadonlySet<string>,
): JourneyContentValidationContext {
  const chapterByNodeId = new Map<string, string>();
  for (const chapter of chapters) {
    for (const node of chapter.nodes) chapterByNodeId.set(node.id, chapter.chapterId);
  }
  return {
    canonicalNodeIds: new Set(chapters.flatMap((chapter) => chapter.nodes.map((node) => node.id))),
    chapterByNodeId,
    knownContentIds,
  };
}

export function validateJourneyLessonDefinitionPrimitive(
  definition: JourneyLessonDefinition,
  context: JourneyContentValidationContext,
): string[] {
  const errors: string[] = [];
  const value = definition as unknown as Record<string, unknown>;
  const definitionId = idOf(value.id);
  const nodeId = idOf(value.nodeId);
  const chapterId = idOf(value.chapterId);

  if (!nonEmpty(value.id)) errors.push('future lesson missing content ID');
  if (!context.canonicalNodeIds.has(nodeId)) errors.push(`future lesson ${definitionId}: unknown node ID ${nodeId}`);
  if (!nonEmpty(value.chapterId)) errors.push(`future lesson ${definitionId}: missing chapter ID`);
  else if (context.chapterByNodeId.get(nodeId) !== chapterId) errors.push(`future lesson ${definitionId}: chapter mismatch for node ${nodeId}`);
  if (!nonEmpty(value.skillId)) errors.push(`future lesson ${definitionId}: missing skill ID`);
  if (!Number.isInteger(value.contentVersion) || Number(value.contentVersion) < 1) {
    errors.push(`future lesson ${definitionId}: contentVersion must be a positive integer`);
  }

  const ruleset = value.ruleset as { kind?: unknown; id?: unknown } | undefined;
  if (!ruleset || !RULESET_KINDS.has(String(ruleset.kind))) {
    errors.push(`future lesson ${definitionId}: unknown ruleset kind`);
  } else if (ruleset.kind === 'core_journey' && ruleset.id !== CORE_JOURNEY_RULESET_ID) {
    errors.push(`future lesson ${definitionId}: invalid Core Journey ruleset ID`);
  } else if (ruleset.kind === 'table_tradition' && !nonEmpty(ruleset.id)) {
    errors.push(`future lesson ${definitionId}: Table Tradition ruleset requires an ID`);
  }

  const prerequisites = Array.isArray(value.prerequisites) ? value.prerequisites : [];
  const prerequisiteIds = new Set<string>();
  for (const prerequisite of prerequisites) {
    const prerequisiteId = String(prerequisite);
    if (!context.knownContentIds.has(prerequisiteId)) errors.push(`future lesson ${definitionId}: unknown prerequisite content ID ${prerequisiteId}`);
    if (prerequisiteId === definitionId) errors.push(`future lesson ${definitionId}: cannot prerequisite itself`);
    if (prerequisiteIds.has(prerequisiteId)) errors.push(`future lesson ${definitionId}: duplicate prerequisite ${prerequisiteId}`);
    prerequisiteIds.add(prerequisiteId);
  }

  const stages = Array.isArray(value.stages) ? value.stages : [];
  if (stages.length === 0) errors.push(`future lesson ${definitionId}: must have at least one stage`);
  const stageIds = new Set<string>();
  for (const stage of stages) validateStage(errors, stage, stageIds);

  const completion = value.completion as Record<string, unknown> | undefined;
  if (!completion || (completion.kind !== 'required_stages' && completion.kind !== 'scorecard')) {
    errors.push(`future lesson ${definitionId}: unknown completion rule`);
  } else {
    const completionIds: unknown[] = completion.kind === 'required_stages'
      ? (Array.isArray(completion.stageIds) ? completion.stageIds : [])
      : [
          ...(Array.isArray(completion.requiredStageIds) ? completion.requiredStageIds : []),
          ...(Array.isArray(completion.keyDecisionIds) ? completion.keyDecisionIds : []),
        ];
    if (completionIds.length === 0) errors.push(`future lesson ${definitionId}: completion needs stages`);
    for (const stageId of completionIds) {
      if (!stageIds.has(String(stageId))) errors.push(`future lesson ${definitionId}: completion references unknown stage ${String(stageId)}`);
    }
    if (completion.kind === 'scorecard' && !nonEmpty(completion.aggregateThresholdRef)) {
      errors.push(`future lesson ${definitionId}: scorecard requires aggregateThresholdRef`);
    }
    if (completion.kind === 'scorecard') {
      const failurePolicy = completion.failurePolicy as { kind?: unknown; stageId?: unknown } | undefined;
      if (!failurePolicy || (failurePolicy.kind !== 'end_session' && failurePolicy.kind !== 'retry_stage')) errors.push(`future lesson ${definitionId}: scorecard requires a valid failure policy`);
      const stagesById = new Map(stages.filter((stage): stage is Record<string, unknown> => Boolean(stage && typeof stage === 'object')).map((stage) => [String(stage.id), stage]));
      for (const stageId of Array.isArray(completion.keyDecisionIds) ? completion.keyDecisionIds : []) {
        const stage = stagesById.get(String(stageId));
        if (!stage || !['decision', 'guided_practice', 'independent_practice', 'authored_scenario', 'mastery', 'review'].includes(String(stage.kind))) errors.push(`future lesson ${definitionId}: scorecard key decision must reference an interactive stage ${String(stageId)}`);
      }
      if (failurePolicy?.kind === 'retry_stage') {
        const target = stagesById.get(String(failurePolicy.stageId));
        if (!target || !['decision', 'guided_practice', 'independent_practice', 'authored_scenario', 'mastery', 'review'].includes(String(target.kind))) errors.push(`future lesson ${definitionId}: scorecard retry target must be an interactive stage`);
      }
    }
    if (completion.owner !== 'journey_lesson_controller') errors.push(`future lesson ${definitionId}: completion must be controller-owned`);
  }
  return errors;
}

export function validateJourneyDescriptorSet(
  descriptors: ReadonlyArray<JourneyContentDescriptor>,
  premiumDefinitions: ReadonlyArray<JourneyLessonDefinition>,
  context: JourneyContentValidationContext,
): string[] {
  const errors: string[] = [];
  const descriptorsByNode = new Map<string, JourneyContentDescriptor>();
  const descriptorsByContent = new Map<string, JourneyContentDescriptor>();
  const definitionsByContent = new Map(premiumDefinitions.map((definition) => [String(definition.id), definition]));

  for (const descriptor of descriptors) {
    const value = descriptor as unknown as Record<string, unknown>;
    const nodeId = idOf(value.nodeId);
    const contentId = idOf(value.contentId);
    if (descriptorsByNode.has(nodeId)) errors.push(`${nodeId}: duplicate normalized descriptor`);
    descriptorsByNode.set(nodeId, descriptor);
    if (descriptorsByContent.has(contentId)) errors.push(`${nodeId}: duplicate active content ID ${contentId}`);
    descriptorsByContent.set(contentId, descriptor);
    if (!context.canonicalNodeIds.has(nodeId)) errors.push(`${nodeId}: descriptor references unknown node`);
    const chapterId = context.chapterByNodeId.get(nodeId);
    if (chapterId && descriptor.chapterId !== chapterId) errors.push(`${nodeId}: descriptor chapterId does not match canonical node`);
    if (descriptor.migrationClass === 'legacy' && String(descriptor.contentId) !== String(descriptor.nodeId)) errors.push(`${nodeId}: legacy contentId must equal nodeId`);
    validateDescriptorValues(errors, descriptor, context.premiumRuntimeHostContentIds ?? new Set());
  }

  for (const nodeId of context.canonicalNodeIds) if (!descriptorsByNode.has(nodeId)) errors.push(`${nodeId}: missing normalized descriptor`);

  const premiumDescriptorReferences = new Map<string, number>();
  for (const descriptor of descriptors) {
    if (descriptor.migrationClass !== 'premium') continue;
    const definition = definitionsByContent.get(String(descriptor.contentId));
    if (!definition) {
      errors.push(`${descriptor.nodeId}: premium descriptor references missing definition ${descriptor.contentId}`);
      continue;
    }
    premiumDescriptorReferences.set(String(definition.id), (premiumDescriptorReferences.get(String(definition.id)) ?? 0) + 1);
    if (String(definition.id) !== String(descriptor.contentId)) errors.push(`${descriptor.nodeId}: premium definition/content ID mismatch`);
    if (String(definition.nodeId) !== String(descriptor.nodeId)) errors.push(`${descriptor.nodeId}: premium definition/node ID mismatch`);
    if (definition.chapterId !== descriptor.chapterId) errors.push(`${descriptor.nodeId}: premium definition/chapter mismatch`);
    if (definition.contentVersion !== descriptor.lesson.contentVersion) errors.push(`${descriptor.nodeId}: premium content version mismatch`);
    if (descriptor.runtime.kind !== 'lesson_sequence' || descriptor.runtime.lessonId !== descriptor.contentId) errors.push(`${descriptor.nodeId}: premium lesson runtime ID mismatch`);
    const hostRegistered = context.premiumRuntimeHostContentIds?.has(String(descriptor.contentId)) ?? false;
    if (descriptor.supportStatus !== 'supported') errors.push(`${descriptor.nodeId}: premium runtime must have supported contract status`);
    if (hostRegistered && descriptor.runtimeAvailability !== 'available') errors.push(`${descriptor.nodeId}: registered premium host requires available runtime`);
    if (!hostRegistered && descriptor.runtimeAvailability !== 'unavailable') errors.push(`${descriptor.nodeId}: premium runtime cannot be available without a host registration`);
    if (descriptor.completion.kind !== 'lesson_controller_result') errors.push(`${descriptor.nodeId}: premium completion must be lesson-controller-owned`);
  }
  for (const definition of premiumDefinitions) {
    if ((premiumDescriptorReferences.get(String(definition.id)) ?? 0) !== 1) errors.push(`${definition.id}: premium definition must have exactly one active descriptor reference`);
  }
  return errors.sort((a, b) => a.localeCompare(b));
}

function validateDescriptorValues(errors: string[], descriptor: JourneyContentDescriptor, premiumRuntimeHostContentIds: ReadonlySet<string>): void {
  const value = descriptor as unknown as Record<string, unknown>;
  const id = idOf(value.nodeId ?? value.contentId);
  const runtime = value.runtime as Record<string, unknown> | undefined;
  const completion = value.completion as Record<string, unknown> | undefined;
  const runtimeKind = runtime?.kind;
  const completionKind = completion?.kind;
  if (!runtime || !RUNTIME_KINDS.has(String(runtimeKind))) errors.push(`${id}: unknown or missing runtime kind`);
  if (!completion || !COMPLETION_KINDS.has(String(completionKind))) errors.push(`${id}: unknown or missing completion kind`);
  if (!SUPPORT_STATUSES.has(String(value.supportStatus))) errors.push(`${id}: unknown or missing support status`);
  if (!MIGRATION_CLASSES.has(String(value.migrationClass))) errors.push(`${id}: unknown or missing migration class`);
  const ruleset = value.ruleset as Record<string, unknown> | undefined;
  if (!ruleset || !RULESET_KINDS.has(String(ruleset.kind))) errors.push(`${id}: unknown or missing ruleset kind`);
  if (value.runtimeAvailability !== 'available' && value.runtimeAvailability !== 'unavailable') errors.push(`${id}: unknown or missing runtime availability`);
  if (!runtime || !completion || !RUNTIME_KINDS.has(String(runtimeKind)) || !COMPLETION_KINDS.has(String(completionKind))) return;
  const pairs: Record<string, string> = {
    briefing_acknowledgement: 'briefing_acknowledged', static_decision: 'decision_correct',
    interactive_board_decision: 'interactive_scenario_success', bot_match: 'bot_result',
    boss_match: 'boss_result', lesson_sequence: 'lesson_controller_result',
    external_navigation: 'external_navigation', unsupported: 'none',
  };
  if (pairs[String(runtimeKind)] !== String(completionKind)) errors.push(`${id}: runtime ${String(runtimeKind)} is incompatible with completion ${String(completionKind)}`);
  const owners: Record<string, string> = {
    briefing_acknowledged: 'journey_ui', decision_correct: 'journey_ui', interactive_scenario_success: 'journey_ui',
    bot_result: 'journey_match_bridge', boss_result: 'journey_match_bridge', lesson_controller_result: 'journey_lesson_controller',
    external_navigation: 'external_route', none: 'none',
  };
  if (owners[String(completionKind)] !== String(completion.owner)) errors.push(`${id}: completion ${String(completionKind)} has incompatible owner`);
  if (runtimeKind === 'unsupported' && value.runtimeAvailability !== 'unavailable') errors.push(`${id}: unsupported runtime must be unavailable`);
  if (runtimeKind === 'lesson_sequence') {
    const hasHost = premiumRuntimeHostContentIds.has(String(value.contentId));
    if (value.runtimeAvailability === 'available' && !hasHost) errors.push(`${id}: lesson sequence is available without a registered host`);
    if (value.runtimeAvailability === 'unavailable' && hasHost) errors.push(`${id}: registered lesson host must expose an available runtime`);
  }
  if (value.supportStatus === 'unsupported' && (runtimeKind !== 'unsupported' || completionKind !== 'none')) errors.push(`${id}: unsupported content must use unsupported runtime and no completion authority`);
}
