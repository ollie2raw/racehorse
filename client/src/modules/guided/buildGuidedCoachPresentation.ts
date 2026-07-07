import {
  buildCoachPreviewText,
  formatLessonTileLabel,
  getGuidedV1OrderedAuthoredSteps,
  parseGuidedLessonCoachContent,
} from './guidedBotMatchHelpers.ts';
import type { BotHandReveal, GuidedCoachViewModel } from '../match/types.ts';
import { GUIDED_COACH_MORE_MIN_EXTRA_CHARS } from '../match/types.ts';
import type { AuthoredStep, FrozenLesson, GuidedTranscript, GuidedTurn } from '../../learn/guidedAuthoring.ts';
import type { LessonV2, LessonV2Event } from '../../learn/lessonV2.ts';
import { toTileKey } from '../../game/tileKeys.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { Move } from '../../types.ts';
import type {
  BuildGuidedCoachPresentationInput,
  GuidedCoachPresentation,
  GuidedCoachingFlags,
  LessonCoachPanelContent,
} from './guidedCoachPresentationTypes.ts';

export type {
  BuildGuidedCoachPresentationInput,
  GuidedCoachPresentation,
  GuidedCoachingFlags,
  LessonCoachPanelContent,
} from './guidedCoachPresentationTypes.ts';

export function computeActivePlacementMoves(
  isGuidedV2Mode: boolean,
  isGuidedV2OffLine: boolean,
  currentExpectedV2PlayerEvent: LessonV2Event | null,
  userPlayMoves: Move[],
): Move[] {
  return isGuidedV2Mode && !isGuidedV2OffLine && currentExpectedV2PlayerEvent?.action === 'play'
    ? userPlayMoves.filter((move) => {
        if (!move.tile || !currentExpectedV2PlayerEvent.tile) return false;
        if (toTileKey(move.tile) !== currentExpectedV2PlayerEvent.tile) return false;
        if (currentExpectedV2PlayerEvent.position) {
          return move.position === currentExpectedV2PlayerEvent.position;
        }
        return true;
      })
    : userPlayMoves;
}

export function buildGuidedCoachingFlags(input: {
  match: BotMatchState;
  handActive: boolean;
  botTurn: boolean;
  drawSequenceActive: boolean;
  handReveal: BotHandReveal | null;
  isTransitioning: boolean;
  lessonLayoutMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
  currentV2CursorEvent: LessonV2Event | null;
}): GuidedCoachingFlags {
  const {
    match,
    handActive,
    botTurn,
    drawSequenceActive,
    handReveal,
    isTransitioning,
    lessonLayoutMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    currentV2CursorEvent,
  } = input;

  const isGuidedV2FritzResolving =
    isGuidedV2Mode &&
    !isGuidedV2OffLine &&
    currentV2CursorEvent?.actor === 'fritz';

  const isHandOverTransitionOpen = Boolean(handReveal) || isTransitioning;

  const isAwaitingPlayerTurnAction =
    handActive &&
    match.currentPlayer === 'you' &&
    !botTurn &&
    !drawSequenceActive &&
    !handReveal &&
    !isTransitioning &&
    !isGuidedV2FritzResolving &&
    (!isGuidedV2Mode || isGuidedV2OffLine || currentV2CursorEvent?.actor === 'player');

  const showPlayerCoaching =
    lessonLayoutMode &&
    isAwaitingPlayerTurnAction &&
    !match.handOver &&
    !match.gameOver &&
    !isHandOverTransitionOpen;

  const showFritzCoachingPanel =
    lessonLayoutMode &&
    !showPlayerCoaching &&
    !isHandOverTransitionOpen &&
    !match.gameOver &&
    (isGuidedV2FritzResolving || (botTurn && !drawSequenceActive));

  const canPlayCoachedMove = showPlayerCoaching;

  const showLessonCoachPanel =
    lessonLayoutMode &&
    !match.gameOver;

  return {
    isGuidedV2FritzResolving,
    isAwaitingPlayerTurnAction,
    showPlayerCoaching,
    showFritzCoachingPanel,
    canPlayCoachedMove,
    showLessonCoachPanel,
    isHandOverTransitionOpen,
  };
}

export function buildLessonCoachVm(input: {
  showLessonCoachPanel: boolean;
  showPlayerCoaching: boolean;
  isGuidedTranscriptMode: boolean;
  guidedTranscript: GuidedTranscript | null;
  lessonStepIndex: number;
  isOffAuthoredLine: boolean;
  currentTranscriptTurn: GuidedTurn | null;
  isGuidedFrozenLessonMode: boolean;
  frozenLesson: FrozenLesson | null;
  currentLessonStep: AuthoredStep | null | undefined;
  guidedV2PlaybackReady: boolean;
  frozenV2Lesson: LessonV2 | null;
  guidedV2EventIndex: number;
  currentV2CoachingText: string;
  currentExpectedV2PlayerEvent: LessonV2Event | null;
  isGuidedV2OffLine: boolean;
  userPlayMoves: Move[];
}): GuidedCoachViewModel | null {
  const {
    showLessonCoachPanel,
    showPlayerCoaching,
    isGuidedTranscriptMode,
    guidedTranscript,
    lessonStepIndex,
    isOffAuthoredLine,
    currentTranscriptTurn,
    isGuidedFrozenLessonMode,
    frozenLesson,
    currentLessonStep,
    guidedV2PlaybackReady,
    frozenV2Lesson,
    guidedV2EventIndex,
    currentV2CoachingText,
    currentExpectedV2PlayerEvent,
    isGuidedV2OffLine,
    userPlayMoves,
  } = input;

  if (!showLessonCoachPanel) return null;

  if (isGuidedTranscriptMode && guidedTranscript) {
    return {
      stepIndex: lessonStepIndex,
      totalSteps: guidedTranscript.turns.length,
      coachingText: showPlayerCoaching ? (currentTranscriptTurn?.coachingText ?? '') : '',
      canBestMove:
        showPlayerCoaching &&
        !isOffAuthoredLine &&
        currentTranscriptTurn?.expectedPlayerMove.type === 'play' &&
        userPlayMoves.length > 0,
      isOffAuthoredLine,
    };
  }
  if (isGuidedFrozenLessonMode && frozenLesson) {
    return {
      stepIndex: lessonStepIndex,
      totalSteps: getGuidedV1OrderedAuthoredSteps(frozenLesson).length,
      coachingText: showPlayerCoaching ? (currentLessonStep?.coachingText ?? '') : '',
      canBestMove: Boolean(
        showPlayerCoaching &&
        !isOffAuthoredLine &&
        currentLessonStep?.chosenMove &&
        currentLessonStep.chosenMove !== 'draw' &&
        currentLessonStep.chosenMove !== 'pass' &&
        userPlayMoves.length > 0,
      ),
      isOffAuthoredLine,
    };
  }
  if (guidedV2PlaybackReady && frozenV2Lesson) {
    const totalPlayerPlays = frozenV2Lesson.events.filter(
      (event) => event.actor === 'player' && event.action === 'play',
    ).length;
    return {
      stepIndex: frozenV2Lesson.events
        .slice(0, guidedV2EventIndex)
        .filter((event) => event.actor === 'player' && event.action === 'play').length,
      totalSteps: Math.max(totalPlayerPlays, 1),
      coachingText: showPlayerCoaching ? currentV2CoachingText : '',
      coachingSummary: showPlayerCoaching
        ? currentExpectedV2PlayerEvent?.coachingSummary
        : undefined,
      canBestMove: Boolean(
        showPlayerCoaching &&
        !isGuidedV2OffLine &&
        currentExpectedV2PlayerEvent &&
        currentExpectedV2PlayerEvent.actor === 'player' &&
        currentExpectedV2PlayerEvent.action === 'play' &&
        currentExpectedV2PlayerEvent.tile &&
        userPlayMoves.some(
          (move) => move.tile && toTileKey(move.tile) === currentExpectedV2PlayerEvent.tile,
        )
      ),
      isOffAuthoredLine: isGuidedV2OffLine,
    };
  }
  return null;
}

export function buildLessonRecommendedTileKey(input: {
  showPlayerCoaching: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
  currentExpectedV2PlayerEvent: LessonV2Event | null;
  isGuidedTranscriptMode: boolean;
  currentTranscriptTurn: GuidedTurn | null;
  isGuidedFrozenLessonMode: boolean;
  currentLessonStep: AuthoredStep | null | undefined;
}): string | null {
  const {
    showPlayerCoaching,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    currentExpectedV2PlayerEvent,
    isGuidedTranscriptMode,
    currentTranscriptTurn,
    isGuidedFrozenLessonMode,
    currentLessonStep,
  } = input;

  if (!showPlayerCoaching) return null;
  if (isGuidedV2Mode && !isGuidedV2OffLine) {
    return currentExpectedV2PlayerEvent?.action === 'play'
      ? currentExpectedV2PlayerEvent.tile ?? null
      : null;
  }
  if (isGuidedTranscriptMode) {
    return currentTranscriptTurn?.expectedPlayerMove.type === 'play' && currentTranscriptTurn.expectedPlayerMove.tile
      ? currentTranscriptTurn.expectedPlayerMove.tile
      : null;
  }
  if (isGuidedFrozenLessonMode && currentLessonStep?.chosenMove) {
    return currentLessonStep.chosenMove.split(':')[0]?.replace('|', '-') ?? null;
  }
  return null;
}

export function buildLessonCoachPanelContent(input: {
  lessonCoachVm: GuidedCoachViewModel | null;
  lessonCoachProgressLabel: string;
  lessonCoachProgressCount: number;
  showFritzCoachingPanel: boolean;
  isHandOverTransitionOpen: boolean;
  showPlayerCoaching: boolean;
  lessonCoachContent: ReturnType<typeof parseGuidedLessonCoachContent>;
  lessonCoachPreviewText: string;
  showCoachMoreButton: boolean;
  currentExpectedV2PlayerEvent: LessonV2Event | null;
  lessonRecommendedTileLabel: string | null;
}): LessonCoachPanelContent | null {
  const {
    lessonCoachVm,
    lessonCoachProgressLabel,
    lessonCoachProgressCount,
    showFritzCoachingPanel,
    isHandOverTransitionOpen,
    showPlayerCoaching,
    lessonCoachContent,
    lessonCoachPreviewText,
    showCoachMoreButton,
    currentExpectedV2PlayerEvent,
    lessonRecommendedTileLabel,
  } = input;

  if (!lessonCoachVm) return null;
  if (lessonCoachVm.isOffAuthoredLine) {
    return {
      title: 'Live position',
      bodyParagraphs: [
        'You went off the authored line. This hand continues live from here, so the coaching now follows the live position.',
      ],
      previewText: '',
      showMore: false,
      showFooter: false,
      progressChipLabel: lessonCoachProgressLabel,
      contextChips: [],
    };
  }
  if (showFritzCoachingPanel) {
    return {
      title: 'Fritz is playing',
      bodyParagraphs: [
        'Watch the board change. Your next coaching tip appears when it is your turn.',
      ],
      previewText: '',
      showMore: false,
      showFooter: false,
      progressChipLabel: 'Fritz turn',
      contextChips: ['Fritz turn'],
    };
  }
  if (isHandOverTransitionOpen) {
    return {
      title: 'Hand complete',
      bodyParagraphs: ['Review the hand result, then continue when you are ready.'],
      previewText: '',
      showMore: false,
      showFooter: false,
      progressChipLabel: lessonCoachProgressLabel,
      contextChips: [],
    };
  }
  if (showPlayerCoaching) {
    return {
      title: lessonCoachContent.title,
      bodyParagraphs: lessonCoachContent.bodyParagraphs,
      previewText: lessonCoachPreviewText,
      showMore: showCoachMoreButton,
      showFooter: true,
      progressChipLabel: lessonCoachProgressLabel,
      contextChips: [
        currentExpectedV2PlayerEvent ? `Hand ${currentExpectedV2PlayerEvent.handNumber}` : '',
        `Move ${lessonCoachProgressCount}`,
        lessonRecommendedTileLabel ? `Play ${lessonRecommendedTileLabel}` : '',
      ].filter(Boolean),
    };
  }
  return {
    title: 'Guided Match',
    bodyParagraphs: ['Coaching will appear when it is your turn to play.'],
    previewText: '',
    showMore: false,
    showFooter: false,
    progressChipLabel: lessonCoachProgressLabel,
    contextChips: [],
  };
}

export function buildGuidedCoachPresentation(input: BuildGuidedCoachPresentationInput): GuidedCoachPresentation {
  const activePlacementMoves = computeActivePlacementMoves(
    input.isGuidedV2Mode,
    input.isGuidedV2OffLine,
    input.currentExpectedV2PlayerEvent,
    input.userPlayMoves,
  );

  const coachingFlags = buildGuidedCoachingFlags({
    match: input.match,
    handActive: input.handActive,
    botTurn: input.botTurn,
    drawSequenceActive: input.drawSequenceActive,
    handReveal: input.handReveal,
    isTransitioning: input.isTransitioning,
    lessonLayoutMode: input.lessonLayoutMode,
    isGuidedV2Mode: input.isGuidedV2Mode,
    isGuidedV2OffLine: input.isGuidedV2OffLine,
    currentV2CursorEvent: input.currentV2CursorEvent,
  });

  const lessonCoachVm = buildLessonCoachVm({
    showLessonCoachPanel: coachingFlags.showLessonCoachPanel,
    showPlayerCoaching: coachingFlags.showPlayerCoaching,
    isGuidedTranscriptMode: input.isGuidedTranscriptMode,
    guidedTranscript: input.guidedTranscript,
    lessonStepIndex: input.lessonStepIndex,
    isOffAuthoredLine: input.isOffAuthoredLine,
    currentTranscriptTurn: input.currentTranscriptTurn,
    isGuidedFrozenLessonMode: input.isGuidedFrozenLessonMode,
    frozenLesson: input.frozenLesson,
    currentLessonStep: input.currentLessonStep,
    guidedV2PlaybackReady: input.guidedV2PlaybackReady,
    frozenV2Lesson: input.frozenV2Lesson,
    guidedV2EventIndex: input.guidedV2EventIndex,
    currentV2CoachingText: input.currentV2CoachingText,
    currentExpectedV2PlayerEvent: input.currentExpectedV2PlayerEvent,
    isGuidedV2OffLine: input.isGuidedV2OffLine,
    userPlayMoves: input.userPlayMoves,
  });

  const lessonCoachProgressCount = lessonCoachVm ? Math.max(lessonCoachVm.stepIndex, 0) + 1 : 1;
  const lessonCoachProgressTotal = lessonCoachVm ? Math.max(lessonCoachVm.totalSteps, 1) : 1;
  const lessonCoachProgressLabel = `${lessonCoachProgressCount} / ${lessonCoachProgressTotal}`;
  const lessonCoachProgressPct = lessonCoachVm
    ? Math.max(0, Math.min(100, (lessonCoachProgressCount / lessonCoachProgressTotal) * 100))
    : 0;

  const lessonCoachContent = parseGuidedLessonCoachContent(
    lessonCoachVm?.coachingText ?? '',
    lessonCoachVm?.coachingSummary,
  );
  const lessonCoachBodyText = lessonCoachContent.bodyParagraphs.join('\n\n');
  const lessonCoachPreviewText = buildCoachPreviewText(lessonCoachBodyText, lessonCoachContent.summary);

  const showCoachMoreButton = (() => {
    if (!coachingFlags.showPlayerCoaching || lessonCoachVm?.isOffAuthoredLine) return false;
    const body = lessonCoachBodyText.trim();
    if (!body) return false;
    return body.length > lessonCoachPreviewText.length + GUIDED_COACH_MORE_MIN_EXTRA_CHARS;
  })();

  const lessonRecommendedTileKey = buildLessonRecommendedTileKey({
    showPlayerCoaching: coachingFlags.showPlayerCoaching,
    isGuidedV2Mode: input.isGuidedV2Mode,
    isGuidedV2OffLine: input.isGuidedV2OffLine,
    currentExpectedV2PlayerEvent: input.currentExpectedV2PlayerEvent,
    isGuidedTranscriptMode: input.isGuidedTranscriptMode,
    currentTranscriptTurn: input.currentTranscriptTurn,
    isGuidedFrozenLessonMode: input.isGuidedFrozenLessonMode,
    currentLessonStep: input.currentLessonStep,
  });

  const lessonRecommendedTileLabel = formatLessonTileLabel(lessonRecommendedTileKey);
  const showCoachedRecommendation =
    coachingFlags.showPlayerCoaching &&
    input.showRecommendation &&
    Boolean(lessonCoachVm?.canBestMove);

  const lessonBoardPlacementMoves = coachingFlags.showPlayerCoaching ? activePlacementMoves : [];

  const lessonCoachPanelContent = buildLessonCoachPanelContent({
    lessonCoachVm,
    lessonCoachProgressLabel,
    lessonCoachProgressCount,
    showFritzCoachingPanel: coachingFlags.showFritzCoachingPanel,
    isHandOverTransitionOpen: coachingFlags.isHandOverTransitionOpen,
    showPlayerCoaching: coachingFlags.showPlayerCoaching,
    lessonCoachContent,
    lessonCoachPreviewText,
    showCoachMoreButton,
    currentExpectedV2PlayerEvent: input.currentExpectedV2PlayerEvent,
    lessonRecommendedTileLabel,
  });

  return {
    activePlacementMoves,
    coachingFlags,
    lessonRecommendedTileKey,
    lessonCoachVm,
    lessonCoachProgressLabel,
    lessonCoachProgressPct,
    lessonCoachProgressCount,
    lessonCoachContent,
    lessonCoachBodyText,
    lessonCoachPreviewText,
    showCoachMoreButton,
    lessonRecommendedTileLabel,
    showCoachedRecommendation,
    lessonBoardPlacementMoves,
    lessonCoachPanelContent,
  };
}