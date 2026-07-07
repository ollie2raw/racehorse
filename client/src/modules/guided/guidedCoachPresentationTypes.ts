import type { BotHandReveal, GuidedCoachViewModel } from '../match/types.ts';
import { parseGuidedLessonCoachContent } from './guidedBotMatchHelpers.ts';
import type { AuthoredStep, FrozenLesson, GuidedTranscript, GuidedTurn } from '../../learn/guidedAuthoring.ts';
import type { LessonV2, LessonV2Event } from '../../learn/lessonV2.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { Move } from '../../types.ts';

export type LessonCoachPanelContent = {
  title: string;
  bodyParagraphs: string[];
  previewText: string;
  showMore: boolean;
  showFooter: boolean;
  progressChipLabel: string;
  contextChips: string[];
};

export type GuidedCoachingFlags = {
  isGuidedV2FritzResolving: boolean;
  isAwaitingPlayerTurnAction: boolean;
  showPlayerCoaching: boolean;
  showFritzCoachingPanel: boolean;
  canPlayCoachedMove: boolean;
  showLessonCoachPanel: boolean;
  isHandOverTransitionOpen: boolean;
};

export type GuidedCoachPresentation = {
  activePlacementMoves: Move[];
  coachingFlags: GuidedCoachingFlags;
  lessonRecommendedTileKey: string | null;
  lessonCoachVm: GuidedCoachViewModel | null;
  lessonCoachProgressLabel: string;
  lessonCoachProgressPct: number;
  lessonCoachProgressCount: number;
  lessonCoachContent: ReturnType<typeof parseGuidedLessonCoachContent>;
  lessonCoachBodyText: string;
  lessonCoachPreviewText: string;
  showCoachMoreButton: boolean;
  lessonRecommendedTileLabel: string | null;
  showCoachedRecommendation: boolean;
  lessonBoardPlacementMoves: Move[];
  lessonCoachPanelContent: LessonCoachPanelContent | null;
};

export type BuildGuidedCoachPresentationInput = {
  match: BotMatchState;
  userPlayMoves: Move[];
  handActive: boolean;
  botTurn: boolean;
  drawSequenceActive: boolean;
  handReveal: BotHandReveal | null;
  isTransitioning: boolean;
  showRecommendation: boolean;
  lessonLayoutMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
  isGuidedTranscriptMode: boolean;
  isGuidedFrozenLessonMode: boolean;
  guidedV2PlaybackReady: boolean;
  guidedV2EventIndex: number;
  currentV2CursorEvent: LessonV2Event | null;
  currentExpectedV2PlayerEvent: LessonV2Event | null;
  currentV2CoachingText: string;
  guidedTranscript: GuidedTranscript | null;
  frozenLesson: FrozenLesson | null;
  frozenV2Lesson: LessonV2 | null;
  lessonStepIndex: number;
  isOffAuthoredLine: boolean;
  currentTranscriptTurn: GuidedTurn | null;
  currentLessonStep: AuthoredStep | null | undefined;
};