import type { BotHandReveal } from '../types.ts';
import type { UseGuidedMatchCaptureRuntimeResult } from '../../guided/useGuidedMatchCaptureRuntime.ts';
import type { GuidedV2CoordinationState } from '../../guided/useGuidedV2CoordinationState.ts';
import type { UseGuidedMatchRuntimeArgs } from '../../guided/useGuidedMatchRuntimeTypes.ts';
import type { MatchTurnStackSources } from './types.ts';

export function buildGuidedRuntimeArgs(
  sources: MatchTurnStackSources,
  coordination: {
    handReveal: BotHandReveal | null;
    guidedV2Coordination: GuidedV2CoordinationState;
    captureRuntime: UseGuidedMatchCaptureRuntimeResult;
  },
): UseGuidedMatchRuntimeArgs {
  const { bootstrap, refs, guidedBoot, presentation, chrome } = sources;
  const {
    match,
    showRecommendation,
  } = bootstrap;
  const {
    handActive: handActiveEarly,
    botTurn: botTurnEarly,
  } = presentation;
  const { setShowFullCoachTip } = chrome;

  return {
    boot: guidedBoot,
    match,
    userPlayMoves: presentation.userPlayMoves,
    handReveal: coordination.handReveal,
    guidedV2Coordination: coordination.guidedV2Coordination,
    captureRuntime: coordination.captureRuntime,
    drawSequenceActive: refs.drawSequenceActive,
    botTurn: botTurnEarly,
    isTransitioningRef: refs.isTransitioningRef,
    showRecommendation,
    setShowFullCoachTip,
    handActive: handActiveEarly,
    fritzDifficulty: bootstrap.fritzConfig.difficulty,
    matchGameOver: match.gameOver,
  };
}