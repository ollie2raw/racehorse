import type { FritzTier } from '../bot/fritzConfig.ts';
import {
  getAllJourneyBriefingEntries,
  getAllJourneyPuzzleEntries,
  hasJourneyBriefing,
  hasJourneyPuzzle,
} from './journeyContentIndex.ts';
import { JOURNEY_CHAPTER_DEFINITIONS } from './journeyChapters.ts';
import {
  CORE_JOURNEY_RULESET_ID,
  type JourneyContentDescriptor,
  type JourneyLessonDefinition,
  type JourneyRuntimeCapability,
} from './journeyContentContract.ts';
import {
  getAllJourneyContentDescriptors,
  getAllJourneyLessonDefinitions,
  getCanonicalJourneyNodeIds,
} from './journeyContentResolver.ts';
import {
  createJourneyContentValidationContext,
  validateJourneyDescriptorSet,
} from './journeyContentValidationPrimitives.ts';
import type { JourneyChapterDefinition, JourneyNode, JourneyNodeType } from './journeyTypes.ts';
import { getJourneyPremiumHostRegistration } from './journeyPremiumRuntimeRegistry.ts';

const VALID_NODE_TYPES: JourneyNodeType[] = ['checkpoint', 'match', 'puzzle', 'boss'];
const VALID_FRITZ_TIERS: FritzTier[] = ['rookie', 'standard', 'elite', 'master'];
const VALID_DEAL_SIZES = new Set([7, 14]);
const VALID_WINNING_SCORES = new Set([25, 30, 35, 40, 45, 50, 60]);
const VALID_TRIAL_FORMATS = new Set(['fullMatch', 'shortRace'] as const);

const FORBIDDEN_COPY_PATTERNS: { pattern: RegExp; message: string }[] = [
  { pattern: /\bJourney Complete\b/i, message: 'must not say "Journey Complete"' },
  { pattern: /\bfinal boss of Racehorse Journey\b/i, message: 'must not claim final Journey boss' },
  { pattern: /\bthe whole Journey is over\b/i, message: 'must not imply the whole Journey is over' },
  { pattern: /\btrail ends at Grandmaster\b/i, message: 'must not imply the trail ends at Grandmaster' },
  { pattern: /\bGrandmaster Fritz Trial\b/i, message: 'use "The First Grandmaster Trial" for Chapter 1 boss' },
];

export type JourneyContentValidationResult = {
  ok: boolean;
  errors: string[];
  summary: JourneyContentSummary;
};

export type JourneyChapterContentSummary = {
  chapterId: string;
  chapterNumber: number;
  title: string;
  releaseStatus: JourneyChapterDefinition['releaseStatus'];
  nodeCount: number;
  nodeTypes: Record<JourneyNodeType, number>;
};

const VALID_PUZZLE_CHOICE_IDS = ['a', 'b', 'c', 'd'] as const;
const PUZZLE_ANSWER_BIAS_MAX_RATIO = 0.4;

export type JourneyPuzzleAnswerDistribution = Record<(typeof VALID_PUZZLE_CHOICE_IDS)[number], number>;

export type JourneyChapterAnswerDistributionSummary = {
  chapterId: string;
  chapterNumber: number;
  puzzleCount: number;
  distribution: JourneyPuzzleAnswerDistribution;
};

export type JourneyContentSummary = {
  chapterCount: number;
  playableChapterCount: number;
  totalNodeCount: number;
  chapters: JourneyChapterContentSummary[];
  trials: {
    fullMatchCount: number;
    shortRaceCount: number;
    bossFullMatchCount: number;
    byChapter: Array<{
      chapterId: string;
      chapterNumber: number;
      fullMatchCount: number;
      shortRaceCount: number;
      bossFullMatchCount: number;
    }>;
  };
  puzzleAnswerDistribution: {
    totalPuzzles: number;
    global: JourneyPuzzleAnswerDistribution;
    byChapter: JourneyChapterAnswerDistributionSummary[];
  };
  normalizedContent: {
    supported: number;
    legacyFallback: number;
    placeholder: number;
    unsupported: number;
    coreJourneyRuleset: number;
    capabilities: Record<JourneyRuntimeCapability['kind'], number>;
  };
};

function countNodeTypes(nodes: JourneyNode[]): Record<JourneyNodeType, number> {
  const counts: Record<JourneyNodeType, number> = {
    checkpoint: 0,
    match: 0,
    puzzle: 0,
    boss: 0,
  };
  for (const node of nodes) {
    counts[node.nodeType] += 1;
  }
  return counts;
}

function emptyAnswerDistribution(): JourneyPuzzleAnswerDistribution {
  return { a: 0, b: 0, c: 0, d: 0 };
}

function findChapterForNodeId(nodeId: string): JourneyChapterDefinition | undefined {
  return JOURNEY_CHAPTER_DEFINITIONS.find((chapter) => chapter.nodes.some((node) => node.id === nodeId));
}

function recordAnswerDistribution(
  distribution: JourneyPuzzleAnswerDistribution,
  choiceId: string,
): void {
  if (choiceId === 'a' || choiceId === 'b' || choiceId === 'c' || choiceId === 'd') {
    distribution[choiceId] += 1;
  }
}

function formatAnswerDistribution(distribution: JourneyPuzzleAnswerDistribution): string {
  return VALID_PUZZLE_CHOICE_IDS.map((letter) => `${letter}=${distribution[letter]}`).join(', ');
}

function summarizePuzzleAnswerDistribution(): JourneyContentSummary['puzzleAnswerDistribution'] {
  const global = emptyAnswerDistribution();
  const byChapterId = new Map<string, JourneyChapterAnswerDistributionSummary>();

  for (const [nodeId, puzzle] of getAllJourneyPuzzleEntries()) {
    recordAnswerDistribution(global, puzzle.correctChoiceId);
    const chapter = findChapterForNodeId(nodeId);
    if (!chapter) continue;

    const existing = byChapterId.get(chapter.chapterId) ?? {
      chapterId: chapter.chapterId,
      chapterNumber: chapter.chapterNumber,
      puzzleCount: 0,
      distribution: emptyAnswerDistribution(),
    };
    existing.puzzleCount += 1;
    recordAnswerDistribution(existing.distribution, puzzle.correctChoiceId);
    byChapterId.set(chapter.chapterId, existing);
  }

  const totalPuzzles = getAllJourneyPuzzleEntries().length;

  return {
    totalPuzzles,
    global,
    byChapter: [...byChapterId.values()].sort((a, b) => a.chapterNumber - b.chapterNumber),
  };
}

function summarizeJourneyTrials(): JourneyContentSummary['trials'] {
  const byChapter = JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => ({
    chapterId: chapter.chapterId,
    chapterNumber: chapter.chapterNumber,
    fullMatchCount: 0,
    shortRaceCount: 0,
    bossFullMatchCount: 0,
  }));

  for (const chapterSummary of byChapter) {
    const chapter = JOURNEY_CHAPTER_DEFINITIONS.find((entry) => entry.chapterId === chapterSummary.chapterId);
    if (!chapter) continue;
    for (const node of chapter.nodes) {
      if ((node.nodeType !== 'match' && node.nodeType !== 'boss') || node.action.kind !== 'botMatch') continue;
      const trialFormat =
        node.action.trialFormat ?? ((node.action.winningScore ?? 60) < 60 ? 'shortRace' : 'fullMatch');
      if (trialFormat === 'shortRace') {
        chapterSummary.shortRaceCount += 1;
        continue;
      }
      chapterSummary.fullMatchCount += 1;
      if (node.nodeType === 'boss') {
        chapterSummary.bossFullMatchCount += 1;
      }
    }
  }

  return {
    fullMatchCount: byChapter.reduce((sum, chapter) => sum + chapter.fullMatchCount, 0),
    shortRaceCount: byChapter.reduce((sum, chapter) => sum + chapter.shortRaceCount, 0),
    bossFullMatchCount: byChapter.reduce((sum, chapter) => sum + chapter.bossFullMatchCount, 0),
    byChapter,
  };
}

export function summarizeJourneyContent(): JourneyContentSummary {
  const chapters: JourneyChapterContentSummary[] = JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => ({
    chapterId: chapter.chapterId,
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    releaseStatus: chapter.releaseStatus,
    nodeCount: chapter.nodes.length,
    nodeTypes: countNodeTypes(chapter.nodes),
  }));

  const descriptors = getAllJourneyContentDescriptors();
  const capabilities = descriptors.reduce<Record<JourneyRuntimeCapability['kind'], number>>((counts, descriptor) => {
    counts[descriptor.runtime.kind] = (counts[descriptor.runtime.kind] ?? 0) + 1;
    return counts;
  }, {} as Record<JourneyRuntimeCapability['kind'], number>);

  return {
    chapterCount: chapters.length,
    playableChapterCount: chapters.filter((chapter) => chapter.releaseStatus === 'playable').length,
    totalNodeCount: chapters.reduce((count, chapter) => count + chapter.nodeCount, 0),
    chapters,
    trials: summarizeJourneyTrials(),
    puzzleAnswerDistribution: summarizePuzzleAnswerDistribution(),
    normalizedContent: {
      supported: descriptors.filter((descriptor) => descriptor.supportStatus === 'supported').length,
      legacyFallback: descriptors.filter((descriptor) => descriptor.supportStatus === 'legacyFallback').length,
      placeholder: descriptors.filter((descriptor) => descriptor.supportStatus === 'placeholder').length,
      unsupported: descriptors.filter((descriptor) => descriptor.supportStatus === 'unsupported').length,
      coreJourneyRuleset: descriptors.filter((descriptor) => descriptor.ruleset.id === CORE_JOURNEY_RULESET_ID).length,
      capabilities,
    },
  };
}

function formatNodeTypeBreakdown(nodeTypes: Record<JourneyNodeType, number>): string {
  return (['checkpoint', 'puzzle', 'match', 'boss'] as JourneyNodeType[])
    .map((type) => `${type}=${nodeTypes[type]}`)
    .join(', ');
}

export function formatJourneyContentSummary(summary: JourneyContentSummary): string {
  const lines = [
    'Journey content summary',
    `- Chapters: ${summary.chapterCount} (${summary.playableChapterCount} playable)`,
    `- Total nodes: ${summary.totalNodeCount}`,
    '- Per chapter:',
  ];

  for (const chapter of summary.chapters) {
    lines.push(
      `  · Ch${chapter.chapterNumber} ${chapter.chapterId} (${chapter.releaseStatus}) — ${chapter.title}: ${chapter.nodeCount} nodes [${formatNodeTypeBreakdown(chapter.nodeTypes)}]`,
    );
  }

  lines.push(
    `- Trial formats: ${summary.trials.fullMatchCount} full matches, ${summary.trials.shortRaceCount} short races (${summary.trials.bossFullMatchCount} boss full matches)`,
  );
  lines.push('- Trial formats by chapter:');
  for (const chapter of summary.trials.byChapter) {
    lines.push(
      `  · Ch${chapter.chapterNumber} ${chapter.chapterId}: full=${chapter.fullMatchCount}, short=${chapter.shortRaceCount}, bossFull=${chapter.bossFullMatchCount}`,
    );
  }

  lines.push(
    `- Puzzle answer distribution (${summary.puzzleAnswerDistribution.totalPuzzles} puzzles): ${formatAnswerDistribution(summary.puzzleAnswerDistribution.global)}`,
  );
  lines.push(
    `- Normalized content: supported=${summary.normalizedContent.supported}, legacyFallback=${summary.normalizedContent.legacyFallback}, placeholder=${summary.normalizedContent.placeholder}, unsupported=${summary.normalizedContent.unsupported}`,
  );
  lines.push('- Puzzle answers by chapter:');
  for (const chapter of summary.puzzleAnswerDistribution.byChapter) {
    lines.push(
      `  · Ch${chapter.chapterNumber} ${chapter.chapterId}: ${chapter.puzzleCount} puzzles [${formatAnswerDistribution(chapter.distribution)}]`,
    );
  }

  return lines.join('\n');
}

export type JourneyContentValidationContext = {
  canonicalNodeIds: ReadonlySet<string>;
  chapterByNodeId: ReadonlyMap<string, string>;
  knownContentIds: ReadonlySet<string>;
};

function createDefaultValidationContext(): JourneyContentValidationContext {
  const chapterByNodeId = new Map<string, string>();
  for (const chapter of JOURNEY_CHAPTER_DEFINITIONS) {
    for (const node of chapter.nodes) chapterByNodeId.set(node.id, chapter.chapterId);
  }
  return {
    canonicalNodeIds: new Set(getCanonicalJourneyNodeIds()),
    chapterByNodeId,
    knownContentIds: new Set(getAllJourneyContentDescriptors().map((descriptor) => descriptor.contentId)),
  };
}

const VALID_RUNTIME_KINDS = new Set([
  'briefing_acknowledgement', 'static_decision', 'interactive_board_decision',
  'bot_match', 'boss_match', 'lesson_sequence', 'external_navigation', 'unsupported',
]);
const VALID_COMPLETION_KINDS = new Set([
  'briefing_acknowledged', 'decision_correct', 'interactive_scenario_success',
  'bot_result', 'boss_result', 'lesson_controller_result', 'external_navigation', 'none',
]);
const VALID_SUPPORT_STATUSES = new Set(['supported', 'legacyFallback', 'placeholder', 'unsupported']);
const VALID_MIGRATION_CLASSES = new Set(['legacy', 'premium']);
const VALID_RULESET_KINDS = new Set(['core_journey', 'table_tradition']);
const VALID_STAGE_KINDS = new Set([
  'frame', 'board_demo', 'decision', 'guided_practice', 'independent_practice',
  'authored_scenario', 'mastery', 'review',
]);
const VALID_RETRY_KINDS = new Set(['same_scenario', 'fresh_variant', 'controller_defined']);
const VALID_FEEDBACK_KINDS = new Set(['outcome_bundle', 'controller_defined']);
const VALID_EVIDENCE_ROLES = new Set(['none', 'practice', 'proof', 'review']);
const VALID_FAILURE_POLICIES = new Set(['retry_required', 'allow_continue', 'finish_attempt']);

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function recordId(value: unknown): string {
  return hasNonEmptyString(value) ? value : 'unknown-content';
}

function validateFeedbackReference(errors: string[], stageId: string, feedback: unknown): void {
  if (!feedback || typeof feedback !== 'object') {
    push(errors, `${stageId}: missing feedback reference`);
    return;
  }
  const ref = feedback as { kind?: unknown; id?: unknown };
  if (!VALID_FEEDBACK_KINDS.has(String(ref.kind))) push(errors, `${stageId}: unknown feedback reference kind`);
  if (!hasNonEmptyString(ref.id)) push(errors, `${stageId}: feedback reference requires a non-empty ID`);
}

function validateRetryPolicy(errors: string[], stageId: string, retry: unknown, required: boolean): void {
  if (!retry) {
    if (required) push(errors, `${stageId}: retry policy is required`);
    return;
  }
  if (typeof retry !== 'object') {
    push(errors, `${stageId}: invalid retry policy`);
    return;
  }
  const value = retry as { kind?: unknown; variantSetId?: unknown };
  if (!VALID_RETRY_KINDS.has(String(value.kind))) {
    push(errors, `${stageId}: unknown retry policy kind`);
    return;
  }
  if (value.kind === 'fresh_variant' && !hasNonEmptyString(value.variantSetId)) {
    push(errors, `${stageId}: fresh_variant retry requires a non-empty variant-set ID`);
  }
}

function validateLessonStage(errors: string[], stage: unknown, stageIds: Set<string>): void {
  if (!stage || typeof stage !== 'object') {
    push(errors, 'future lesson has an invalid stage');
    return;
  }
  const value = stage as Record<string, unknown>;
  const stageId = recordId(value.id);
  if (!hasNonEmptyString(value.id)) push(errors, 'future lesson stage is missing an ID');
  else if (stageIds.has(value.id)) push(errors, `future lesson has duplicate stage ID ${value.id}`);
  else stageIds.add(value.id);

  if (!VALID_STAGE_KINDS.has(String(value.kind))) {
    push(errors, `${stageId}: unsupported stage kind`);
    return;
  }
  if (!VALID_EVIDENCE_ROLES.has(String(value.evidenceRole))) push(errors, `${stageId}: missing or unknown evidence role`);
  if (value.kind === 'frame') {
    if (!hasNonEmptyString(value.copyRef)) push(errors, `${stageId}: frame requires copyRef`);
    if (value.retry !== undefined) push(errors, `${stageId}: non-interactive stage cannot declare retry policy`);
    if (value.evidenceRole !== 'none') push(errors, `${stageId}: frame must use none evidence role`);
    if (value.failurePolicy !== undefined) push(errors, `${stageId}: non-interactive stage cannot declare failure policy`);
    validateRetryPolicy(errors, stageId, value.retry, false);
    return;
  }
  if (!hasNonEmptyString(value.scenarioRef)) push(errors, `${stageId}: ${String(value.kind)} requires scenarioRef`);
  if (value.kind === 'board_demo') {
    if (value.evidenceRole !== 'none') push(errors, `${stageId}: board_demo must use none evidence role`);
    if (value.retry !== undefined) push(errors, `${stageId}: non-interactive stage cannot declare retry policy`);
    if (value.failurePolicy !== undefined) push(errors, `${stageId}: non-interactive stage cannot declare failure policy`);
    validateRetryPolicy(errors, stageId, value.retry, false);
    return;
  }
  if (!VALID_FAILURE_POLICIES.has(String(value.failurePolicy))) push(errors, `${stageId}: failure policy is required and must be known`);
  if (value.kind === 'independent_practice' && value.evidenceRole !== 'practice') push(errors, `${stageId}: independent practice must use practice evidence role`);
  if (value.kind === 'mastery' && value.evidenceRole !== 'proof') push(errors, `${stageId}: mastery must use proof evidence role`);
  if (value.kind === 'review' && value.evidenceRole !== 'review') push(errors, `${stageId}: review must use review evidence role`);
  if (value.kind !== 'review' && value.evidenceRole === 'review') push(errors, `${stageId}: review evidence role requires review stage`);
  if (value.evidenceRole === 'proof' && value.kind !== 'mastery') push(errors, `${stageId}: proof evidence role requires mastery stage`);
  validateFeedbackReference(errors, stageId, value.feedbackRef);
  validateRetryPolicy(errors, stageId, value.retry, true);
}

export function validateJourneyLessonDefinition(
  definition: JourneyLessonDefinition,
  context: JourneyContentValidationContext = createDefaultValidationContext(),
): string[] {
  const errors: string[] = [];
  const value = definition as unknown as Record<string, unknown>;
  const definitionId = recordId(value.id);
  const nodeId = recordId(value.nodeId);
  const chapterId = recordId(value.chapterId);
  if (!hasNonEmptyString(value.id)) push(errors, 'future lesson missing content ID');
  if (!context.canonicalNodeIds.has(nodeId)) push(errors, `future lesson ${definitionId}: unknown node ID ${nodeId}`);
  if (!hasNonEmptyString(value.chapterId)) push(errors, `future lesson ${definitionId}: missing chapter ID`);
  else if (context.chapterByNodeId.get(nodeId) !== chapterId) push(errors, `future lesson ${definitionId}: chapter mismatch for node ${nodeId}`);
  if (!hasNonEmptyString(value.skillId)) push(errors, `future lesson ${definitionId}: missing skill ID`);
  if (!Number.isInteger(value.contentVersion) || Number(value.contentVersion) < 1) {
    push(errors, `future lesson ${definitionId}: contentVersion must be a positive integer`);
  }

  const ruleset = value.ruleset as { kind?: unknown; id?: unknown } | undefined;
  if (!ruleset || !VALID_RULESET_KINDS.has(String(ruleset.kind))) {
    push(errors, `future lesson ${definitionId}: unknown ruleset kind`);
  } else if (ruleset.kind === 'core_journey' && ruleset.id !== CORE_JOURNEY_RULESET_ID) {
    push(errors, `future lesson ${definitionId}: invalid Core Journey ruleset ID`);
  } else if (ruleset.kind === 'table_tradition' && !hasNonEmptyString(ruleset.id)) {
    push(errors, `future lesson ${definitionId}: Table Tradition ruleset requires an ID`);
  }

  const prerequisites = Array.isArray(value.prerequisites) ? value.prerequisites : [];
  const prerequisiteIds = new Set<string>();
  for (const prerequisite of prerequisites) {
    const prerequisiteId = String(prerequisite);
    if (!context.knownContentIds.has(prerequisiteId)) push(errors, `future lesson ${definitionId}: unknown prerequisite content ID ${prerequisiteId}`);
    if (prerequisiteId === definitionId) push(errors, `future lesson ${definitionId}: cannot prerequisite itself`);
    if (prerequisiteIds.has(prerequisiteId)) push(errors, `future lesson ${definitionId}: duplicate prerequisite ${prerequisiteId}`);
    prerequisiteIds.add(prerequisiteId);
  }

  const stages = Array.isArray(value.stages) ? value.stages : [];
  if (stages.length === 0) push(errors, `future lesson ${definitionId}: must have at least one stage`);
  const stageIds = new Set<string>();
  for (const stage of stages) validateLessonStage(errors, stage, stageIds);

  const completion = value.completion as Record<string, unknown> | undefined;
  if (!completion || (completion.kind !== 'required_stages' && completion.kind !== 'scorecard')) {
    push(errors, `future lesson ${definitionId}: unknown completion rule`);
  } else {
    const completionIds: unknown[] = completion.kind === 'required_stages'
      ? (Array.isArray(completion.stageIds) ? completion.stageIds : [])
      : [...(Array.isArray(completion.requiredStageIds) ? completion.requiredStageIds : []), ...(Array.isArray(completion.keyDecisionIds) ? completion.keyDecisionIds : [])];
    if (completionIds.length === 0) push(errors, `future lesson ${definitionId}: completion needs stages`);
    for (const stageId of completionIds) {
      if (!stageIds.has(String(stageId))) push(errors, `future lesson ${definitionId}: completion references unknown stage ${String(stageId)}`);
    }
    if (completion.kind === 'scorecard' && !hasNonEmptyString(completion.aggregateThresholdRef)) {
      push(errors, `future lesson ${definitionId}: scorecard requires aggregateThresholdRef`);
    }
    if (completion.kind === 'scorecard') {
      const failurePolicy = completion.failurePolicy as { kind?: unknown; stageId?: unknown } | undefined;
      if (!failurePolicy || (failurePolicy.kind !== 'end_session' && failurePolicy.kind !== 'retry_stage')) push(errors, `future lesson ${definitionId}: scorecard requires a valid failure policy`);
      const stagesById = new Map(stages.filter((stage): stage is Record<string, unknown> => Boolean(stage && typeof stage === 'object')).map((stage) => [String(stage.id), stage]));
      for (const stageId of Array.isArray(completion.keyDecisionIds) ? completion.keyDecisionIds : []) {
        const stage = stagesById.get(String(stageId));
        if (!stage || !['decision', 'guided_practice', 'independent_practice', 'authored_scenario', 'mastery', 'review'].includes(String(stage.kind))) push(errors, `future lesson ${definitionId}: scorecard key decision must reference an interactive stage ${String(stageId)}`);
      }
      if (failurePolicy?.kind === 'retry_stage') {
        const target = stagesById.get(String(failurePolicy.stageId));
        if (!target || !['decision', 'guided_practice', 'independent_practice', 'authored_scenario', 'mastery', 'review'].includes(String(target.kind))) push(errors, `future lesson ${definitionId}: scorecard retry target must be an interactive stage`);
      }
    }
    if (completion.owner !== 'journey_lesson_controller') {
      push(errors, `future lesson ${definitionId}: completion must be controller-owned`);
    }
  }
  return errors;
}

function validateRuntimeAndCompletion(errors: string[], descriptor: unknown): void {
  const value = descriptor as Record<string, unknown>;
  const id = recordId(value.nodeId ?? value.contentId);
  const runtime = value.runtime as Record<string, unknown> | undefined;
  const completion = value.completion as Record<string, unknown> | undefined;
  const supportStatus = value.supportStatus;
  const migrationClass = value.migrationClass;
  const availability = value.runtimeAvailability;
  const ruleset = value.ruleset as Record<string, unknown> | undefined;
  if (!runtime || !VALID_RUNTIME_KINDS.has(String(runtime.kind))) push(errors, `${id}: unknown or missing runtime kind`);
  if (!completion || !VALID_COMPLETION_KINDS.has(String(completion.kind))) push(errors, `${id}: unknown or missing completion kind`);
  if (!VALID_SUPPORT_STATUSES.has(String(supportStatus))) push(errors, `${id}: unknown or missing support status`);
  if (!VALID_MIGRATION_CLASSES.has(String(migrationClass))) push(errors, `${id}: unknown or missing migration class`);
  if (!ruleset || !VALID_RULESET_KINDS.has(String(ruleset.kind))) push(errors, `${id}: unknown or missing ruleset kind`);
  if (availability !== 'available' && availability !== 'unavailable') push(errors, `${id}: unknown or missing runtime availability`);
  if (!runtime || !completion || !VALID_RUNTIME_KINDS.has(String(runtime.kind)) || !VALID_COMPLETION_KINDS.has(String(completion.kind))) return;

  const pairs: Record<string, string> = {
    briefing_acknowledgement: 'briefing_acknowledged',
    static_decision: 'decision_correct',
    interactive_board_decision: 'interactive_scenario_success',
    bot_match: 'bot_result',
    boss_match: 'boss_result',
    lesson_sequence: 'lesson_controller_result',
    external_navigation: 'external_navigation',
    unsupported: 'none',
  };
  if (pairs[String(runtime.kind)] !== String(completion.kind)) push(errors, `${id}: runtime ${String(runtime.kind)} is incompatible with completion ${String(completion.kind)}`);
  const owners: Record<string, string> = {
    briefing_acknowledged: 'journey_ui',
    decision_correct: 'journey_ui',
    interactive_scenario_success: 'journey_ui',
    bot_result: 'journey_match_bridge',
    boss_result: 'journey_match_bridge',
    lesson_controller_result: 'journey_lesson_controller',
    external_navigation: 'external_route',
    none: 'none',
  };
  if (owners[String(completion.kind)] !== String(completion.owner)) push(errors, `${id}: completion ${String(completion.kind)} has incompatible owner`);
  if (runtime.kind === 'unsupported' && availability !== 'unavailable') push(errors, `${id}: unsupported runtime must be unavailable`);
  if (runtime.kind === 'lesson_sequence' && completion.owner !== 'journey_lesson_controller') {
    push(errors, `${id}: lesson sequence must be controller-owned`);
  }
  if (supportStatus === 'unsupported' && (runtime.kind !== 'unsupported' || completion.kind !== 'none')) {
    push(errors, `${id}: unsupported content must use unsupported runtime and no completion authority`);
  }
  if (supportStatus === 'placeholder' && runtime.kind !== 'briefing_acknowledgement') {
    push(errors, `${id}: placeholder content must use briefing acknowledgement runtime`);
  }
}

export function validateJourneyContentCoverage(
  descriptors: ReadonlyArray<JourneyContentDescriptor> = getAllJourneyContentDescriptors(),
): string[] {
  const errors: string[] = [];
  const nodeById = new Map(JOURNEY_CHAPTER_DEFINITIONS.flatMap((chapter) => chapter.nodes).map((node) => [node.id, node]));
  const descriptorByNodeId = new Map<string, JourneyContentDescriptor>();
  const contentIds = new Map<string, string>();
  for (const descriptor of descriptors) {
    const nodeId = String((descriptor as unknown as Record<string, unknown>).nodeId ?? 'unknown-node');
    if (descriptorByNodeId.has(nodeId)) push(errors, `${nodeId}: duplicate normalized descriptor`);
    descriptorByNodeId.set(nodeId, descriptor);
    const contentId = String((descriptor as unknown as Record<string, unknown>).contentId ?? 'unknown-content');
    const priorNodeId = contentIds.get(contentId);
    if (priorNodeId) push(errors, `${nodeId}: duplicate content ID ${contentId} already used by ${priorNodeId}`);
    contentIds.set(contentId, nodeId);
    validateRuntimeAndCompletion(errors, descriptor);
    const node = nodeById.get(nodeId);
    if (!node) {
      push(errors, `${nodeId}: descriptor references unknown node`);
      continue;
    }
    if (descriptor.chapterId !== node.chapterId) push(errors, `${nodeId}: descriptor chapterId does not match canonical node`);
    if (descriptor.migrationClass === 'legacy' && String(descriptor.contentId) !== String(descriptor.nodeId)) push(errors, `${nodeId}: legacy contentId must equal nodeId`);
    if (descriptor.migrationClass === 'legacy') {
      const legacy = descriptor.legacy;
      if (descriptor.supportStatus === 'placeholder' && legacy.actionKind !== 'placeholder') push(errors, `${nodeId}: placeholder status requires placeholder legacy action`);
      if (descriptor.supportStatus === 'legacyFallback') {
        if (!legacy.fallback) push(errors, `${nodeId}: legacyFallback requires a fallback reason`);
        else if (legacy.fallback.requestedCapability !== legacy.requestedCapability || legacy.fallback.actualCapability !== legacy.actualCapability) push(errors, `${nodeId}: fallback requested/actual capabilities do not match legacy metadata`);
      } else if (legacy.fallback) {
        push(errors, `${nodeId}: fallback metadata is only valid for legacyFallback content`);
      }
    } else if (descriptor.migrationClass === 'premium') {
      if (descriptor.runtime.kind !== 'lesson_sequence') push(errors, `${nodeId}: premium descriptor must expose lesson_sequence runtime`);
      if (!descriptor.lesson || descriptor.lesson.definitionId !== descriptor.contentId) push(errors, `${nodeId}: premium descriptor is missing lesson definition reference`);
    }
  }
  for (const [nodeId] of nodeById) if (!descriptorByNodeId.has(nodeId)) push(errors, `${nodeId}: missing normalized descriptor`);
  return errors.sort((a, b) => a.localeCompare(b));
}

export function formatJourneyContentValidationErrors(errors: string[]): string {
  return ['Journey content validation failed:', ...errors.map((error) => `- ${error}`)].join('\n');
}

function push(errors: string[], message: string): void {
  errors.push(message);
}

function pushNodeError(errors: string[], node: JourneyNode, message: string): void {
  push(errors, `[${node.chapterId}] ${node.id}: ${message}`);
}

function pushChapterError(errors: string[], chapterId: string, message: string): void {
  const prefix = chapterId?.trim() ? `[${chapterId}]` : '[chapter]';
  push(errors, `${prefix} ${message}`);
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, out);
    }
  }
  return out;
}

function validateCopyStrings(errors: string[], label: string, strings: string[]): void {
  for (const text of strings) {
    for (const rule of FORBIDDEN_COPY_PATTERNS) {
      if (rule.pattern.test(text)) {
        push(errors, `${label}: ${rule.message} (found in "${text.slice(0, 80)}...")`);
      }
    }
  }
}

function validateNodeOrder(errors: string[], chapter: JourneyChapterDefinition): void {
  if (chapter.nodes.length === 0) return;

  const orders = chapter.nodes.map((node) => node.order).sort((a, b) => a - b);
  if (orders[0] !== 1) {
    pushChapterError(errors, chapter.chapterId, `first node order must be 1 (got ${orders[0]})`);
  }

  for (let index = 0; index < orders.length; index += 1) {
    const expected = index + 1;
    if (orders[index] !== expected) {
      pushChapterError(
        errors,
        chapter.chapterId,
        `node order gap/duplicate — expected ${expected}, got ${orders[index]}`,
      );
      break;
    }
  }
}

function validateNodeFields(errors: string[], node: JourneyNode): void {
  if (!node.title?.trim()) pushNodeError(errors, node, 'missing title');
  if (!node.subtitle?.trim()) pushNodeError(errors, node, 'missing subtitle');
  if (!node.rewardText?.trim()) pushNodeError(errors, node, 'missing rewardText');
  if (!node.completionCriteria?.trim()) pushNodeError(errors, node, 'missing completionCriteria');
  if (!node.action) pushNodeError(errors, node, 'missing action');

  if (!VALID_NODE_TYPES.includes(node.nodeType)) {
    pushNodeError(errors, node, `invalid nodeType "${node.nodeType}"`);
  }

  const chapterPrefix = node.chapterId.match(/^ch\d+/)?.[0];
  if (chapterPrefix && !node.id.startsWith(`${chapterPrefix}-`)) {
    pushNodeError(errors, node, `node id must belong to chapter prefix ${chapterPrefix}`);
  }

  if (node.nodeType === 'match' || node.nodeType === 'boss') {
    if (node.action.kind !== 'botMatch') {
      pushNodeError(errors, node, `${node.nodeType} node must use botMatch action`);
      return;
    }
    if (!VALID_FRITZ_TIERS.includes(node.action.fritzTier)) {
      pushNodeError(errors, node, `invalid fritzTier "${node.action.fritzTier}"`);
    }
    if (!VALID_DEAL_SIZES.has(node.action.dealSize)) {
      pushNodeError(errors, node, `invalid dealSize ${node.action.dealSize}`);
    }
    const winningScore = node.action.winningScore ?? 60;
    if (!VALID_WINNING_SCORES.has(winningScore)) {
      pushNodeError(errors, node, `invalid winningScore ${winningScore}`);
    }
    const trialFormat =
      node.action.trialFormat ?? (winningScore < 60 ? 'shortRace' : 'fullMatch');
    if (!VALID_TRIAL_FORMATS.has(trialFormat)) {
      pushNodeError(errors, node, `invalid trialFormat "${trialFormat}"`);
    }
    if (trialFormat === 'shortRace' && winningScore >= 60) {
      pushNodeError(errors, node, 'shortRace must use winningScore below 60');
    }
    if (trialFormat === 'fullMatch' && winningScore !== 60) {
      pushNodeError(errors, node, 'fullMatch must use winningScore 60');
    }
    if (node.nodeType === 'boss' && trialFormat !== 'fullMatch') {
      pushNodeError(errors, node, 'boss node must use fullMatch trialFormat');
    }
    if (node.nodeType === 'boss' && winningScore !== 60) {
      pushNodeError(errors, node, 'boss node must use winningScore 60');
    }
  }

  if (node.nodeType === 'puzzle') {
    if (node.action.kind !== 'puzzle') {
      pushNodeError(errors, node, 'puzzle node must use puzzle action');
    }
    if (!hasJourneyPuzzle(node.id)) {
      pushNodeError(errors, node, 'missing puzzle content in journey puzzle registry');
    }
  }

  if (node.nodeType === 'checkpoint' && !hasJourneyBriefing(node.id)) {
    pushNodeError(errors, node, 'missing briefing content in journey briefing registry');
  }
}

function validateChapterDefinition(errors: string[], chapter: JourneyChapterDefinition): void {
  if (!chapter.chapterId?.trim()) push(errors, '[chapter] missing chapterId');
  if (!chapter.title?.trim()) pushChapterError(errors, chapter.chapterId, 'missing title');
  if (!chapter.subtitle?.trim()) pushChapterError(errors, chapter.chapterId, 'missing subtitle');
  if (!chapter.description?.trim()) pushChapterError(errors, chapter.chapterId, 'missing description');
  if (!chapter.finalReward?.trim()) pushChapterError(errors, chapter.chapterId, 'missing finalReward');
  if (!chapter.nextChapterCopy?.trim()) pushChapterError(errors, chapter.chapterId, 'missing nextChapterCopy');

  if (chapter.totalNodes !== chapter.nodes.length) {
    pushChapterError(
      errors,
      chapter.chapterId,
      `totalNodes (${chapter.totalNodes}) !== nodes.length (${chapter.nodes.length})`,
    );
  }

  if (chapter.releaseStatus === 'playable' && chapter.nodes.length === 0) {
    pushChapterError(errors, chapter.chapterId, 'playable chapter must have at least one node');
  }

  if (
    chapter.releaseStatus !== 'playable' &&
    chapter.nodes.length === 0 &&
    chapter.totalNodes !== 0
  ) {
    pushChapterError(errors, chapter.chapterId, 'teaser chapter with zero nodes must set totalNodes to 0');
  }

  for (const node of chapter.nodes) {
    if (node.chapterId !== chapter.chapterId) {
      pushNodeError(
        errors,
        node,
        `chapterId ${node.chapterId} does not match chapter ${chapter.chapterId}`,
      );
    }
    validateNodeFields(errors, node);
  }

  validateNodeOrder(errors, chapter);
  validateCopyStrings(errors, chapter.chapterId, collectStrings(chapter));
}

function validateUnlockChain(errors: string[]): void {
  const chapterIds = new Set(JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => chapter.chapterId));
  for (const chapter of JOURNEY_CHAPTER_DEFINITIONS) {
    if (chapter.unlockRequiresChapterId && !chapterIds.has(chapter.unlockRequiresChapterId)) {
      pushChapterError(
        errors,
        chapter.chapterId,
        `unlockRequiresChapterId "${chapter.unlockRequiresChapterId}" not found`,
      );
    }
  }

  const numbers = JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => chapter.chapterNumber).sort(
    (a, b) => a - b,
  );
  for (let index = 0; index < numbers.length; index += 1) {
    if (numbers[index] !== index + 1) {
      push(errors, `chapterNumber sequence invalid near ${numbers[index]}`);
      break;
    }
  }
}

function validateGlobalNodeIds(errors: string[]): void {
  const seen = new Map<string, string>();
  for (const chapter of JOURNEY_CHAPTER_DEFINITIONS) {
    for (const node of chapter.nodes) {
      const prior = seen.get(node.id);
      if (prior) {
        push(
          errors,
          `[${chapter.chapterId}] duplicate node id "${node.id}" (also in ${prior})`,
        );
      } else {
        seen.set(node.id, chapter.chapterId);
      }
    }
  }
}

function validatePuzzleAnswerDistribution(errors: string[]): void {
  const distributionSummary = summarizePuzzleAnswerDistribution();
  const { totalPuzzles, global, byChapter } = distributionSummary;

  if (totalPuzzles === 0) {
    push(errors, 'puzzle answer distribution: no puzzles found');
    return;
  }

  for (const [nodeId, puzzle] of getAllJourneyPuzzleEntries()) {
    if (!VALID_PUZZLE_CHOICE_IDS.includes(puzzle.correctChoiceId as (typeof VALID_PUZZLE_CHOICE_IDS)[number])) {
      push(errors, `puzzle ${nodeId}: invalid correctChoiceId "${puzzle.correctChoiceId}"`);
    }

    const choiceIds = puzzle.choices.map((choice) => choice.id);
    if (choiceIds.length !== VALID_PUZZLE_CHOICE_IDS.length) {
      push(errors, `puzzle ${nodeId}: expected ${VALID_PUZZLE_CHOICE_IDS.length} choices`);
    }
    for (const expectedId of VALID_PUZZLE_CHOICE_IDS) {
      if (!choiceIds.includes(expectedId)) {
        push(errors, `puzzle ${nodeId}: missing choice id "${expectedId}"`);
      }
    }
  }

  for (const letter of VALID_PUZZLE_CHOICE_IDS) {
    const ratio = global[letter] / totalPuzzles;
    if (ratio > PUZZLE_ANSWER_BIAS_MAX_RATIO) {
      push(
        errors,
        `puzzle answer distribution: "${letter}" is ${global[letter]}/${totalPuzzles} (${Math.round(ratio * 100)}%) — exceeds ${Math.round(PUZZLE_ANSWER_BIAS_MAX_RATIO * 100)}% global cap`,
      );
    }
  }

  for (const chapter of byChapter) {
    if (chapter.puzzleCount < 5) continue;
    for (const letter of VALID_PUZZLE_CHOICE_IDS) {
      const ratio = chapter.distribution[letter] / chapter.puzzleCount;
      if (ratio > PUZZLE_ANSWER_BIAS_MAX_RATIO) {
        push(
          errors,
          `[${chapter.chapterId}] puzzle answer distribution: "${letter}" is ${chapter.distribution[letter]}/${chapter.puzzleCount} (${Math.round(ratio * 100)}%) — exceeds ${Math.round(PUZZLE_ANSWER_BIAS_MAX_RATIO * 100)}% chapter cap`,
        );
      }
    }
  }
}

function validateAuxContent(errors: string[]): void {
  for (const [nodeId, briefing] of getAllJourneyBriefingEntries()) {
    if (briefing.nodeId !== nodeId) {
      push(errors, `briefing key ${nodeId} mismatches briefing.nodeId ${briefing.nodeId}`);
    }
    if (!JOURNEY_CHAPTER_DEFINITIONS.some((chapter) => chapter.nodes.some((node) => node.id === nodeId))) {
      push(errors, `briefing ${nodeId} has no matching journey node`);
    }
    validateCopyStrings(errors, `briefing:${nodeId}`, collectStrings(briefing));
  }

  for (const [nodeId, puzzle] of getAllJourneyPuzzleEntries()) {
    if (puzzle.nodeId !== nodeId) {
      push(errors, `puzzle key ${nodeId} mismatches puzzle.nodeId ${puzzle.nodeId}`);
    }
    if (!JOURNEY_CHAPTER_DEFINITIONS.some((chapter) => chapter.nodes.some((node) => node.id === nodeId))) {
      push(errors, `puzzle ${nodeId} has no matching journey node`);
    }
    validateCopyStrings(errors, `puzzle:${nodeId}`, collectStrings(puzzle));
  }
}

export function validateJourneyContent(): JourneyContentValidationResult {
  const errors: string[] = [];
  const chapterIds = new Set<string>();

  for (const chapter of JOURNEY_CHAPTER_DEFINITIONS) {
    if (chapterIds.has(chapter.chapterId)) {
      push(errors, `duplicate chapterId "${chapter.chapterId}"`);
    }
    chapterIds.add(chapter.chapterId);
    validateChapterDefinition(errors, chapter);
  }

  validateUnlockChain(errors);
  validateGlobalNodeIds(errors);
  validateAuxContent(errors);
  validatePuzzleAnswerDistribution(errors);
  errors.push(...validateJourneyContentCoverage());
  const productionDescriptors = getAllJourneyContentDescriptors();
  const productionContext = createJourneyContentValidationContext(
    JOURNEY_CHAPTER_DEFINITIONS,
    new Set(productionDescriptors.map((descriptor) => descriptor.contentId)),
  );
  errors.push(...validateJourneyDescriptorSet(
    productionDescriptors,
    getAllJourneyLessonDefinitions(),
    { ...productionContext, premiumRuntimeHostContentIds: new Set(productionDescriptors.filter((descriptor) => descriptor.migrationClass === 'premium' && getJourneyPremiumHostRegistration(String(descriptor.contentId))).map((descriptor) => String(descriptor.contentId))) },
  ));

  return { ok: errors.length === 0, errors, summary: summarizeJourneyContent() };
}

export function formatJourneyContentValidationReport(result: JourneyContentValidationResult): string {
  const sections = [formatJourneyContentSummary(result.summary), ''];

  if (result.ok) {
    sections.push('Journey content validation passed.');
    return sections.join('\n');
  }

  sections.push(formatJourneyContentValidationErrors(result.errors));
  return sections.join('\n');
}
