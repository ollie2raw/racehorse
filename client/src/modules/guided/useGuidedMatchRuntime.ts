import { useEffect, useMemo, useState } from 'react';
import {
  getGuidedV1AuthoredStepByIndex,
  getGuidedV1OrderedAuthoredSteps,
} from './guidedBotMatchHelpers.ts';
import { botMatchDebugLog } from '../match/runtime/botMatchDebug.ts';
import type { LessonV2Event } from '../../learn/lessonV2.ts';
import type { GuidedMatchFinalDebrief } from '../../learn/guidedMatch/guidedMatchFinalDebrief.ts';
import { useLearningCoach } from '../../learning/useLearningCoach.ts';
import { buildGuidedCoachPresentation } from './buildGuidedCoachPresentation.ts';
import { computeGuidedCoachTip, computeGuidedScoringTiles } from './computeGuidedCoachTip.ts';
import type {
  UseGuidedMatchRuntimeArgs,
  UseGuidedMatchRuntimeBaseResult,
} from './useGuidedMatchRuntimeTypes.ts';
import { reportOptionalChunkFailure } from '../../utils/optionalChunk';

export type { GuidedPlacementResult } from './guidedPlacementHandlers.ts';
export type { UseGuidedMatchRuntimeArgs, UseGuidedMatchRuntimeBaseResult };
export type { UseGuidedMatchRuntimeResult } from './useGuidedMatchRuntimeTypes.ts';

export function useGuidedMatchRuntime(args: UseGuidedMatchRuntimeArgs): UseGuidedMatchRuntimeBaseResult {
  const {
    boot,
    match,
    userPlayMoves,
    handReveal,
    guidedV2Coordination,
    captureRuntime,
    drawSequenceActive,
    botTurn,
    isTransitioningRef,
    showRecommendation,
    setShowFullCoachTip,
    handActive,
    matchGameOver,
  } = args;

  const {
    isGuidedMode,
    frozenV2Lesson,
    frozenLesson,
    guidedTranscript,
    isGuidedTranscriptMode,
    isGuidedFrozenLessonMode,
    lessonLayoutMode,
    isGuidedV2Mode,
    guidedV2PlaybackReady,
  } = boot;

  const {
    guidedV2EventIndex,
    setGuidedV2EventIndex,
    isGuidedV2OffLine,
    setIsGuidedV2OffLine,
    fritzV2LastAppliedIndexRef,
  } = guidedV2Coordination;

  const [lessonStepIndex, setLessonStepIndex] = useState(() => {
    if (guidedTranscript) return guidedTranscript.turns[0]?.stepIndex ?? 0;
    if (frozenLesson) return getGuidedV1OrderedAuthoredSteps(frozenLesson)[0]?.stepIndex ?? 0;
    return 0;
  });
  const [isOffAuthoredLine, setIsOffAuthoredLine] = useState(false);
  const [guidedV1Replay, setGuidedV1Replay] = useState<{ stepIndex: number; replyIndex: number } | null>(null);

  const [guidedMatchFinalDebrief, setGuidedMatchFinalDebrief] = useState<GuidedMatchFinalDebrief | null>(null);

  useEffect(() => {
    if (!isGuidedV2Mode || match.winnerId !== 'you') {
      setGuidedMatchFinalDebrief(null);
      return;
    }
    let cancelled = false;
    void import('../../learn/guidedMatch/guidedMatchLessonLoader.ts').then((module) => {
      if (!cancelled) {
        setGuidedMatchFinalDebrief(module.getPublicGuidedMatchFinalDebrief());
      }
    })
      .catch((error) => reportOptionalChunkFailure('learn/guidedMatchLessonLoader', error));
    return () => {
      cancelled = true;
    };
  }, [isGuidedV2Mode, match.winnerId]);
  const isGuidedMatchVictoryResult = Boolean(guidedMatchFinalDebrief);

  botMatchDebugLog('[BOTMATCH VERSION]', 'v1-click-debug-001');
  botMatchDebugLog('[mode-debug]', { isGuidedMode, lessonStepIndex });

  const coach = useLearningCoach({ isGuidedMode, match, playerLevel: 'beginner', gameMode: 'guided' });

  const currentV2CursorEvent = useMemo(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return null;
    return frozenV2Lesson.events[guidedV2EventIndex] ?? null;
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine]);

  const currentExpectedV2PlayerEvent = useMemo((): LessonV2Event | null => {
    if (!currentV2CursorEvent || currentV2CursorEvent.actor !== 'player') return null;
    return currentV2CursorEvent;
  }, [currentV2CursorEvent]);

  const guidedCoachTip = useMemo(
    () => computeGuidedCoachTip(match, userPlayMoves, isGuidedMode),
    [isGuidedMode, match, userPlayMoves],
  );
  const guidedScoringTiles = useMemo(
    () => computeGuidedScoringTiles(match, userPlayMoves, isGuidedMode),
    [isGuidedMode, match, userPlayMoves],
  );
  const currentTranscriptTurn = useMemo(() => {
    if (!isGuidedTranscriptMode || !guidedTranscript || match.handOver || match.gameOver) return null;
    return guidedTranscript.turns.find((turn) => turn.stepIndex === lessonStepIndex) ?? null;
  }, [guidedTranscript, isGuidedTranscriptMode, lessonStepIndex, match.gameOver, match.handOver]);
  const currentLessonStep = useMemo(() => {
    if (!isGuidedMode || !frozenLesson || match.handOver || match.gameOver) return null;
    return getGuidedV1AuthoredStepByIndex(frozenLesson, lessonStepIndex);
  }, [isGuidedMode, frozenLesson, match.handOver, match.gameOver, lessonStepIndex]);
  const currentV2CoachingText = useMemo(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return '';
    return currentExpectedV2PlayerEvent?.coachingText ?? '';
  }, [isGuidedV2Mode, frozenV2Lesson, isGuidedV2OffLine, currentExpectedV2PlayerEvent]);

  const coachPresentation = useMemo(
    () => buildGuidedCoachPresentation({
      match, userPlayMoves, handActive, botTurn, drawSequenceActive, handReveal,
      isTransitioning: isTransitioningRef.current, showRecommendation, lessonLayoutMode,
      isGuidedV2Mode, isGuidedV2OffLine, isGuidedTranscriptMode, isGuidedFrozenLessonMode,
      guidedV2PlaybackReady, guidedV2EventIndex, currentV2CursorEvent, currentExpectedV2PlayerEvent,
      currentV2CoachingText, guidedTranscript, frozenLesson, frozenV2Lesson, lessonStepIndex,
      isOffAuthoredLine, currentTranscriptTurn, currentLessonStep,
    }),
    [
      match, userPlayMoves, handActive, botTurn, drawSequenceActive, handReveal, isTransitioningRef,
      showRecommendation, lessonLayoutMode, isGuidedV2Mode, isGuidedV2OffLine, isGuidedTranscriptMode,
      isGuidedFrozenLessonMode, guidedV2PlaybackReady, guidedV2EventIndex, currentV2CursorEvent,
      currentExpectedV2PlayerEvent, currentV2CoachingText, guidedTranscript, frozenLesson, frozenV2Lesson,
      lessonStepIndex, isOffAuthoredLine, currentTranscriptTurn, currentLessonStep,
    ],
  );

  useEffect(() => {
    setShowFullCoachTip(false);
  }, [coachPresentation.lessonCoachVm?.stepIndex, setShowFullCoachTip]);

  useEffect(() => {
    if (!isGuidedMode || !handReveal || matchGameOver) return;
    coach.buildSummary(handReveal.pointsAwarded, match.players.you.score, handReveal.winner === 'you');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handReveal, isGuidedMode, matchGameOver]);

  useEffect(() => {
    if (!isGuidedMode) return;
    coach.resetHand();
    if (frozenLesson && isOffAuthoredLine) {
      console.log(`[guided-fallback] hand ended in fallback = ${match.handNumber - 1}`);
      console.log(`[guided-fallback] resetting fallback on new hand start = ${match.handNumber}`);
      setIsOffAuthoredLine(false);
      const realSteps = frozenLesson.steps.filter((s) => s.chosenMove !== null);
      const firstStepIdx = realSteps.findIndex((s) => s.handNumber === match.handNumber);
      if (firstStepIdx >= 0) {
        console.log(`[guided-fallback] resumed coached mode at step = ${firstStepIdx}`);
        setLessonStepIndex(firstStepIdx);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.handNumber, isGuidedMode, frozenLesson]);

  const { coachingFlags } = coachPresentation;

  return {
    lessonStepIndex,
    setLessonStepIndex,
    isOffAuthoredLine,
    setIsOffAuthoredLine,
    guidedV2EventIndex,
    setGuidedV2EventIndex,
    isGuidedV2OffLine,
    setIsGuidedV2OffLine,
    fritzV2LastAppliedIndexRef,
    guidedV1Replay,
    setGuidedV1Replay,
    currentExpectedV2PlayerEvent,
    guidedMatchCaptureStatus: captureRuntime.guidedMatchCaptureStatus,
    guidedMatchCandidateSaveStatus: captureRuntime.guidedMatchCandidateSaveStatus,
    setGuidedMatchCandidateSaveStatus: captureRuntime.setGuidedMatchCandidateSaveStatus,
    captureGuidedMatchCandidateAction: captureRuntime.captureGuidedMatchCandidateAction,
    captureGuidedMatchCandidateNextHand: captureRuntime.captureGuidedMatchCandidateNextHand,
    saveGuidedMatchCandidate: captureRuntime.saveGuidedMatchCandidate,
    copyGuidedMatchCandidate: captureRuntime.copyGuidedMatchCandidate,
    canSaveGuidedMatchCandidate: captureRuntime.canSaveGuidedMatchCandidate,
    coach,
    guidedCoachTip,
    guidedScoringTiles,
    currentTranscriptTurn,
    currentLessonStep,
    guidedMatchFinalDebrief,
    isGuidedMatchVictoryResult,
    isLessonLayoutMode: lessonLayoutMode,
    isGuidedV2FritzResolving: coachingFlags.isGuidedV2FritzResolving,
    isAwaitingPlayerTurnAction: coachingFlags.isAwaitingPlayerTurnAction,
    showPlayerCoaching: coachingFlags.showPlayerCoaching,
    showFritzCoachingPanel: coachingFlags.showFritzCoachingPanel,
    canPlayCoachedMove: coachingFlags.canPlayCoachedMove,
    lessonRecommendedTileKey: coachPresentation.lessonRecommendedTileKey,
    lessonCoachVm: coachPresentation.lessonCoachVm,
    lessonCoachProgressLabel: coachPresentation.lessonCoachProgressLabel,
    lessonCoachProgressPct: coachPresentation.lessonCoachProgressPct,
    lessonCoachContent: coachPresentation.lessonCoachContent,
    showLessonCoachPanel: coachingFlags.showLessonCoachPanel,
    lessonCoachPanelContent: coachPresentation.lessonCoachPanelContent,
    lessonBoardPlacementMoves: coachPresentation.lessonBoardPlacementMoves,
    showCoachedRecommendation: coachPresentation.showCoachedRecommendation,
    activePlacementMoves: coachPresentation.activePlacementMoves,
  };
}