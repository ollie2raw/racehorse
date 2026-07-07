import type { Move, Tile } from '../../../types.ts';
import type { BotHandEndReason } from '../runtime/botEngine.ts';

export const PIVOTAL_REVIEW_WIZARD_ENABLED = false;

export const GUIDED_COACH_PREVIEW_MAX_CHARS = 600;
export const GUIDED_COACH_MORE_MIN_EXTRA_CHARS = 16;

export const COACHING_SUMMARY_BLOCK_RE = /^@summary\s*\r?\n([\s\S]*?)\r?\n---\r?\n/i;

export interface BotHandReveal {
  winner: 'you' | 'bot' | null;
  reason: BotHandEndReason;
  pointsAwarded: number;
  loserPips: number;
  calcText: string;
  yourRemainingTiles: Tile[];
  botRemainingTiles: Tile[];
}

export type LocalRunToken = {
  id: number;
  lifecycleVersion: number;
  kind: 'player-draw' | 'bot-turn';
};

export type GuidedCoachViewModel = {
  stepIndex: number;
  totalSteps: number;
  coachingText: string;
  coachingSummary?: string;
  canBestMove: boolean;
  isOffAuthoredLine: boolean;
};

export type GuidedLessonCoachContent = {
  title: string;
  bodyParagraphs: string[];
  summary: string | null;
};

export interface GuidedCoachTip {
  tile: Tile;
  bestMove: Move;
  pts: number;
  openSum: number;
  isOnlyPlay: boolean;
  isControlChoice: boolean;
  placementCount: number;
  isOpeningMove: boolean;
  isOpeningDouble: boolean;
}