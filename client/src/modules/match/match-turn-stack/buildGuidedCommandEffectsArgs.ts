import type { MatchTurnCommandPorts } from './MatchTurnCommandPorts.ts';
import type { UseGuidedMatchCommandEffectsArgs } from '../../guided/useGuidedMatchCommandEffects.ts';
import type { UseGuidedMatchRuntimeBaseResult } from '../../guided/useGuidedMatchRuntimeTypes.ts';
import type { GuidedV2CoordinationState } from '../../guided/useGuidedV2CoordinationState.ts';
import type { MatchTurnStackSources } from './types.ts';

export function buildGuidedCommandEffectsArgs(
  sources: MatchTurnStackSources,
  guidedRuntime: UseGuidedMatchRuntimeBaseResult,
  guidedV2Coordination: GuidedV2CoordinationState,
  commands: MatchTurnCommandPorts,
): UseGuidedMatchCommandEffectsArgs {
  const { bootstrap, refs, guidedBoot, presentation, chrome } = sources;
  const {
    match,
    matchRef,
    setMatch,
    setSelectedTile,
    setSelectedController,
    setMovesUsed,
    fritzConfig,
  } = bootstrap;
  const { pushToast, showScoreToast, showBoardToast, flashLastPlayed, userPlayMoves } = presentation;
  const { isMuted } = chrome;

  return {
    boot: guidedBoot,
    match,
    matchRef,
    setMatch,
    userPlayMoves,
    setSelectedTile,
    setSelectedController,
    isMuted,
    opponentLabel: bootstrap.opponentLabel,
    pushToast,
    showScoreToast,
    showBoardToast,
    flashLastPlayed,
    setMovesUsed,
    fritzDifficulty: fritzConfig.difficulty,
    isTransitioningRef: refs.isTransitioningRef,
    commands,
    guidedV2Coordination,
    guidedRuntime: {
      lessonStepIndex: guidedRuntime.lessonStepIndex,
      setLessonStepIndex: guidedRuntime.setLessonStepIndex,
      isOffAuthoredLine: guidedRuntime.isOffAuthoredLine,
      setIsOffAuthoredLine: guidedRuntime.setIsOffAuthoredLine,
      guidedCoachTip: guidedRuntime.guidedCoachTip,
      currentTranscriptTurn: guidedRuntime.currentTranscriptTurn,
      currentLessonStep: guidedRuntime.currentLessonStep,
      coach: guidedRuntime.coach,
      canPlayCoachedMove: guidedRuntime.canPlayCoachedMove,
      setGuidedV1Replay: guidedRuntime.setGuidedV1Replay,
      guidedV1Replay: guidedRuntime.guidedV1Replay,
      currentExpectedV2PlayerEvent: guidedRuntime.currentExpectedV2PlayerEvent,
    },
  };
}