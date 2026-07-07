import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import type { Move } from '../../types.ts';
import type { MatchTurnCommandPorts } from '../match/match-turn-stack/MatchTurnCommandPorts.ts';
import type { GuidedV2CoordinationState } from './useGuidedV2CoordinationState.ts';
import { useGuidedPlacementHandlers } from './guidedPlacementHandlers.ts';
import { useGuidedV1ReplayEffect } from './useGuidedV1ReplayEffect.ts';
import { useGuidedV2PlaybackEffects } from './useGuidedV2PlaybackEffects.ts';
import { useGuidedWindowDebugApis } from './useGuidedWindowDebugApis.ts';
import type { UseGuidedMatchRuntimeResult } from './useGuidedMatchRuntimeTypes.ts';

export type UseGuidedMatchCommandEffectsArgs = {
  boot: {
    isGuidedMode: boolean;
    isAuthoringMode: boolean;
    isGuidedV2Mode: boolean;
    isLearnAcademyMode: boolean;
    isGuidedTranscriptMode: boolean;
    frozenV2Lesson: import('../../learn/lessonV2.ts').LessonV2 | null;
    guidedV2PlaybackReady: boolean;
    frozenLesson: import('../../learn/guidedAuthoring.ts').FrozenLesson | null;
    guidedTranscript: import('../../learn/guidedAuthoring.ts').GuidedTranscript | null;
    guidedInitSourceRef: React.MutableRefObject<
      'full-matchStateJson' | 'reduced-snapshot' | 'seeded-deal' | 'random' | null
    >;
  };
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  userPlayMoves: Move[];
  setSelectedTile: (tile: import('../../types.ts').Tile | null) => void;
  setSelectedController: (player: import('../match/runtime/botEngine.ts').BotPlayerId | null) => void;
  isMuted: boolean;
  opponentLabel: string;
  pushToast: (msg: string, ms?: number) => void;
  showScoreToast: (player: 'you' | 'bot', points: number) => void;
  showBoardToast: (message: string, tone: 'you' | 'bot') => void;
  flashLastPlayed: (tile: import('../../types.ts').Tile | null) => void;
  setMovesUsed: React.Dispatch<React.SetStateAction<number>>;
  fritzDifficulty: BotDifficulty;
  isTransitioningRef: React.MutableRefObject<boolean>;
  commands: MatchTurnCommandPorts;
  guidedV2Coordination: GuidedV2CoordinationState;
  guidedRuntime: Pick<
    UseGuidedMatchRuntimeResult,
    | 'lessonStepIndex'
    | 'setLessonStepIndex'
    | 'isOffAuthoredLine'
    | 'setIsOffAuthoredLine'
    | 'guidedCoachTip'
    | 'currentTranscriptTurn'
    | 'currentLessonStep'
    | 'coach'
    | 'canPlayCoachedMove'
  > & {
    setGuidedV1Replay: React.Dispatch<React.SetStateAction<{ stepIndex: number; replyIndex: number } | null>>;
    guidedV1Replay: { stepIndex: number; replyIndex: number } | null;
    currentExpectedV2PlayerEvent: import('../../learn/lessonV2.ts').LessonV2Event | null;
  };
};

export function useGuidedMatchCommandEffects(args: UseGuidedMatchCommandEffectsArgs) {
  const {
    boot,
    match,
    matchRef,
    setMatch,
    userPlayMoves,
    setSelectedTile,
    setSelectedController,
    isMuted,
    opponentLabel,
    pushToast,
    showScoreToast,
    showBoardToast,
    flashLastPlayed,
    setMovesUsed,
    fritzDifficulty,
    isTransitioningRef,
    commands,
    guidedV2Coordination,
    guidedRuntime,
  } = args;

  const {
    isGuidedMode,
    isAuthoringMode,
    isGuidedV2Mode,
    isLearnAcademyMode,
    isGuidedTranscriptMode,
    frozenV2Lesson,
    guidedV2PlaybackReady,
    frozenLesson,
    guidedTranscript,
    guidedInitSourceRef,
  } = boot;

  const {
    guidedV2EventIndex,
    setGuidedV2EventIndex,
    isGuidedV2OffLine,
    setIsGuidedV2OffLine,
    fritzV2LastAppliedIndexRef,
  } = guidedV2Coordination;

  useGuidedWindowDebugApis({
    isLearnAcademyMode,
    isAuthoringMode,
    isGuidedMode,
    frozenLesson,
    match,
    matchRef,
    guidedInitSourceRef,
    setMatch,
    notifyBotActionResult: commands.notifyBotActionResult,
    flashLastPlayed,
    isMuted,
    userPlayMoves,
  });

  useGuidedV2PlaybackEffects({
    guidedV2PlaybackReady,
    frozenV2Lesson,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    guidedV2EventIndex,
    setGuidedV2EventIndex,
    setIsGuidedV2OffLine,
    fritzV2LastAppliedIndexRef,
    match,
    matchRef,
    setMatch,
    setSelectedTile,
    setSelectedController,
    clearHandReveal: commands.clearHandReveal,
    scheduleHandReveal: commands.scheduleHandReveal,
    scheduleDrawStepAnimation: commands.scheduleDrawStepAnimation,
    opponentLabel,
    showScoreToast,
    showBoardToast,
    isMuted,
    currentExpectedV2PlayerEvent: guidedRuntime.currentExpectedV2PlayerEvent,
  });

  const placementHandlers = useGuidedPlacementHandlers({
    isGuidedTranscriptMode,
    guidedTranscript,
    currentTranscriptTurn: guidedRuntime.currentTranscriptTurn,
    pushToast,
    setIsOffAuthoredLine: guidedRuntime.setIsOffAuthoredLine,
    setSelectedTile,
    flashLastPlayed,
    setMatch,
    setGuidedV1Replay: guidedRuntime.setGuidedV1Replay,
    setLessonStepIndex: guidedRuntime.setLessonStepIndex,
    isGuidedV2Mode,
    frozenV2Lesson,
    isGuidedV2OffLine,
    guidedV2EventIndex,
    setIsGuidedV2OffLine,
    setGuidedV2EventIndex,
    matchRef,
    opponentLabel,
    showScoreToast,
    showBoardToast,
    isMuted,
    scheduleHandReveal: commands.scheduleHandReveal,
    match,
    guidedCoachTip: guidedRuntime.guidedCoachTip,
    userPlayMoves,
    coach: guidedRuntime.coach,
    isAuthoringMode,
    recordAuthoringStep: commands.recordAuthoringStep,
    applyAndNotify: commands.applyAndNotify,
    appendMove: commands.appendMove,
    setMovesUsed,
    fritzDifficulty,
    canPlayCoachedMove: guidedRuntime.canPlayCoachedMove,
    currentExpectedV2PlayerEvent: guidedRuntime.currentExpectedV2PlayerEvent,
    frozenLesson,
    currentLessonStep: guidedRuntime.currentLessonStep,
    isTransitioningRef,
  });

  useGuidedV1ReplayEffect({
    isGuidedTranscriptMode,
    isOffAuthoredLine: guidedRuntime.isOffAuthoredLine,
    guidedTranscript,
    guidedV1Replay: guidedRuntime.guidedV1Replay,
    setGuidedV1Replay: guidedRuntime.setGuidedV1Replay,
    setLessonStepIndex: guidedRuntime.setLessonStepIndex,
    setIsOffAuthoredLine: guidedRuntime.setIsOffAuthoredLine,
    pushToast,
    setMatch,
    notifyBotActionResult: commands.notifyBotActionResult,
    flashLastPlayed,
    isMuted,
    triggerDrawStepAnimation: commands.triggerDrawStepAnimation,
  });

  return placementHandlers;
}