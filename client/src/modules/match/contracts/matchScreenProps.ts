import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { DailyFritzStartResponse } from '../../daily/dailyFritzContracts.ts';
import type { DailyFritzSetOverlayViewModel } from '../../daily/dailyFritzUiContracts.ts';
import type { GhostProfileSummary } from '../../ghost/ghostContracts.ts';
import type { AppMode } from '../../../types.ts';
import type { BotDealSize } from '../runtime/botEngine.ts';
import type { FritzTier } from '../../fritz/fritzConfig.ts';
import type { BotMatchState } from '../runtime/botEngine.ts';
import type { TableOffer, HandResult } from '../../../stakes/stakesEconomy';

export interface BotMatchScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  dealSize: BotDealSize;
  fritzTier?: FritzTier;
  mode?: 'bot' | 'ghost' | 'daily-fritz' | 'stakes';
  stakesConfig?: TableOffer;
  onStakesHandComplete?: (won: boolean, stats: Omit<HandResult, 'won'>) => void;
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
  onPublicStateChange?: ((state: BotMatchState) => void) | null;
  dailyFritzSetOverlay?: DailyFritzSetOverlayViewModel | null;
  onDailyFritzGameComplete?: ((result: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
    movesUsed: number;
    handsPlayed: number;
    currentHandIndex: number;
    moveLog: MoveEntry[];
  }) => void | Promise<void>) | null;
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
