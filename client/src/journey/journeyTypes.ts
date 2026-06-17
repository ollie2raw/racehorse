import type { AppMode } from '../types';
import type { BotDealSize } from '../bot/botEngine';
import type { FritzTier } from '../bot/fritzConfig';

export const JOURNEY_CHAPTER_1_ID = 'ch1-fritz-trail';
export const JOURNEY_CHAPTER_2_ID = 'ch2-high-line';
export const JOURNEY_CHAPTER_3_ID = 'ch3-long-march';
export const JOURNEY_CHAPTER_4_ID = 'ch4-pressure-circuit';
export const JOURNEY_CHAPTER_5_ID = 'ch5-iron-mile';
export const JOURNEY_CHAPTER_6_ID = 'ch6-master-table';

export type JourneyNodeType = 'checkpoint' | 'match' | 'puzzle' | 'boss';

export type JourneyNodeStatus = 'locked' | 'unlocked' | 'current' | 'completed';

export type JourneyDifficulty =
  | 'intro'
  | 'casual'
  | 'standard'
  | 'hard'
  | 'expert'
  | 'boss';

export type JourneyChapterReleaseStatus = 'playable' | 'coming_soon' | 'locked_teaser';

export type JourneyChapterRuntimeStatus =
  | 'locked'
  | 'available'
  | 'in_progress'
  | 'completed'
  | 'coming_soon';

export type JourneyNodeAction =
  | { kind: 'placeholder' }
  | { kind: 'navigate'; mode: AppMode; params?: Record<string, unknown> }
  | {
      kind: 'botMatch';
      fritzTier: FritzTier;
      dealSize: BotDealSize;
      trialFormat?: 'fullMatch' | 'shortRace';
      winningScore?: number;
    }
  | { kind: 'puzzle'; puzzleId: string }
  | { kind: 'lesson'; lessonId: string };

export interface JourneyNode {
  id: string;
  chapterId: string;
  chapterTitle: string;
  order: number;
  title: string;
  subtitle: string;
  nodeType: JourneyNodeType;
  difficulty: JourneyDifficulty;
  requirements: string[];
  rewardText: string;
  badgeText?: string;
  action: JourneyNodeAction;
  completionCriteria: string;
}

export interface JourneyChapterDefinition {
  chapterId: string;
  chapterNumber: number;
  title: string;
  subtitle: string;
  description: string;
  totalNodes: number;
  finalReward: string;
  nextChapterCopy: string;
  releaseStatus: JourneyChapterReleaseStatus;
  unlockRequiresChapterId?: string;
  nodes: JourneyNode[];
}

export interface JourneyChapterProgress {
  completedNodeIds: string[];
  lastVisitedNodeId: string | null;
  completedAt: string | null;
  completionCelebrated: boolean;
}

/** @deprecated v1 shape — migrated automatically on load. */
export interface JourneyProgressV1 {
  version: 1;
  chapterId: string;
  completedNodeIds: string[];
  lastVisitedNodeId: string | null;
  updatedAt: string;
}

export interface JourneyProgress {
  version: 2;
  activeChapterId: string;
  chapters: Record<string, JourneyChapterProgress>;
  updatedAt: string;
}

export interface JourneyNodeWithStatus extends JourneyNode {
  status: JourneyNodeStatus;
}

export interface JourneyChapterWithStatus extends JourneyChapterDefinition {
  runtimeStatus: JourneyChapterRuntimeStatus;
  completedNodes: number;
}
