import type { Tile } from '../../../types.ts';
import type { BotActionResult, BotMatchState } from '../runtime/botEngine.ts';
import type { BotChoice } from '../../fritz/botHeuristics.ts';
import type { BotHandReveal } from '../types.ts';
import type {
  DailyFritzNextHandResponse,
  DailyFritzSetGameNumber,
  DailyFritzStartResponse,
} from '../../daily/dailyFritzContracts.ts';
import type { MatchLifecycleController } from '../controllers/MatchLifecycleController.ts';

export type HandLifecyclePorts = {
  invalidateLocalRuns: () => void;
  flashLastPlayed: (tile: Tile | null) => void;
  setSelectedTile: (tile: Tile | null) => void;
  setLastBotChoice: (choice: BotChoice | null) => void;
  pushToast: (msg: string, ms?: number) => void;
  showScoreToast: (player: 'you' | 'bot', points: number) => void;
  showBoardToast: (message: string, tone: 'you' | 'bot') => void;
  captureGuidedMatchCandidateNextHand: (
    previousState: BotMatchState,
    nextState: BotMatchState,
  ) => void;
};

export type HandLifecycleDebugSnapshot = {
  lastDailyFlowLabel: string;
  revealTimerPending: boolean;
  handRevealVisible: boolean;
  nextHandPrefetched: boolean;
  nextHandInFlight: boolean;
  transitionInFlight: boolean;
};

export type DailyFritzNextHandCacheEntry = {
  promise: Promise<DailyFritzNextHandResponse>;
  result: DailyFritzNextHandResponse | null;
  error: unknown;
  startedAt: number;
};

export type DailyFritzPrefetchParams = {
  dailyFritzPackage: DailyFritzStartResponse;
  dailyFritzHandIndex: number;
  gameNumber: DailyFritzSetGameNumber;
  completedHandScores: { you: number; fritz: number };
};

export type HandEndedRevealPlan = {
  revealPayload: BotHandReveal;
  pending: { handNumber: number; reveal: BotHandReveal };
  scheduleMode: 'immediate' | 'delayed';
};

export type TraceHandLifecycle = (
  phase: import('@racehorse/match-protocol').HandLifecyclePhase,
  detail?: Record<string, unknown>,
  hypothesisId?: string,
) => void;

export type HandLifecycleTransitionState = {
  handTransitionInFlight: boolean;
  dailyFritzNextHandFailureCount: number;
};

export type UseHandLifecycleArgs = {
  match: BotMatchState;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  matchRef: React.MutableRefObject<BotMatchState>;
  lifecycle: MatchLifecycleController;
  mode: string;
  isDailyFritzMode: boolean;
  isGuidedMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
  isAuthoringMode: boolean;
  isMuted: boolean;
  opponentLabel: string;
  dailyFritzPackage: DailyFritzStartResponse | null;
  dailyFritzHandIndex: number;
  setDailyFritzHandIndex: (index: number) => void;
  frozenV2Lesson: import('../../../learn/lessonV2.ts').LessonV2 | null;
  frozenLesson: import('../../../learn/guidedAuthoring.ts').FrozenLesson | null;
  fritzV2LastAppliedIndexRef: React.MutableRefObject<number>;
  setGuidedV2EventIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsGuidedV2OffLine: React.Dispatch<React.SetStateAction<boolean>>;
  lastDailyFlowLabelRef: React.MutableRefObject<string>;
  ports: HandLifecyclePorts;
};

export type UseHandLifecycleResult = {
  handReveal: BotHandReveal | null;
  handRevealProgress: number;
  handAdvanceError: string | null;
  showManualHandAdvance: boolean;
  notifyBotActionResult: (result: BotActionResult) => void;
  advanceHand: () => void;
  scheduleHandReveal: (reveal: BotHandReveal, delayMs: number) => void;
  clearHandReveal: () => void;
  retryHandAdvance: () => void;
  isRevealTimerPending: () => boolean;
  getDebugSnapshot: () => HandLifecycleDebugSnapshot;
};