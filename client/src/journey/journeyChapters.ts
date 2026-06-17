import { CH1_FRITZ_TRAIL_NODES } from './chapters/ch1FritzTrail.nodes.ts';
import { CH2_HIGH_LINE_NODES } from './chapters/ch2HighLine.nodes.ts';
import { CH3_LONG_MARCH_NODES } from './chapters/ch3LongMarch.nodes.ts';
import { CH4_PRESSURE_CIRCUIT_NODES } from './chapters/ch4PressureCircuit.nodes.ts';
import { CH5_IRON_MILE_NODES } from './chapters/ch5IronMile.nodes.ts';
import { CH6_MASTER_TABLE_NODES } from './chapters/ch6MasterTable.nodes.ts';
import {
  JOURNEY_CHAPTER_2_ID,
  JOURNEY_CHAPTER_3_ID,
  JOURNEY_CHAPTER_4_ID,
  JOURNEY_CHAPTER_5_ID,
  JOURNEY_CHAPTER_6_ID,
} from './journeyChapterIds.ts';
import {
  JOURNEY_CHAPTER_1_ID,
  type JourneyChapterDefinition,
  type JourneyChapterProgress,
  type JourneyChapterReleaseStatus,
  type JourneyChapterRuntimeStatus,
  type JourneyNode,
  type JourneyProgress,
} from './journeyTypes.ts';

export {
  JOURNEY_CHAPTER_2_ID,
  JOURNEY_CHAPTER_3_ID,
  JOURNEY_CHAPTER_4_ID,
  JOURNEY_CHAPTER_5_ID,
  JOURNEY_CHAPTER_6_ID,
} from './journeyChapterIds.ts';

export const JOURNEY_CHAPTER_DEFINITIONS: JourneyChapterDefinition[] = [
  {
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterNumber: 1,
    title: 'The Fritz Trail',
    subtitle: 'Chapter 1 · Proving Ground',
    description:
      'Twelve milestones from trailhead briefing to your first Grandmaster gate—the opening march of a much longer Journey.',
    totalNodes: CH1_FRITZ_TRAIL_NODES.length,
    finalReward: 'Fritz Trail Conqueror',
    nextChapterCopy: 'Clear this trail to reveal the next chapter of Racehorse Journey.',
    releaseStatus: 'playable',
    nodes: CH1_FRITZ_TRAIL_NODES,
  },
  {
    chapterId: JOURNEY_CHAPTER_2_ID,
    chapterNumber: 2,
    title: 'The High Line',
    subtitle: 'Chapter 2 · Tactical Ground',
    description:
      'Sharper reads, tighter boards, and Fritz lines that punish every free end you leave open.',
    totalNodes: CH2_HIGH_LINE_NODES.length,
    finalReward: 'High Line Crest',
    nextChapterCopy: 'Clear The High Line to reveal what marches next.',
    releaseStatus: 'playable',
    unlockRequiresChapterId: JOURNEY_CHAPTER_1_ID,
    nodes: CH2_HIGH_LINE_NODES,
  },
  {
    chapterId: JOURNEY_CHAPTER_3_ID,
    chapterNumber: 3,
    title: 'The Long March',
    subtitle: 'Chapter 3 · Endurance Trail',
    description:
      'Twenty milestones of recovery, denial, and sustained pressure—the first long chapter of a much longer Journey.',
    totalNodes: CH3_LONG_MARCH_NODES.length,
    finalReward: 'Long March Seal',
    nextChapterCopy: 'Clear The Long March to reveal what comes next on the Journey.',
    releaseStatus: 'playable',
    unlockRequiresChapterId: JOURNEY_CHAPTER_2_ID,
    nodes: CH3_LONG_MARCH_NODES,
  },
  {
    chapterId: JOURNEY_CHAPTER_4_ID,
    chapterNumber: 4,
    title: 'The Pressure Circuit',
    subtitle: 'Chapter 4 · Sustained Pressure',
    description:
      'Twenty-four laps of squeeze, denial, and defensive control—Fritz repeats the same pressure until your reads hold or break.',
    totalNodes: CH4_PRESSURE_CIRCUIT_NODES.length,
    finalReward: 'Pressure Circuit Crest',
    nextChapterCopy: 'Clear The Pressure Circuit to reveal what comes next on the Journey.',
    releaseStatus: 'playable',
    unlockRequiresChapterId: JOURNEY_CHAPTER_3_ID,
    nodes: CH4_PRESSURE_CIRCUIT_NODES,
  },
  {
    chapterId: JOURNEY_CHAPTER_5_ID,
    chapterNumber: 5,
    title: 'The Iron Mile',
    subtitle: 'Chapter 5 · Endgame Control',
    description:
      'Twenty-four closeout trials—protect leads, deny swings, and finish clean when the race sits inside the final mile.',
    totalNodes: CH5_IRON_MILE_NODES.length,
    finalReward: 'Iron Mile Crest',
    nextChapterCopy: 'Clear The Iron Mile to reveal what comes next on the Journey.',
    releaseStatus: 'playable',
    unlockRequiresChapterId: JOURNEY_CHAPTER_4_ID,
    nodes: CH5_IRON_MILE_NODES,
  },
  {
    chapterId: JOURNEY_CHAPTER_6_ID,
    chapterNumber: 6,
    title: 'The Master Table',
    subtitle: 'Chapter 6 · Disciplined Mastery',
    description:
      'Sixteen seats of Master Fritz, patience reads, and clean closeouts—the deepest table on the Journey so far.',
    totalNodes: CH6_MASTER_TABLE_NODES.length,
    finalReward: 'Master Table Crest',
    nextChapterCopy: 'Clear The Master Table to reveal what comes next on the Journey.',
    releaseStatus: 'playable',
    unlockRequiresChapterId: JOURNEY_CHAPTER_5_ID,
    nodes: CH6_MASTER_TABLE_NODES,
  },
];

const CHAPTER_BY_ID = new Map(JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => [chapter.chapterId, chapter]));

const ALL_NODES = JOURNEY_CHAPTER_DEFINITIONS.flatMap((chapter) => chapter.nodes);
const NODE_BY_ID = new Map(ALL_NODES.map((node) => [node.id, node]));

export function getJourneyChapterById(chapterId: string): JourneyChapterDefinition | null {
  return CHAPTER_BY_ID.get(chapterId) ?? null;
}

export function getJourneyNodeById(nodeId: string): JourneyNode | null {
  return NODE_BY_ID.get(nodeId) ?? null;
}

export function getJourneyChapterForNode(nodeId: string): JourneyChapterDefinition | null {
  const node = getJourneyNodeById(nodeId);
  if (!node) return null;
  return getJourneyChapterById(node.chapterId);
}

export function getAllJourneyNodeIds(): string[] {
  return ALL_NODES.map((node) => node.id);
}

export function createEmptyChapterProgress(): JourneyChapterProgress {
  return {
    completedNodeIds: [],
    lastVisitedNodeId: null,
    completedAt: null,
    completionCelebrated: false,
  };
}

export function getChapterProgressRecord(
  progress: JourneyProgress,
  chapterId: string,
): JourneyChapterProgress {
  return progress.chapters[chapterId] ?? createEmptyChapterProgress();
}

export function isChapterFullyComplete(chapterId: string, progress: JourneyProgress): boolean {
  const chapter = getJourneyChapterById(chapterId);
  if (!chapter || chapter.nodes.length === 0) return false;
  const chapterProgress = getChapterProgressRecord(progress, chapterId);
  if (chapterProgress.completedAt) return true;
  return chapter.nodes.every((node) => chapterProgress.completedNodeIds.includes(node.id));
}

export function isPreviousChapterComplete(
  chapter: JourneyChapterDefinition,
  progress: JourneyProgress,
): boolean {
  if (!chapter.unlockRequiresChapterId) return true;
  return isChapterFullyComplete(chapter.unlockRequiresChapterId, progress);
}

export function getChapterRuntimeStatus(
  chapter: JourneyChapterDefinition,
  progress: JourneyProgress,
): JourneyChapterRuntimeStatus {
  if (!isPreviousChapterComplete(chapter, progress)) return 'locked';

  if (chapter.releaseStatus === 'playable') {
    if (isChapterFullyComplete(chapter.chapterId, progress)) return 'completed';
    const chapterProgress = getChapterProgressRecord(progress, chapter.chapterId);
    if (chapterProgress.completedNodeIds.length > 0) return 'in_progress';
    return chapter.chapterNumber === 1 ? 'in_progress' : 'available';
  }

  if (chapter.releaseStatus === 'coming_soon') return 'coming_soon';
  return 'locked';
}

export function getChapterRuntimeStatusLabel(status: JourneyChapterRuntimeStatus): string {
  if (status === 'completed') return 'Completed';
  if (status === 'in_progress') return 'In Progress';
  if (status === 'available') return 'Available';
  if (status === 'coming_soon') return 'Coming Soon';
  return 'Locked';
}

export function getPlayableChapterDefinitions(): JourneyChapterDefinition[] {
  return JOURNEY_CHAPTER_DEFINITIONS.filter((chapter) => chapter.releaseStatus === 'playable');
}

export function isPlayableChapterId(chapterId: string): boolean {
  const chapter = getJourneyChapterById(chapterId);
  return chapter?.releaseStatus === 'playable';
}

export function getChapterReleaseStatusLabel(status: JourneyChapterReleaseStatus): string {
  if (status === 'playable') return 'Playable';
  if (status === 'coming_soon') return 'Coming Soon';
  return 'Locked';
}
