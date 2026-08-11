import type { UsePlayerTurnOrchestrationArgs } from '../../player-turn/types.ts';
import type { UseGuidedMatchRuntimeResult } from '../../guided/useGuidedMatchRuntimeTypes.ts';
import type { UseHandLifecycleResult } from '../hand-lifecycle/types.ts';
import type { MatchTurnStackSources } from './types.ts';
import { DRAW_STEP_MS } from '../hooks/useBotMatchBootstrap.ts';

type PlayerTurnCommands = Pick<
  UsePlayerTurnOrchestrationArgs,
  'applyAndNotify' | 'triggerDrawStepAnimation' | 'scheduleDrawStepAnimation'
>;

export function buildPlayerTurnArgs(
  sources: MatchTurnStackSources,
  guidedRuntime: UseGuidedMatchRuntimeResult,
  handLifecycle: Pick<UseHandLifecycleResult, 'notifyBotActionResult'>,
  appendMove: UsePlayerTurnOrchestrationArgs['ports']['appendMove'],
  commands: PlayerTurnCommands,
): UsePlayerTurnOrchestrationArgs {
  const { bootstrap, refs, guidedBoot, presentation, ghost, authoring, chrome } = sources;
  const {
    match,
    matchRef,
    setMatch,
    selectedTile,
    isDailyFritzMode,
    fritzConfig,
    setSelectedTile,
    setSelectedController,
    setMovesUsed,
  } = bootstrap;
  const { frozenLesson, isGuidedMode, isGuidedTranscriptMode, isGuidedV2Mode } = guidedBoot;
  const {
    userPlayMoves,
    pushToast,
    showBoardToast,
    flashLastPlayed,
  } = presentation;
  const {
    authoringNoteText,
    authoringV2NextEventIndexRef,
    recordAuthoringStep,
    setAuthoringV2Events,
  } = authoring;
  const { isAuthoringMode, isAuthoringV2Mode } = guidedBoot;
  const { beginLocalRun, isLocalRunCurrent, hasActiveLocalRun, finishLocalRun } = sources.localRun;

  return {
    match,
    matchRef,
    setMatch,
    selectedTile,
    userPlayMoves,
    ports: {
      notifyBotActionResult: handLifecycle.notifyBotActionResult,
      appendMove,
      appendGhostMove: ghost.appendGhostMove,
      recordAuthoringStep,
      handleGuidedPlacement: guidedRuntime.handleGuidedPlacement,
      captureGuidedMatchCandidateAction: guidedRuntime.captureGuidedMatchCandidateAction,
      flashLastPlayed,
      recordPlayerMove: guidedRuntime.coach.recordPlayerMove.bind(guidedRuntime.coach),
      pushToast,
      showBoardToast,
      setSelectedTile,
      setSelectedController,
      setMovesUsed,
      setIsOffAuthoredLine: guidedRuntime.setIsOffAuthoredLine,
      setLessonStepIndex: guidedRuntime.setLessonStepIndex,
      setAuthoringV2Events,
      setGhostAgreementType: ghost.setGhostAgreementType,
      setGhostBoardPulse: ghost.setGhostBoardPulse,
      acceptGuidedTranscriptTurn: guidedRuntime.acceptGuidedTranscriptTurn,
      createV2Event: authoring.createV2Event,
    },
    guided: {
      currentLessonStep: guidedRuntime.currentLessonStep,
      currentTranscriptTurn: guidedRuntime.currentTranscriptTurn,
      lessonStepIndex: guidedRuntime.lessonStepIndex,
      isOffAuthoredLine: guidedRuntime.isOffAuthoredLine,
      frozenLesson,
      isGuidedMode,
      isGuidedTranscriptMode,
      isGuidedV2Mode,
      isGuidedV2OffLine: guidedRuntime.isGuidedV2OffLine,
    },
    authoring: {
      isAuthoringMode,
      isAuthoringV2Mode,
      authoringNoteText,
      authoringV2NextEventIndexRef,
    },
    ghost: {
      isGhostMode: bootstrap.isGhostMode,
      ghostSuggestedPlayerMove: ghost.ghostSuggestedPlayerMove,
    },
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
    },
    isDailyFritzMode,
    isMuted: chrome.isMuted,
    fritzDifficulty: fritzConfig.difficulty,
    moveCounterRef: refs.moveCounterRef,
    drawSequenceActiveRef: refs.drawSequenceActiveRef,
    setDrawSequenceActiveBoth: refs.setDrawSequenceActiveBoth,
    isTransitioningRef: refs.isTransitioningRef,
    localRun: {
      beginLocalRun,
      isLocalRunCurrent,
      hasActiveLocalRun,
      finishLocalRun,
    },
    drawStepMs: DRAW_STEP_MS,
    onDrawVisualStep: refs.onDrawVisualStep,
    ...commands,
  };
}
