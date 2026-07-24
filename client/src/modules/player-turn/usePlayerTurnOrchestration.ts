import { useMemo } from 'react';
import { createRunDrawSequence } from '../bot-turn/drawSequence.ts';
import { usePlayerNoMoveEffect } from './usePlayerNoMoveEffect.ts';
import { usePlayerPlacementHandler } from './usePlayerPlacementHandler.ts';
import type { UsePlayerTurnOrchestrationArgs, UsePlayerTurnOrchestrationResult } from './types.ts';

export function usePlayerTurnOrchestration(
  args: UsePlayerTurnOrchestrationArgs,
): UsePlayerTurnOrchestrationResult {
  const {
    applyAndNotify,
    triggerDrawStepAnimation,
    scheduleDrawStepAnimation,
    isMuted,
    drawStepMs,
    localRun,
  } = args;

  const { isLocalRunCurrent } = localRun;

  const runDrawSequence = useMemo(
    () => createRunDrawSequence({
      setMatch: args.setMatch,
      onDrawVisualStep: args.onDrawVisualStep,
      isMuted,
      isLocalRunCurrent,
      triggerDrawStepAnimation,
      drawStepMs,
    }),
    [args.setMatch, args.onDrawVisualStep, isMuted, isLocalRunCurrent, triggerDrawStepAnimation, drawStepMs],
  );

  const onPositionClick = usePlayerPlacementHandler({
    ...args,
    applyAndNotify,
  });

  usePlayerNoMoveEffect({
    ...args,
    applyAndNotify,
    runDrawSequence,
  });

  return {
    applyAndNotify,
    onPositionClick,
    runDrawSequence,
    triggerDrawStepAnimation,
    scheduleDrawStepAnimation,
  };
}