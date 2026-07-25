import { useMemo, useState } from 'react';
import type { BotChoice } from '../../fritz/botHeuristics.ts';
import { logGuidedMatchDebug } from './logGuidedMatchDebug.ts';
import { useHandLifecycle } from './useHandLifecycle.ts';
import {
  useGuidedMatchCaptureRuntime,
  useGuidedMatchRuntime,
  useGuidedMatchCommandEffects,
  useGuidedV2CoordinationState,
} from '../../guided/index.ts';
import { useApplyAndNotify } from '../../player-turn/useApplyAndNotify.ts';
import { usePlayerDrawAnimation } from '../../player-turn/usePlayerDrawAnimation.ts';
import { usePlayerTurnOrchestration } from '../../player-turn/index.ts';
import { useBotTurnOrchestration } from '../../bot-turn/index.ts';
import { useDailyFritzDiagnostics } from '../../daily/index.ts';
import { DRAW_STEP_MS } from './useBotMatchBootstrap.ts';
import { assembleMatchTurnStackResult } from '../match-turn-stack/assembleMatchTurnStackResult.ts';
import { countAuthoringV2PlayerPlays } from '../match-turn-stack/authoringV2Metrics.ts';
import { buildBotTurnArgs } from '../match-turn-stack/buildBotTurnArgs.ts';
import { buildBotTurnPorts } from '../match-turn-stack/buildBotTurnPorts.ts';
import { buildDailyFritzDiagnosticsArgs } from '../match-turn-stack/buildDailyFritzDiagnosticsArgs.ts';
import { buildGuidedCommandEffectsArgs } from '../match-turn-stack/buildGuidedCommandEffectsArgs.ts';
import { buildGuidedRuntimeArgs } from '../match-turn-stack/buildGuidedRuntimeArgs.ts';
import { buildHandLifecycleArgs } from '../match-turn-stack/buildHandLifecycleArgs.ts';
import { buildHandLifecyclePorts } from '../match-turn-stack/buildHandLifecyclePorts.ts';
import { buildMatchTurnCommandPorts } from '../match-turn-stack/MatchTurnCommandPorts.ts';
import { buildPlayerTurnArgs } from '../match-turn-stack/buildPlayerTurnArgs.ts';
import type { MatchTurnStackSources } from '../match-turn-stack/types.ts';
import type { UseGuidedMatchRuntimeResult } from '../../guided/useGuidedMatchRuntimeTypes.ts';
import { useMatchTurnStackEffects } from '../match-turn-stack/useMatchTurnStackEffects.ts';
import { useReplayMoveAppender } from '../match-turn-stack/useReplayMoveAppender.ts';
import type { UseBotMatchBootstrapResult } from './useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from './useBotMatchRefs.ts';
import type { UseMatchPresentationResult } from './useMatchPresentation.ts';
import type { UseGhostRuntimeResult } from '../../ghost/useGhostRuntime.ts';
import type { UseDailyFritzRuntimeResult } from '../../daily/useDailyFritzRuntime.ts';
import type { UseGuidedLessonBootResult } from '../../guided/index.ts';
import type { useAuthoringCapture } from '../../guided/useAuthoringCapture.ts';
import type { ReplayRecorder } from '../../replay/index.ts';
import type { LocalRunSession } from '../../bot-turn/index.ts';
import type { GhostProfileSummary } from '../../ghost/ghostContracts.ts';
import type { MoveEntry } from '../../../game/moveLogger.ts';

type UseAuthoringCaptureResult = ReturnType<typeof useAuthoringCapture>;

export type UseMatchTurnStackArgs = {
  bootstrap: UseBotMatchBootstrapResult;
  refs: UseBotMatchRefsResult;
  guidedBoot: UseGuidedLessonBootResult;
  presentation: UseMatchPresentationResult;
  ghost: UseGhostRuntimeResult;
  dailyFritz: UseDailyFritzRuntimeResult;
  authoring: UseAuthoringCaptureResult;
  replayRecorder: ReplayRecorder;
  moveLog: readonly MoveEntry[];
  localRun: LocalRunSession;
  ghostProfile: GhostProfileSummary | null;
  chrome: {
    isMuted: boolean;
    setShowFullCoachTip: (open: boolean) => void;
  };
};

export function useMatchTurnStack(args: UseMatchTurnStackArgs) {
  const sources: MatchTurnStackSources = args;
  const { bootstrap, refs, guidedBoot, presentation, authoring } = sources;

  const guidedV2Coordination = useGuidedV2CoordinationState(guidedBoot);
  const [lastBotChoice, setLastBotChoice] = useState<BotChoice | null>(null);

  const captureRuntime = useGuidedMatchCaptureRuntime({
    enableGuidedMatchCandidateCapture: bootstrap.enableGuidedMatchCandidateCapture,
    activeLocalMatchId: sources.ghost.activeLocalMatchId,
    match: bootstrap.match,
    matchGameOver: bootstrap.match.gameOver,
  });

  const handLifecyclePorts = useMemo(
    () => buildHandLifecyclePorts({
      invalidateLocalRuns: sources.localRun.invalidateLocalRuns,
      flashLastPlayed: presentation.flashLastPlayed,
      setSelectedTile: bootstrap.setSelectedTile,
      setLastBotChoice,
      pushToast: presentation.pushToast,
      showScoreToast: presentation.showScoreToast,
      showBoardToast: presentation.showBoardToast,
      captureGuidedMatchCandidateNextHand: captureRuntime.captureGuidedMatchCandidateNextHand,
    }),
    [
      sources.localRun.invalidateLocalRuns,
      presentation.flashLastPlayed,
      bootstrap.setSelectedTile,
      presentation.pushToast,
      presentation.showScoreToast,
      presentation.showBoardToast,
      captureRuntime.captureGuidedMatchCandidateNextHand,
    ],
  );

  const handLifecycle = useHandLifecycle(
    buildHandLifecycleArgs(sources, guidedV2Coordination, handLifecyclePorts),
  );

  useDailyFritzDiagnostics(buildDailyFritzDiagnosticsArgs(sources, handLifecycle));

  useMatchTurnStackEffects({
    match: bootstrap.match,
    matchRef: bootstrap.matchRef,
    setMatch: bootstrap.setMatch,
    preGameDrawActive: bootstrap.preGameDrawActive,
    winningScore: bootstrap.winningScore,
    dealSize: bootstrap.dealSize,
    moveLog: sources.moveLog,
    moveCounterRef: refs.moveCounterRef,
  });

  const appendMove = useReplayMoveAppender(
    bootstrap.matchRef,
    sources.replayRecorder,
    refs.moveCounterRef,
  );

  const applyAndNotify = useApplyAndNotify(
    bootstrap.setMatch,
    handLifecycle.notifyBotActionResult,
    (message) => presentation.showBoardToast(message, 'you'),
  );

  const { triggerDrawStepAnimation, scheduleDrawStepAnimation } = usePlayerDrawAnimation({
    drawAnimation: {
      boneyardRef: refs.boneyardRef,
      handAreaRef: refs.handAreaRef,
      opponentPillRef: refs.opponentPillRef,
      guidedBoneyardAnchorRef: refs.guidedBoneyardAnchorRef,
      guidedFritzAnchorRef: refs.guidedFritzAnchorRef,
      rootRef: refs.rootRef,
      boardStageRef: refs.boardStageRef,
      flyingTileIdRef: refs.flyingTileIdRef,
      setDrawPulseIndex: refs.setDrawPulseIndex,
      setFlyingTiles: refs.setFlyingTiles,
      opponentLabel: bootstrap.opponentLabel,
    },
    showBoardToast: presentation.showBoardToast,
  });

  const commands = useMemo(
    () => buildMatchTurnCommandPorts({
      notifyBotActionResult: handLifecycle.notifyBotActionResult,
      applyAndNotify,
      appendMove,
      recordAuthoringStep: authoring.recordAuthoringStep,
      scheduleHandReveal: handLifecycle.scheduleHandReveal,
      clearHandReveal: handLifecycle.clearHandReveal,
      triggerDrawStepAnimation,
      scheduleDrawStepAnimation,
    }),
    [
      handLifecycle.notifyBotActionResult,
      applyAndNotify,
      appendMove,
      authoring.recordAuthoringStep,
      handLifecycle.scheduleHandReveal,
      handLifecycle.clearHandReveal,
      triggerDrawStepAnimation,
      scheduleDrawStepAnimation,
    ],
  );

  const guidedRuntimeBase = useGuidedMatchRuntime(
    buildGuidedRuntimeArgs(sources, {
      handReveal: handLifecycle.handReveal,
      guidedV2Coordination,
      captureRuntime,
    }),
  );

  const placementHandlers = useGuidedMatchCommandEffects(
    buildGuidedCommandEffectsArgs(sources, guidedRuntimeBase, guidedV2Coordination, commands),
  );

  const guidedRuntime = useMemo((): UseGuidedMatchRuntimeResult => ({
    ...guidedRuntimeBase,
    ...placementHandlers,
  }), [guidedRuntimeBase, placementHandlers]);

  const playerTurn = usePlayerTurnOrchestration(
    buildPlayerTurnArgs(sources, guidedRuntime, handLifecycle, appendMove, {
      applyAndNotify,
      triggerDrawStepAnimation,
      scheduleDrawStepAnimation,
    }),
  );

  const botTurnPorts = useMemo(
    () => buildBotTurnPorts({
      applyAndNotify: playerTurn.applyAndNotify,
      appendMove,
      appendGhostMove: sources.ghost.appendGhostMove,
      captureGuidedMatchCandidateAction: guidedRuntime.captureGuidedMatchCandidateAction,
      flashLastPlayed: presentation.flashLastPlayed,
      setSelectedTile: bootstrap.setSelectedTile,
      setDrawSequenceActiveBoth: refs.setDrawSequenceActiveBoth,
      setLastBotChoice,
      setGhostPlayedTile: sources.ghost.setGhostPlayedTile,
      showBoardToast: presentation.showBoardToast,
      clearBoardToast: presentation.clearBoardToast,
      isAuthoringMode: guidedBoot.isAuthoringMode,
      handleAuthoringFritzActionCaptured: authoring.handleAuthoringFritzActionCaptured,
      isAuthoringV2Mode: guidedBoot.isAuthoringV2Mode,
      handleAuthoringV2FritzEvent: authoring.handleAuthoringV2FritzEvent,
      isDailyFritzMode: bootstrap.isDailyFritzMode,
      handleDailyFritzBotMoveApplied: sources.dailyFritz.handleDailyFritzBotMoveApplied,
    }),
    [
      playerTurn.applyAndNotify,
      appendMove,
      sources.ghost.appendGhostMove,
      guidedRuntime.captureGuidedMatchCandidateAction,
      presentation.flashLastPlayed,
      bootstrap.setSelectedTile,
      refs.setDrawSequenceActiveBoth,
      presentation.showBoardToast,
      presentation.clearBoardToast,
      sources.ghost.setGhostPlayedTile,
      guidedBoot.isAuthoringMode,
      authoring.handleAuthoringFritzActionCaptured,
      guidedBoot.isAuthoringV2Mode,
      authoring.handleAuthoringV2FritzEvent,
      bootstrap.isDailyFritzMode,
      sources.dailyFritz.handleDailyFritzBotMoveApplied,
    ],
  );

  const botTurn = useBotTurnOrchestration(
    buildBotTurnArgs(
      sources,
      guidedRuntime,
      playerTurn,
      botTurnPorts,
      lastBotChoice,
      setLastBotChoice,
      {
        triggerDrawStepAnimation,
        drawStepMs: DRAW_STEP_MS,
      },
    ),
  );

  logGuidedMatchDebug({
    isGuidedMode: guidedBoot.isGuidedMode,
    isAuthoringMode: guidedBoot.isAuthoringMode,
    match: bootstrap.match,
    lessonStepIndex: guidedRuntime.lessonStepIndex,
    userLegalMoves: presentation.userLegalMoves,
    userPlayMoves: presentation.userPlayMoves,
  });

  const authoringV2PlayerMoveIndex = useMemo(
    () => countAuthoringV2PlayerPlays(authoring.authoringV2Events),
    [authoring.authoringV2Events],
  );

  return assembleMatchTurnStackResult({
    guidedRuntime,
    handLifecycle,
    playerTurn,
    botTurn,
    drawPulseIndex: refs.drawPulseIndex,
    drawSequenceActive: refs.drawSequenceActive,
    drawStepBotHandCount: refs.drawStepBotHandCount,
    boneyardDisplayCount: refs.boneyardDisplayCount,
    flyingTiles: refs.flyingTiles,
    authoringV2Events: authoring.authoringV2Events,
    authoringV2PlayerMoveIndex,
  });
}

export type UseMatchTurnStackResult = ReturnType<typeof useMatchTurnStack>;
