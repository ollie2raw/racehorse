import type { BotChoice } from '../../fritz/botHeuristics.ts';
import type { BotTurnPorts } from '../../bot-turn/types.ts';
import type { UseBotTurnOrchestrationArgs } from '../../bot-turn/useBotTurnOrchestration.ts';
import type { UsePlayerTurnOrchestrationResult } from '../../player-turn/types.ts';
import type { UseGuidedMatchRuntimeBaseResult } from '../../guided/useGuidedMatchRuntimeTypes.ts';
import type { MatchTurnStackSources } from './types.ts';

export function buildBotTurnArgs(
  sources: MatchTurnStackSources,
  guidedRuntime: Pick<UseGuidedMatchRuntimeBaseResult, 'isGuidedV2OffLine'>,
  playerTurn: Pick<UsePlayerTurnOrchestrationResult, 'runDrawSequence'>,
  ports: BotTurnPorts,
  lastBotChoice: BotChoice | null,
  setLastBotChoice: (choice: BotChoice | null) => void,
  drawPresentation: {
    triggerDrawStepAnimation: UseBotTurnOrchestrationArgs['triggerDrawStepAnimation'];
    drawStepMs: number;
  },
): UseBotTurnOrchestrationArgs {
  const { bootstrap, refs, guidedBoot, chrome, ghostProfile, localRun } = sources;
  const { isGuidedTranscriptMode, isGuidedV2Mode } = guidedBoot;

  return {
    match: bootstrap.match,
    matchRef: bootstrap.matchRef,
    ports,
    localRun,
    runDrawSequence: playerTurn.runDrawSequence,
    fritzDifficulty: bootstrap.fritzConfig.difficulty,
    isDailyFritzMode: bootstrap.isDailyFritzMode,
    dailyFritzPackage: bootstrap.dailyFritzPackage,
    isGuidedTranscriptMode,
    isGuidedV2Mode,
    isGuidedV2OffLine: guidedRuntime.isGuidedV2OffLine,
    preGameDrawActiveRef: bootstrap.preGameDrawActiveRef,
    drawSequenceActiveRef: refs.drawSequenceActiveRef,
    isGhostMode: bootstrap.isGhostMode,
    ghostProfile,
    isMuted: chrome.isMuted,
    moveCounterRef: refs.moveCounterRef,
    lastBotChoice,
    setLastBotChoice,
    setMatch: bootstrap.setMatch,
    onDrawVisualStep: refs.onDrawVisualStep,
    triggerDrawStepAnimation: drawPresentation.triggerDrawStepAnimation,
    drawStepMs: drawPresentation.drawStepMs,
    opponentLabel: bootstrap.opponentLabel,
  };
}