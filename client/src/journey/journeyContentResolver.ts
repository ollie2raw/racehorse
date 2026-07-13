import { getJourneyChapterById, getJourneyNodeById, JOURNEY_CHAPTER_DEFINITIONS } from './journeyChapters.ts';
import { getJourneyBriefing, getJourneyPuzzle } from './journeyContentIndex.ts';
import type { JourneyChapterDefinition, JourneyNode } from './journeyTypes.ts';
import {
  CORE_JOURNEY_RULESET_ID,
  type JourneyContentDescriptor,
  type JourneyContentDescriptorResolution,
  type JourneyContentId,
  type JourneyLessonDefinition,
  type JourneyNodeId,
  type JourneyRuntimeCapability,
  getRequestedCapability,
} from './journeyContentContract.ts';
import {
  createJourneyContentValidationContext,
  validateJourneyDescriptorSet,
  validateJourneyLessonDefinitionPrimitive,
} from './journeyContentValidationPrimitives.ts';
import { hasJourneyPremiumRuntimeHost } from './journeyPremiumRuntimeRegistry.ts';
import { OPEN_END_DISCIPLINE_LESSON_DEFINITION } from './lessons/openEndDiscipline/openEndDisciplineLesson.ts';
import { validateOpenEndDisciplineContent } from './lessons/openEndDiscipline/openEndDisciplineValidation.ts';
import { COUNTING_WHATS_LEFT_LESSON_DEFINITION } from './lessons/countingWhatsLeft/countingWhatsLeftLesson.ts';
import { validateCountingWhatsLeftContent } from './lessons/countingWhatsLeft/countingWhatsLeftValidation.ts';
import { DOUBLES_ARENT_FREE_LESSON_DEFINITION } from './lessons/doublesArentFree/doublesArentFreeLesson.ts';
import { validateDoublesArentFreeContent } from './lessons/doublesArentFree/doublesArentFreeValidation.ts';

export type JourneyContentRegistryBuildInput = {
  canonicalChapters: JourneyChapterDefinition[];
  premiumLessonDefinitions?: JourneyLessonDefinition[];
};

export type JourneyContentRegistry = {
  descriptors: ReadonlyArray<JourneyContentDescriptor>;
  premiumDefinitions: ReadonlyArray<JourneyLessonDefinition>;
  descriptorByNodeId: ReadonlyMap<JourneyNodeId, JourneyContentDescriptor>;
  premiumDefinitionByContentId: ReadonlyMap<JourneyContentId, JourneyLessonDefinition>;
};

const asNodeId = (value: string) => value as JourneyNodeId;
const asContentId = (value: string) => value as JourneyContentId;

function botRuntime(node: JourneyNode): Extract<JourneyRuntimeCapability, { kind: 'bot_match' | 'boss_match' }> | null {
  if (node.action.kind !== 'botMatch') return null;
  const winningScore = node.action.winningScore ?? 60;
  return {
    kind: node.nodeType === 'boss' ? 'boss_match' : 'bot_match',
    fritzTier: node.action.fritzTier,
    dealSize: node.action.dealSize,
    trialFormat: node.action.trialFormat ?? (winningScore < 60 ? 'shortRace' : 'fullMatch'),
    winningScore,
  };
}

function descriptorForLegacyNode(node: JourneyNode): Extract<JourneyContentDescriptor, { migrationClass: 'legacy' }> {
  const briefing = getJourneyBriefing(node.id);
  const puzzle = getJourneyPuzzle(node.id);
  const actionKind = node.action.kind;
  const requestedCapability = getRequestedCapability(node.action);
  let actualCapability: JourneyRuntimeCapability['kind'] = 'unsupported';
  let supportStatus: Extract<JourneyContentDescriptor, { migrationClass: 'legacy' }>['supportStatus'] = 'unsupported';
  let runtime: JourneyRuntimeCapability = { kind: 'unsupported', reason: 'No Journey runtime is defined for this node.' };
  let completion: Extract<JourneyContentDescriptor, { migrationClass: 'legacy' }>['completion'] = {
    kind: 'none', owner: 'none', reason: 'No executable completion authority is defined for this node.',
  };
  let fallback: Extract<JourneyContentDescriptor, { migrationClass: 'legacy' }>['legacy']['fallback'] = null;

  if (actionKind === 'placeholder' && briefing) {
    supportStatus = 'placeholder';
    actualCapability = 'briefing_acknowledgement';
    runtime = { kind: 'briefing_acknowledgement', briefingId: node.id };
    completion = { kind: 'briefing_acknowledged', owner: 'journey_ui' };
  } else if (actionKind === 'lesson' && briefing) {
    supportStatus = 'legacyFallback';
    actualCapability = 'briefing_acknowledgement';
    runtime = { kind: 'briefing_acknowledgement', briefingId: node.id };
    completion = { kind: 'briefing_acknowledged', owner: 'journey_ui' };
    fallback = {
      requestedCapability,
      actualCapability,
      reason: 'Current legacy lesson action has no lesson controller.',
    };
  } else if (actionKind === 'puzzle' && puzzle && node.nodeType === 'puzzle') {
    supportStatus = 'supported';
    actualCapability = puzzle.boardState ? 'interactive_board_decision' : 'static_decision';
    runtime = puzzle.boardState
      ? { kind: 'interactive_board_decision', puzzleId: puzzle.nodeId }
      : { kind: 'static_decision', puzzleId: puzzle.nodeId };
    completion = puzzle.boardState
      ? { kind: 'interactive_scenario_success', owner: 'journey_ui', puzzleId: puzzle.nodeId }
      : { kind: 'decision_correct', owner: 'journey_ui', puzzleId: puzzle.nodeId };
  } else if ((node.nodeType === 'match' || node.nodeType === 'boss') && actionKind === 'botMatch') {
    const bot = botRuntime(node);
    if (bot) {
      supportStatus = 'supported';
      actualCapability = bot.kind;
      runtime = bot;
      completion = bot.kind === 'boss_match'
        ? { kind: 'boss_result', owner: 'journey_match_bridge', requiredResult: 'win' }
        : { kind: 'bot_result', owner: 'journey_match_bridge', requiredResult: 'win' };
    }
  } else if (actionKind === 'navigate') {
    supportStatus = 'supported';
    actualCapability = 'external_navigation';
    runtime = { kind: 'external_navigation', mode: node.action.mode, params: node.action.params };
    completion = { kind: 'external_navigation', owner: 'external_route', completion: 'none' };
  }

  if (supportStatus === 'unsupported') {
    actualCapability = 'unsupported';
    runtime = { kind: 'unsupported', reason: `Action ${actionKind} has no supported Journey execution.` };
  }

  return {
    migrationClass: 'legacy',
    contentId: asContentId(node.id),
    nodeId: asNodeId(node.id),
    chapterId: node.chapterId,
    nodeType: node.nodeType,
    title: node.title,
    ruleset: { kind: 'core_journey', id: CORE_JOURNEY_RULESET_ID },
    supportStatus,
    runtimeAvailability: runtime.kind === 'unsupported' ? 'unavailable' : 'available',
    runtime,
    completion,
    presentation: { tableContextId: null, rivalContextId: null },
    legacy: {
      actionKind,
      requestedCapability,
      actualCapability,
      fallback,
      requirements: [...node.requirements],
      completionCriteria: node.completionCriteria,
      rewardText: node.rewardText,
      briefingId: briefing ? node.id : null,
      puzzleId: actionKind === 'puzzle' ? node.action.puzzleId : null,
    },
  };
}

function validatePremiumTargets(
  chapters: JourneyChapterDefinition[],
  definitions: JourneyLessonDefinition[],
): string[] {
  const errors: string[] = [];
  const nodes = chapters.flatMap((chapter) => chapter.nodes);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const targetCounts = new Map<string, number>();
  const contentCounts = new Map<string, number>();
  const replacedNodeIds = new Set(definitions.map((definition) => String(definition.nodeId)));
  const untouchedLegacyIds = new Set(nodes.filter((node) => !replacedNodeIds.has(node.id)).map((node) => node.id));
  for (const definition of definitions) {
    targetCounts.set(String(definition.nodeId), (targetCounts.get(String(definition.nodeId)) ?? 0) + 1);
    contentCounts.set(String(definition.id), (contentCounts.get(String(definition.id)) ?? 0) + 1);
    const node = nodeById.get(String(definition.nodeId));
    if (!node) errors.push(`Premium lesson ${definition.id} targets unknown node ${definition.nodeId}.`);
    if (node && definition.chapterId !== node.chapterId) {
      errors.push(`Premium lesson ${definition.id} chapter ${definition.chapterId} does not match node ${definition.nodeId}.`);
    }
    if (untouchedLegacyIds.has(String(definition.id))) errors.push(`Premium content ID ${definition.id} collides with untouched legacy content.`);
  }
  for (const [nodeId, count] of targetCounts) {
    if (count > 1) errors.push(`Multiple premium lessons target node ${nodeId}.`);
  }
  for (const [contentId, count] of contentCounts) {
    if (count > 1) errors.push(`Duplicate premium content ID ${contentId}.`);
  }
  return errors;
}

function descriptorForPremiumLesson(
  definition: JourneyLessonDefinition,
  node: JourneyNode,
): Extract<JourneyContentDescriptor, { migrationClass: 'premium' }> {
  return {
    migrationClass: 'premium',
    contentId: definition.id,
    nodeId: definition.nodeId,
    chapterId: definition.chapterId,
    nodeType: node.nodeType,
    title: node.title,
    ruleset: definition.ruleset,
    supportStatus: 'supported',
    runtimeAvailability: hasJourneyPremiumRuntimeHost(String(definition.id)) ? 'available' : 'unavailable',
    runtime: { kind: 'lesson_sequence', lessonId: definition.id },
    completion: { kind: 'lesson_controller_result', owner: 'journey_lesson_controller' },
    presentation: definition.presentation ?? { tableContextId: null, rivalContextId: null },
    lesson: { definitionId: definition.id, contentVersion: definition.contentVersion },
  };
}

export function buildJourneyContentRegistry(input: JourneyContentRegistryBuildInput): JourneyContentRegistry {
  const premiumDefinitions = input.premiumLessonDefinitions ?? [];
  const errors = validatePremiumTargets(input.canonicalChapters, premiumDefinitions);
  const replacedNodeIds = new Set(premiumDefinitions.map((definition) => String(definition.nodeId)));
  const legacyIds = input.canonicalChapters.flatMap((chapter) => chapter.nodes)
    .filter((node) => !replacedNodeIds.has(node.id))
    .map((node) => node.id);
  const finalContentIds = new Set<string>([...legacyIds, ...premiumDefinitions.map((definition) => String(definition.id))]);
  const validationContext = createJourneyContentValidationContext(input.canonicalChapters, finalContentIds);
  for (const definition of premiumDefinitions) {
    errors.push(...validateJourneyLessonDefinitionPrimitive(definition, validationContext));
    if (definition.id === OPEN_END_DISCIPLINE_LESSON_DEFINITION.id) {
      errors.push(...validateOpenEndDisciplineContent(definition));
    }
    if (definition.id === COUNTING_WHATS_LEFT_LESSON_DEFINITION.id) errors.push(...validateCountingWhatsLeftContent(definition));
    if (definition.id === DOUBLES_ARENT_FREE_LESSON_DEFINITION.id) errors.push(...validateDoublesArentFreeContent(definition));
  }
  if (errors.length > 0) throw new Error(['Invalid Journey content registry:', ...[...new Set(errors)].sort()].join('\n'));
  const premiumByNode = new Map(premiumDefinitions.map((definition) => [String(definition.nodeId), definition]));
  const descriptors = input.canonicalChapters
    .flatMap((chapter) => chapter.nodes)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((node) => {
      const premium = premiumByNode.get(node.id);
      return premium ? descriptorForPremiumLesson(premium, node) : descriptorForLegacyNode(node);
    });
  const descriptorErrors = validateJourneyDescriptorSet(descriptors, premiumDefinitions, {
    ...validationContext,
    premiumRuntimeHostContentIds: new Set(
      premiumDefinitions.filter((definition) => hasJourneyPremiumRuntimeHost(String(definition.id))).map((definition) => String(definition.id)),
    ),
  });
  if (descriptorErrors.length > 0) throw new Error(['Invalid Journey content registry:', ...descriptorErrors].join('\n'));
  const descriptorByNodeId = new Map(descriptors.map((descriptor) => [descriptor.nodeId, descriptor]));
  const premiumByContentId = new Map(premiumDefinitions.map((definition) => [String(definition.id), definition]));
  const orderedPremiumDefinitions = descriptors
    .filter((descriptor): descriptor is Extract<JourneyContentDescriptor, { migrationClass: 'premium' }> => descriptor.migrationClass === 'premium')
    .map((descriptor) => premiumByContentId.get(String(descriptor.contentId)))
    .filter((definition): definition is JourneyLessonDefinition => definition !== undefined);
  const premiumDefinitionByContentId = new Map(orderedPremiumDefinitions.map((definition) => [definition.id, definition]));
  return {
    descriptors: [...descriptors],
    premiumDefinitions: orderedPremiumDefinitions,
    descriptorByNodeId,
    premiumDefinitionByContentId,
  };
}

export const PRODUCTION_PREMIUM_LESSON_DEFINITIONS: JourneyLessonDefinition[] = [OPEN_END_DISCIPLINE_LESSON_DEFINITION, COUNTING_WHATS_LEFT_LESSON_DEFINITION, DOUBLES_ARENT_FREE_LESSON_DEFINITION];
export const PRODUCTION_JOURNEY_CONTENT_REGISTRY = buildJourneyContentRegistry({
  canonicalChapters: JOURNEY_CHAPTER_DEFINITIONS,
  premiumLessonDefinitions: PRODUCTION_PREMIUM_LESSON_DEFINITIONS,
});

const CONTENT_BY_NODE_ID = new Map(
  PRODUCTION_JOURNEY_CONTENT_REGISTRY.descriptors.map((descriptor) => [descriptor.nodeId, descriptor]),
);

export function resolveJourneyContent(nodeId: string): JourneyContentDescriptorResolution {
  const descriptor = CONTENT_BY_NODE_ID.get(nodeId as JourneyNodeId);
  return descriptor ? { kind: 'found', descriptor } : { kind: 'missing', nodeId };
}

export function getJourneyContentDescriptor(nodeId: string): JourneyContentDescriptor | null {
  return CONTENT_BY_NODE_ID.get(nodeId as JourneyNodeId) ?? null;
}

export function getAllJourneyContentDescriptors(): JourneyContentDescriptor[] {
  return [...PRODUCTION_JOURNEY_CONTENT_REGISTRY.descriptors];
}

export type JourneyLessonDefinitionResolution =
  | { kind: 'found'; definition: JourneyLessonDefinition }
  | { kind: 'missing'; contentId: string };

export function resolveJourneyLessonDefinition(contentId: string): JourneyLessonDefinitionResolution {
  const definition = PRODUCTION_JOURNEY_CONTENT_REGISTRY.premiumDefinitionByContentId.get(contentId as JourneyContentId);
  return definition ? { kind: 'found', definition } : { kind: 'missing', contentId };
}

export function getJourneyLessonDefinition(contentId: string): JourneyLessonDefinition | null {
  const result = resolveJourneyLessonDefinition(contentId);
  return result.kind === 'found' ? result.definition : null;
}

export function getAllJourneyLessonDefinitions(): JourneyLessonDefinition[] {
  return [...PRODUCTION_JOURNEY_CONTENT_REGISTRY.premiumDefinitions];
}

export function getJourneyLessonDefinitionFromRegistry(
  registry: JourneyContentRegistry,
  contentId: string,
): JourneyLessonDefinition | null {
  return registry.premiumDefinitionByContentId.get(contentId as JourneyContentId) ?? null;
}

export function getAllJourneyLessonDefinitionsFromRegistry(
  registry: JourneyContentRegistry,
): JourneyLessonDefinition[] {
  return [...registry.premiumDefinitions];
}

export function getCanonicalJourneyNodeIds(): string[] {
  return JOURNEY_CHAPTER_DEFINITIONS.flatMap((chapter) => chapter.nodes)
    .map((node) => node.id)
    .sort((a, b) => a.localeCompare(b));
}

export function getJourneyContentNode(nodeId: string): JourneyNode | null {
  return getJourneyNodeById(nodeId);
}

export function getJourneyContentChapter(chapterId: string) {
  return getJourneyChapterById(chapterId);
}
