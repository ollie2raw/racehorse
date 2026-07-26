import type { MoveEntry } from '../../game/moveLogger.ts';
import type { Move, PlacementPosition, Tile } from '../../types.ts';
import type {
  BotActionResult,
  BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import type { GhostMoveLogEntry, GhostResolvedMove } from '../ghost/ghostContracts.ts';
import type { AuthoredStep, GuidedTurn } from '../../learn/guidedAuthoring.ts';
import type { LessonV2Event } from '../../learn/lessonV2.ts';

import type { GuidedPlacementResult } from '../guided/index.ts';

export type { GuidedPlacementResult };

export type PlayerTurnPorts = {
  notifyBotActionResult: (result: BotActionResult) => void;
  appendMove: (
    entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>,
    handNumber?: number,
  ) => boolean | void;
  appendGhostMove: (entry: GhostMoveLogEntry) => void;
  recordAuthoringStep: (chosenMove: string | null) => void;
  handleGuidedPlacement: (move: Move, position: PlacementPosition) => GuidedPlacementResult;
  captureGuidedMatchCandidateAction: (
    actor: 'player' | 'fritz',
    actionKind: 'tile-play' | 'draw' | 'pass',
    beforeState: BotMatchState,
    result: BotActionResult,
    move?: Move | null,
  ) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  recordPlayerMove: (state: BotMatchState, move: Move) => void;
  pushToast: (msg: string, ms?: number) => void;
  showBoardToast: (message: string, tone: 'you' | 'bot') => void;
  setSelectedTile: (tile: Tile | null) => void;
  setSelectedController: (player: 'you' | 'bot' | null) => void;
  setMovesUsed: React.Dispatch<React.SetStateAction<number>>;
  setIsOffAuthoredLine: (offLine: boolean) => void;
  setLessonStepIndex: React.Dispatch<React.SetStateAction<number>>;
  setAuthoringV2Events: React.Dispatch<React.SetStateAction<LessonV2Event[]>>;
  setGhostAgreementType: (type: 'agrees' | 'heuristic' | null) => void;
  setGhostBoardPulse: (pulse: boolean) => void;
  acceptGuidedTranscriptTurn: (turn: GuidedTurn, playedTile: Tile | null) => void;
  createV2Event: (args: Parameters<typeof import('../../learn/lessonV2.ts').createV2Event>[0]) => LessonV2Event;
};

export type PlayerTurnGuidedContext = {
  currentLessonStep: AuthoredStep | null | undefined;
  currentTranscriptTurn: GuidedTurn | null;
  lessonStepIndex: number;
  isOffAuthoredLine: boolean;
  frozenLesson: unknown;
  isGuidedMode: boolean;
  isGuidedTranscriptMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
};

export type PlayerTurnAuthoringContext = {
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  authoringNoteText: string;
  authoringV2NextEventIndexRef: React.MutableRefObject<number>;
};

export type PlayerTurnGhostContext = {
  isGhostMode: boolean;
  ghostSuggestedPlayerMove: GhostResolvedMove | null;
};

export type DrawAnimationDeps = {
  boneyardRef: React.RefObject<HTMLDivElement | null>;
  handAreaRef: React.RefObject<HTMLDivElement | null>;
  opponentPillRef: React.RefObject<HTMLButtonElement | null>;
  guidedBoneyardAnchorRef: React.RefObject<HTMLDivElement | null>;
  guidedFritzAnchorRef: React.RefObject<HTMLButtonElement | null>;
  rootRef: React.RefObject<HTMLDivElement | null>;
  boardStageRef: React.RefObject<HTMLDivElement | null>;
  flyingTileIdRef: React.MutableRefObject<number>;
  setDrawPulseIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setFlyingTiles: React.Dispatch<
    React.SetStateAction<{ x: number; y: number; toX: number; toY: number; id: number }[]>
  >;
};

export type UsePlayerTurnOrchestrationArgs = {
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  selectedTile: Tile | null;
  userPlayMoves: Move[];
  ports: PlayerTurnPorts;
  guided: PlayerTurnGuidedContext;
  authoring: PlayerTurnAuthoringContext;
  ghost: PlayerTurnGhostContext;
  drawAnimation: DrawAnimationDeps;
  isDailyFritzMode: boolean;
  isMuted: boolean;
  fritzDifficulty: BotDifficulty;
  moveCounterRef: React.MutableRefObject<number>;
  drawSequenceActiveRef: React.MutableRefObject<boolean>;
  setDrawSequenceActiveBoth: (val: boolean) => void;
  isTransitioningRef: React.MutableRefObject<boolean>;
  localRun: {
    beginLocalRun: (kind: 'player-draw' | 'bot-turn') => import('../match/types.ts').LocalRunToken;
    isLocalRunCurrent: (token: import('../match/types.ts').LocalRunToken) => boolean;
    finishLocalRun: (token: import('../match/types.ts').LocalRunToken) => void;
  };
  drawStepMs: number;
  applyAndNotify: (result: BotActionResult) => void;
  triggerDrawStepAnimation: (drawer: 'you' | 'bot', nextState: BotMatchState) => void;
  scheduleDrawStepAnimation: (drawer: 'you' | 'bot', nextState: BotMatchState) => void;
  onDrawVisualStep?: (player: 'you' | 'bot', state: BotMatchState) => void;
};

export type UsePlayerTurnOrchestrationResult = {
  applyAndNotify: (result: BotActionResult) => void;
  onPositionClick: (position: PlacementPosition) => void;
  runDrawSequence: import('../bot-turn/drawSequence.ts').RunDrawSequence;
  triggerDrawStepAnimation: (drawer: 'you' | 'bot', nextState: BotMatchState) => void;
  scheduleDrawStepAnimation: (drawer: 'you' | 'bot', nextState: BotMatchState) => void;
};
