import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { DailyFritzStartResponse } from '../../daily/dailyFritzContracts.ts';
import type { DailyFritzSetOverlayViewModel } from '../../daily/dailyFritzUiContracts.ts';
import type { GhostProfileSummary } from '../../ghost/ghostContracts.ts';
import type { AppMode } from '../../../types.ts';
import type { BotDealSize } from '../runtime/botEngine.ts';
import type { FritzTier } from '../../fritz/fritzConfig.ts';
import type { BotMatchState, MatchRuleOverrides } from '../runtime/botEngine.ts';

export interface BotMatchScreenProps {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  dealSize: BotDealSize;
  fritzTier?: FritzTier;
  mode?: 'bot' | 'ghost' | 'daily-fritz';
  userId?: string | null;
  username?: string | null;
  winningScore?: number;
  /** Optional gameplay-rule knobs (blockedHandRule, endHandBonus, scoringMultiple, scoreHandicap) — see `MatchRuleOverrides`. Currently sourced from Journey match variants. */
  matchRuleOverrides?: MatchRuleOverrides;
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
    /** Identity of the current attempt; changes on every rematch. */
    attemptId: string;
    /** What the match HUD shows for this stage. Plain data — the match layer knows nothing about Journey content. */
    context: JourneyMatchContext;
  } | null;
  /** The player is leaving the trial (Continue Trail, Return to Trail, Leave). Navigation only — never what records a win. */
  onJourneyTrialComplete?: ((result: { won: boolean; nodeId: string; attemptId: string }) => void) | null;
  /** Fired once per attempt when authoritative local game state reaches game over. */
  onJourneyTrialSettled?: ((result: { attemptId: string; nodeId: string; won: boolean; finalScore: { you: number; bot: number } }) => void) | null;
  /** Rematch started: the owner returns the new attempt's id (or null if none could be created). */
  onJourneyTrialRematch?: ((previousAttemptId: string) => string | null) | null;
}

/** HUD context for a Journey match (stage title, rival, target score, and a head-start label when configured). */
export interface JourneyMatchContext {
  stageTitle: string;
  rivalName: string;
  targetScore: number;
  /** e.g. "You start +15"; null when there is no head start. */
  headStartLabel: string | null;
}
