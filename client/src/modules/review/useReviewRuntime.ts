import { isBotPostGameReviewEligible } from '../../training/pivotalReview/postGameReviewPolicy.ts';
import { PIVOTAL_REVIEW_WIZARD_ENABLED } from '../match/types.ts';
import { usePostGamePivotalReview } from './usePostGamePivotalReview.ts';
import type { BotMatchScreenProps } from '../match/types.ts';
import type { UseBotMatchBootstrapResult } from '../match/hooks/useBotMatchBootstrap.ts';
import type { UseGuidedLessonBootResult } from '../guided/index.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';

export type UseReviewRuntimeArgs = {
  props: BotMatchScreenProps;
  bootstrap: UseBotMatchBootstrapResult;
  guidedBoot: UseGuidedLessonBootResult;
  moveLog: readonly MoveEntry[];
};

export function useReviewRuntime({
  props,
  bootstrap,
  guidedBoot,
  moveLog,
}: UseReviewRuntimeArgs) {
  const { fritzTier = 'elite', winningScore = 60 } = props;
  const { match, showPostGameOverlays, isPlayVsFritzGameOver } = bootstrap;
  const {
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
  } = guidedBoot;

  const {
    isGhostMode,
    isDailyFritzMode,
    isDailyPuzzleRun,
    isJourneyTrial,
  } = bootstrap;

  const botPostGameReviewEligible = isBotPostGameReviewEligible({
    mode: bootstrap.mode,
    isGhostMode,
    isDailyFritzMode,
    isDailyPuzzleRun,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isJourneyTrial,
  });

  const review = usePostGamePivotalReview({
    match,
    moveLog: [...moveLog],
    botPostGameReviewEligible,
    fritzTier,
    winningScore,
    showPostGameOverlays,
  });

  const showPostGameReviewPrompt =
    showPostGameOverlays &&
    botPostGameReviewEligible &&
    review.postGameAnalysis != null &&
    !review.postGameReviewDismissed &&
    !(PIVOTAL_REVIEW_WIZARD_ENABLED && review.pivotalReviewOpen) &&
    !(PIVOTAL_REVIEW_WIZARD_ENABLED && review.pivotalReviewSummary);

  const showPlayVsFritzResultOverlay =
    showPostGameOverlays &&
    isPlayVsFritzGameOver &&
    !(PIVOTAL_REVIEW_WIZARD_ENABLED && review.pivotalReviewOpen) &&
    !(PIVOTAL_REVIEW_WIZARD_ENABLED && review.pivotalReviewSummary);

  return {
    ...review,
    botPostGameReviewEligible,
    showPostGameReviewPrompt,
    showPlayVsFritzResultOverlay,
  };
}

export type UseReviewRuntimeResult = ReturnType<typeof useReviewRuntime>;