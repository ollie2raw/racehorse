import type { FritzTier } from '../bot/fritzConfig.ts';
import {
  getAllJourneyBriefingEntries,
  getAllJourneyPuzzleEntries,
  hasJourneyBriefing,
  hasJourneyPuzzle,
} from './journeyContentIndex.ts';
import { JOURNEY_CHAPTER_DEFINITIONS } from './journeyChapters.ts';
import type { JourneyChapterDefinition, JourneyNode, JourneyNodeType } from './journeyTypes.ts';

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

  return {
    chapterCount: chapters.length,
    playableChapterCount: chapters.filter((chapter) => chapter.releaseStatus === 'playable').length,
    totalNodeCount: chapters.reduce((count, chapter) => count + chapter.nodeCount, 0),
    chapters,
    trials: summarizeJourneyTrials(),
    puzzleAnswerDistribution: summarizePuzzleAnswerDistribution(),
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
  lines.push('- Puzzle answers by chapter:');
  for (const chapter of summary.puzzleAnswerDistribution.byChapter) {
    lines.push(
      `  · Ch${chapter.chapterNumber} ${chapter.chapterId}: ${chapter.puzzleCount} puzzles [${formatAnswerDistribution(chapter.distribution)}]`,
    );
  }

  return lines.join('\n');
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
