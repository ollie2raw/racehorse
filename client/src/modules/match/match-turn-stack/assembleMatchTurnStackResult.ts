import type { LessonV2Event } from '../../../learn/lessonV2.ts';
import type { UseBotTurnOrchestrationResult } from '../../bot-turn/useBotTurnOrchestration.ts';
import type { UseGuidedMatchRuntimeResult } from '../../guided/useGuidedMatchRuntimeTypes.ts';
import type { UsePlayerTurnOrchestrationResult } from '../../player-turn/types.ts';
import type { UseHandLifecycleResult } from '../hand-lifecycle/types.ts';
export type AssembleMatchTurnStackResultInput = {
  guidedRuntime: UseGuidedMatchRuntimeResult;
  handLifecycle: UseHandLifecycleResult;
  playerTurn: Pick<UsePlayerTurnOrchestrationResult, 'onPositionClick'>;
  botTurn: Pick<
    UseBotTurnOrchestrationResult,
    'lastBotChoice' | 'setLastBotChoice' | 'fritzPresentation'
  >;
  drawPulseIndex: number | null;
  drawSequenceActive: boolean;
  drawStepBotHandCount: number | null;
  boneyardDisplayCount: number | null;
  flyingTiles: { x: number; y: number; toX: number; toY: number; id: number }[];
  authoringV2Events: LessonV2Event[];
  authoringV2PlayerMoveIndex: number;
};

export function assembleMatchTurnStackResult(
  input: AssembleMatchTurnStackResultInput,
) {
  const { guidedRuntime, handLifecycle, playerTurn, botTurn } = input;

  return {
    guidedRuntime,
    handLifecycle,
    lessonStepIndex: guidedRuntime.lessonStepIndex,
    setLessonStepIndex: guidedRuntime.setLessonStepIndex,
    guidedMatchCaptureStatus: guidedRuntime.guidedMatchCaptureStatus,
    guidedMatchCandidateSaveStatus: guidedRuntime.guidedMatchCandidateSaveStatus,
    setGuidedMatchCandidateSaveStatus: guidedRuntime.setGuidedMatchCandidateSaveStatus,
    saveGuidedMatchCandidate: guidedRuntime.saveGuidedMatchCandidate,
    copyGuidedMatchCandidate: guidedRuntime.copyGuidedMatchCandidate,
    canSaveGuidedMatchCandidate: guidedRuntime.canSaveGuidedMatchCandidate,
    coach: guidedRuntime.coach,
    guidedCoachTip: guidedRuntime.guidedCoachTip,
    guidedScoringTiles: guidedRuntime.guidedScoringTiles,
    currentTranscriptTurn: guidedRuntime.currentTranscriptTurn,
    currentLessonStep: guidedRuntime.currentLessonStep,
    acceptGuidedTranscriptTurn: guidedRuntime.acceptGuidedTranscriptTurn,
    handleGuidedPlacement: guidedRuntime.handleGuidedPlacement,
    playBestMove: guidedRuntime.playBestMove,
    playLessonBestMove: guidedRuntime.playLessonBestMove,
    guidedMatchFinalDebrief: guidedRuntime.guidedMatchFinalDebrief,
    isGuidedMatchVictoryResult: guidedRuntime.isGuidedMatchVictoryResult,
    isLessonLayoutMode: guidedRuntime.isLessonLayoutMode,
    showPlayerCoaching: guidedRuntime.showPlayerCoaching,
    showFritzCoachingPanel: guidedRuntime.showFritzCoachingPanel,
    showLessonCoachPanel: guidedRuntime.showLessonCoachPanel,
    lessonRecommendedTileKey: guidedRuntime.lessonRecommendedTileKey,
    lessonCoachVm: guidedRuntime.lessonCoachVm,
    lessonCoachProgressLabel: guidedRuntime.lessonCoachProgressLabel,
    lessonCoachProgressPct: guidedRuntime.lessonCoachProgressPct,
    lessonCoachContent: guidedRuntime.lessonCoachContent,
    lessonCoachPanelContent: guidedRuntime.lessonCoachPanelContent,
    lessonBoardPlacementMoves: guidedRuntime.lessonBoardPlacementMoves,
    showCoachedRecommendation: guidedRuntime.showCoachedRecommendation,
    activePlacementMoves: guidedRuntime.activePlacementMoves,
    canPlayCoachedMove: guidedRuntime.canPlayCoachedMove,
    handReveal: handLifecycle.handReveal,
    handRevealProgress: handLifecycle.handRevealProgress,
    handAdvanceError: handLifecycle.handAdvanceError,
    showManualHandAdvance: handLifecycle.showManualHandAdvance,
    advanceHand: handLifecycle.advanceHand,
    retryHandAdvance: handLifecycle.retryHandAdvance,
    getDebugSnapshot: handLifecycle.getDebugSnapshot,
    clearHandReveal: handLifecycle.clearHandReveal,
    onPositionClick: playerTurn.onPositionClick,
    lastBotChoice: botTurn.lastBotChoice,
    setLastBotChoice: botTurn.setLastBotChoice,
    fritzPresentation: botTurn.fritzPresentation,
    drawPulseIndex: input.drawPulseIndex,
    drawSequenceActive: input.drawSequenceActive,
    drawStepBotHandCount: input.drawStepBotHandCount,
    boneyardDisplayCount: input.boneyardDisplayCount,
    flyingTiles: input.flyingTiles,
    authoringV2Events: input.authoringV2Events,
    authoringV2PlayerMoveIndex: input.authoringV2PlayerMoveIndex,
  };
}