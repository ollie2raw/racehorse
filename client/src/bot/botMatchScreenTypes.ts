import type { MoveEntry } from '../analyzer/moveLogger';
import type { DailyFritzStartResponse } from '../dailyFritz/api';
import type { DailyFritzSetOverlayViewModel } from '../dailyFritz/setOverlayViewModel';
import type { GhostProfileSummary } from '../ghost/api';
import type { AppMode, Move, Tile } from '../types';
import type { BotDealSize } from './botEngine';
import type { FritzTier } from './fritzConfig';

/** Pivotal-turn wizard retired — GameReviewer is the single review surface. */
export const PIVOTAL_REVIEW_WIZARD_ENABLED = false;

export const GUIDED_COACH_PREVIEW_MAX_CHARS = 600;
export const GUIDED_COACH_MORE_MIN_EXTRA_CHARS = 16;

export const COACHING_SUMMARY_BLOCK_RE = /^@summary\s*\r?\n([\s\S]*?)\r?\n---\r?\n/i;

export interface BotMatchScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  dealSize: BotDealSize;
  fritzTier?: FritzTier;
  mode?: 'bot' | 'ghost' | 'daily-fritz';
  dailyPuzzleDate?: string | null;
  userId?: string | null;
  username?: string | null;
  winningScore?: number;
  opponentName?: string;
  opponentUserId?: string | null;
  currentGlickoRating?: number | null;
  currentGlickoRd?: number | null;
  currentGlickoVol?: number | null;
  rankedGamesPlayed?: number | null;
  ghostProfile?: GhostProfileSummary | null;
  onGhostProfileChange?: ((summary: GhostProfileSummary | null) => void) | null;
  onProfileRefresh?: (() => Promise<void> | void) | null;
  onProfilePatch?: ((patch: { glicko_rating?: number | null }) => void) | null;
  dailyFritzPackage?: DailyFritzStartResponse | null;
  /** Parent-owned stable instance key (Daily Fritz embedded match). Used for remount diagnostics. */
  matchInstanceKey?: string | null;
  onDailyFritzComplete?: (() => void) | null;
  dailyFritzSetOverlay?: DailyFritzSetOverlayViewModel | null;
  onDailyFritzGameComplete?: ((result: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
    movesUsed: number;
    handsPlayed: number;
    currentHandIndex: number;
    moveLog: MoveEntry[];
  }) => void) | null;
  isGuidedMode?: boolean;
  /** Admin-only: replace CoachPanel with an editable textarea on each player turn */
  isAuthoringMode?: boolean;
  /** Admin-only V2: record every action as a LessonV2Event flat timeline */
  isAuthoringV2Mode?: boolean;
  /** Player-facing V2: playback a frozen LessonV2 lesson */
  isGuidedV2Mode?: boolean;
  /** Admin-only passive capture for future Guided Match candidate authoring. */
  enableGuidedMatchCandidateCapture?: boolean;
  /** Active Racehorse Journey bot trial — launches from Journey map and returns on exit. */
  journeyTrial?: {
    nodeId: string;
    nodeTitle: string;
  } | null;
  onJourneyTrialComplete?: ((result: { won: boolean; nodeId: string }) => void) | null;
}

export interface BotHandReveal {
  winner: 'you' | 'bot' | null;
  reason: 'domino' | 'blocked';
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
