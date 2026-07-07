import type { RefObject, Dispatch, SetStateAction } from 'react';
import type { BoardHandle } from '../../components';
import type { MoveEntry } from '../../game/moveLogger';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer';
import type { PivotalReviewSession, PivotalTurnReflection } from '../../training/pivotalReview/pivotalReviewStorage';
import type { PivotalTurnSelection } from '../../training/pivotalReview/pivotalTurnSelector';
import type { DailyFritzStartResponse } from '../../dailyFritz/api';
import type { DailyFritzSetOverlayViewModel } from '../../dailyFritz/setOverlayViewModel';
import type { DailyPuzzleLeaderboardEntry } from '../../dailyPuzzle/api';
import type { GhostCompletionResult } from '../../ghost/api';
import type { AppMode, Move, PlacementPosition, Tile } from '../../types';
import type { DailyFritzLeaderboardRow } from '../../dailyFritz/api';
import type { GuidedMatchFinalDebrief } from '../../learn/guidedMatch/guidedMatchFinalDebrief';
import type { HandOverTileReveal } from '../../components/handOver/handOverCopy';
import type { AuthoredStep, FrozenLesson } from '../../learn/guidedAuthoring';
import type { HandLifecycleDebugSnapshot } from '../../modules/match/index.ts';
import type { GuidedMatchCaptureStatus } from '../../learn/guidedMatch/guidedMatchCapture';
import type { PreGameDrawState } from '../../match/preGameDraw/preGameDrawLogic';
import type { LearningCoachApi } from '../../learning/useLearningCoach';
import type { BotDealSize, BotMatchState } from '../../modules/match/runtime/botEngine.ts';
import type { BotChoice } from '../../modules/fritz/botHeuristics.ts';
import type {
  BotHandReveal,
  GuidedCoachTip,
  GuidedCoachViewModel,
  GuidedLessonCoachContent,
} from '../botMatchScreenTypes';

export type BotMatchViewPreGameDraw = {
  drawState: PreGameDrawState | null;
  isPlayerPickEnabled: boolean;
  isOpponentThinking: boolean;
  resultMessage: string | null;
  handlePlayerTileTap: (tileId: string) => void;
};

export type BotMatchViewScoreToast = {
  message: string;
  tone: 'you' | 'bot';
  visible: boolean;
};

export type BotMatchViewFlyingTile = {
  x: number;
  y: number;
  toX: number;
  toY: number;
  id: number;
};

export type BotMatchNavigationViewModel = {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  exitMatch: () => void;
  exitJourneyTrial: (markCompleteOnWin: boolean) => void;
  goHome: () => void;
  returnToFritzSetup: () => void;
  returnToLearn: () => void;
  startFreshMatch: () => void;
  onProfileRefresh?: (() => Promise<void> | void) | null;
  onDailyFritzGameComplete?: ((result: {
    winner: 'you' | 'bot' | null;
    yourScore: number;
    botScore: number;
    movesUsed: number;
    handsPlayed: number;
    currentHandIndex: number;
    moveLog: MoveEntry[];
  }) => void) | null;
};

export type BotMatchLayoutViewModel = {
  mode: 'bot' | 'ghost' | 'daily-fritz';
  winningScore: number;
  dealSize: BotDealSize;
  isDailyFritzMode: boolean;
  dailyFritzBoardHasPlay: boolean;
  isLessonLayoutMode: boolean;
  isGhostMode: boolean;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isJourneyTrial: boolean;
  isDailyPuzzleRun: boolean;
  isStandaloneFritzMatch: boolean;
  isPlayVsFritzGameOver: boolean;
  guidedV2BootError: string | null;
  enableGuidedMatchCandidateCapture: boolean;
  enableDailyFritzProfiling: boolean;
  userId: string | null;
  currentGlickoRating: number | null;
  matchStartGlickoRating: number | null;
  rootRef: RefObject<HTMLDivElement | null>;
  boardStageRef: RefObject<HTMLDivElement | null>;
  isTransitioningRef: RefObject<boolean>;
  isFullscreen: boolean;
  isMuted: boolean;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  toggleFullscreen: () => void;
  scoreTrackOpen: boolean;
  setScoreTrackOpen: Dispatch<SetStateAction<boolean>>;
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
};

export type MatchHudViewModel = {
  opponentLabel: string;
  ghostSubLabel: string | null;
  botTurn: boolean;
  handActive: boolean;
  handReveal: BotHandReveal | null;
  preGameDrawActive: boolean;
  preGameDraw: BotMatchViewPreGameDraw;
  dailyFritzPackage: DailyFritzStartResponse | null;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
};

export type BoardViewModel = {
  boardRef: RefObject<BoardHandle | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  ghostBoardPulse: boolean;
  openEnds: number[];
  openEndsSum: number;
  scoreToast: BotMatchViewScoreToast | null;
  lastPlayedTile: Tile | null;
  selectedTile: Tile | null;
  onPositionClick: (position: PlacementPosition) => void;
  activePlacementMoves: Move[];
  lessonBoardPlacementMoves: Move[];
  isGhostMode: boolean;
  ghostAgreementType: 'agrees' | 'heuristic' | null;
  ghostPlayedTile: Tile | null;
  isJourneyTrial: boolean;
  guidedMatchCaptureStatus: GuidedMatchCaptureStatus;
  copyGuidedMatchCandidate: () => void;
  enableGuidedMatchCandidateCapture: boolean;
};

export type HandViewModel = {
  handAreaRef: RefObject<HTMLDivElement | null>;
  handTileSize: number;
  lessonHandRowCount: number;
  selectedTile: Tile | null;
  setSelectedTile: Dispatch<SetStateAction<Tile | null>>;
  setSelectedController: Dispatch<SetStateAction<'you' | 'bot' | null>>;
  handActive: boolean;
  botTurn: boolean;
  drawSequenceActive: boolean;
  drawPulseIndex: number | null;
  playableTileKeys: Set<string>;
  isGuidedMode: boolean;
  isDailyFritzMode: boolean;
  preGameDrawActive: boolean;
  guidedScoringTiles: Map<string, number>;
  showCoachedRecommendation: boolean;
  lessonRecommendedTileKey: string | null;
};

export type CoachViewModel = {
  coach: LearningCoachApi;
  guidedScoringTiles: Map<string, number>;
  showCoachedRecommendation: boolean;
  lessonRecommendedTileKey: string | null;
  playBestMove: () => void;
  guidedCoachTip: GuidedCoachTip | null;
  frozenLesson: FrozenLesson | null;
  showPlayerCoaching: boolean;
  lessonCoachVm: GuidedCoachViewModel | null;
  lessonCoachContent: GuidedLessonCoachContent;
  showFritzCoachingPanel: boolean;
  showLessonCoachPanel: boolean;
  lessonCoachPanelContent: {
    title: string;
    bodyParagraphs: string[];
    previewText: string;
    showMore: boolean;
    showFooter: boolean;
    progressChipLabel: string;
    contextChips: string[];
  } | null;
  lessonCoachProgressLabel: string;
  lessonCoachProgressPct: number;
  canPlayCoachedMove: boolean;
  playLessonBestMove: () => void;
  isGuidedMatchVictoryResult: boolean;
  guidedMatchFinalDebrief: GuidedMatchFinalDebrief | null;
  guidedMatchCaptureStatus: GuidedMatchCaptureStatus;
  guidedMatchCandidateSaveStatus: string | null;
  copyGuidedMatchCandidate: () => void;
  saveGuidedMatchCandidate: () => void;
  canSaveGuidedMatchCandidate: boolean;
  authoringSteps: AuthoredStep[];
  authoringNoteText: string;
  setAuthoringNoteText: Dispatch<SetStateAction<string>>;
  saveAuthoringNoteOnly: () => void;
  authoringV2PlayerMoveIndex: number;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedMode: boolean;
  showFullCoachTip: boolean;
  setShowFullCoachTip: Dispatch<SetStateAction<boolean>>;
  showRecommendation: boolean;
  setShowRecommendation: Dispatch<SetStateAction<boolean>>;
  guidedFritzAnchorRef: RefObject<HTMLButtonElement | null>;
  guidedBoneyardAnchorRef: RefObject<HTMLDivElement | null>;
};

export type ModalOverlayViewModel = {
  scoreTrackOpen: boolean;
  setScoreTrackOpen: Dispatch<SetStateAction<boolean>>;
  winningScore: number;
  opponentLabel: string;
  handReveal: BotHandReveal | null;
  handRevealProgress: number;
  handAdvanceError: string | null;
  showManualHandAdvance: boolean;
  ghostResultError: string | null;
  setGhostResultError: Dispatch<SetStateAction<string | null>>;
  isGuidedMode: boolean;
  isGuidedV2Mode: boolean;
  isDailyFritzMode: boolean;
  handRevealTileReveals: HandOverTileReveal[];
  coach: LearningCoachApi;
  advanceHand: () => void;
  retryHandAdvance: () => void;
  dailyFritzSetOverlay: DailyFritzSetOverlayViewModel | null;
  shareCopied: boolean;
  handleShareResult: () => void;
  showPostGameOverlays: boolean;
  pivotalReviewOpen: boolean;
  pivotalSelection: PivotalTurnSelection | null;
  completePivotalTurnReview: (reflections: PivotalTurnReflection[]) => void;
  pivotalReviewSummary: PivotalReviewSession | null;
  postGameAnalysis: GameAnalysis | null;
  showPostGameReviewPrompt: boolean;
  savePivotalReviewSummary: () => void;
  openHandScopedReview: (handNumber: number) => void;
  openReviewGameFromPrompt: () => void;
  skipPostGameReview: () => void;
  showPlayVsFritzResultOverlay: boolean;
  isJourneyTrial: boolean;
  ghostResultLoading: boolean;
  hasConfirmedFritzRatingUpdate: boolean;
  fritzNewGlickoRating: number | null;
  showFritzRatingSyncing: boolean;
  currentGlickoRating: number | null;
  matchStartGlickoRating: number | null;
  fritzGlickoDelta: number | null;
  ghostResult: GhostCompletionResult | null;
  botPostGameReviewEligible: boolean;
  postGameAnalysisPending: boolean;
  isPlayVsFritzGameOver: boolean;
  isGuidedMatchVictoryResult: boolean;
  isGhostMode: boolean;
  ghostSubLabel: string | null;
  guidedMatchFinalDebrief: GuidedMatchFinalDebrief | null;
  enableGuidedMatchCandidateCapture: boolean;
  guidedMatchCaptureStatus: GuidedMatchCaptureStatus;
  guidedMatchCandidateSaveStatus: string | null;
  dailyFritzRank: number | null;
  dailyFritzLeaderboard: DailyFritzLeaderboardRow[];
  isDailyPuzzleRun: boolean;
  userId: string | null;
  dailyLeaderboardLoading: boolean;
  dailyLeaderboardError: string | null;
  dailyLeaderboard: DailyPuzzleLeaderboardEntry[];
  ghostRatingDeltaLabel: string | null;
  ghostResultMessage: string;
  canSaveGuidedMatchCandidate: boolean;
  copyGuidedMatchCandidate: () => void;
  saveGuidedMatchCandidate: () => void;
  retryDailyFritzCompletion: () => void;
  reopenPostGameReview: () => void;
  navigation: BotMatchNavigationViewModel;
};

export type InGameOverlayViewModel = {
  flyingTiles: BotMatchViewFlyingTile[];
  isLessonLayoutMode: boolean;
  showFullCoachTip: boolean;
  showPlayerCoaching: boolean;
  lessonCoachVm: GuidedCoachViewModel | null;
  lessonCoachContent: GuidedLessonCoachContent;
  setShowFullCoachTip: Dispatch<SetStateAction<boolean>>;
  analyzerOpen: boolean;
  closeAnalyzer: () => void;
  currentAnalysis: GameAnalysis | null;
  reviewerScopeHandNumber: number | null;
  reviewerInitialMoveIndex: number;
  opponentLabel: string;
  showDebug: boolean;
  botHand: string;
  openEnds: number[];
  lastBotChoice: BotChoice | null;
  showLeaveConfirm: boolean;
  setShowLeaveConfirm: Dispatch<SetStateAction<boolean>>;
  isJourneyTrial: boolean;
  isStandaloneFritzMatch: boolean;
  matchGameOver: boolean;
  navigation: Pick<
    BotMatchNavigationViewModel,
    'exitJourneyTrial' | 'exitMatch' | 'onProfileRefresh'
  >;
  abandonStandaloneFritzMatch: () => Promise<void>;
};

export type OverlayViewModel = {
  modals: ModalOverlayViewModel;
  inGame: InGameOverlayViewModel;
};

export type DebugViewModel = {
  showDebug: boolean;
  getDebugSnapshot: () => HandLifecycleDebugSnapshot;
  guidedInitSourceRef: RefObject<string | null>;
  lastDailyFlowLabelRef: RefObject<string>;
  dailyFritzSubmitSucceededRef: RefObject<boolean>;
  lastBotChoice: BotChoice | null;
};

export type BotMatchScreenViewModel = {
  match: BotMatchState;
  navigation: BotMatchNavigationViewModel;
  layout: BotMatchLayoutViewModel;
  hud: MatchHudViewModel;
  board: BoardViewModel;
  hand: HandViewModel;
  coach: CoachViewModel;
  overlays: OverlayViewModel;
  debug: DebugViewModel;
};

export type BotMatchScreenViewProps = BotMatchScreenViewModel;