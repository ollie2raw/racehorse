import { useState } from 'react';
import {
  isBotPostGameReviewEligible,
  isReviewCaptureEnabled,
} from '../../training/pivotalReview/postGameReviewPolicy.ts';
import { PIVOTAL_REVIEW_WIZARD_ENABLED } from '../match/types.ts';
import { usePostGamePivotalReview } from './usePostGamePivotalReview.ts';
import { ReviewSnapshotRecorder } from './ReviewSnapshotRecorder.ts';
import { useAuth } from '../../auth/useAuth.ts';
import { usePostGameReviewAccess } from '../../training/pivotalReview/usePostGameReviewAccess.ts';
import { createLocalMatchId } from '../match/hooks/useBotMatchBootstrap.ts';
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
    isJourneyTrial,
  } = bootstrap;

  const { user: authUser, loading: authLoading } = useAuth();
  const serverCohortEnabled = usePostGameReviewAccess(authUser?.id, authLoading);

  const reviewModeContext = {
    mode: bootstrap.mode,
    isGhostMode,
    isDailyFritzMode,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isJourneyTrial,
  };

  const botPostGameReviewEligible = isBotPostGameReviewEligible({
    ...reviewModeContext,
    serverCohortEnabled,
  });

  const reviewCaptureEnabled = isReviewCaptureEnabled(reviewModeContext);

  // Stable session bag — read via recorder.getSnapshots() outside render (A5/A6).
  const [reviewSnapshotRecorder] = useState(() => {
    const sessionId = createLocalMatchId();
    return new ReviewSnapshotRecorder({ sessionId, gameId: sessionId });
  });

  // E1 (game-review-oracle-upgrade-2026-09-13.md, Phase E): a stable
  // per-match identifier, generated once at the earliest available
  // match-start point -- the same lazy useState initializer pattern
  // sessionId above already uses -- mirroring MP's room-code generation
  // (createRoomCommandRequestId, roomTransport.ts). Deliberately a separate
  // value from sessionId/gameId above: those key the in-memory
  // review-capture session itself (decisionId construction), this
  // identifies the real match a persisted game_reviews row belongs to.
  const [sourceMatchId] = useState(() => createLocalMatchId());

  const review = usePostGamePivotalReview({
    match,
    moveLog: [...moveLog],
    botPostGameReviewEligible,
    fritzTier,
    winningScore,
    showPostGameOverlays,
    reviewSnapshotRecorder,
    reviewCaptureEnabled,
    sourceMatchId,
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
    reviewCaptureEnabled,
    reviewSnapshotRecorder,
    showPostGameReviewPrompt,
    showPlayVsFritzResultOverlay,
  };
}

export type UseReviewRuntimeResult = ReturnType<typeof useReviewRuntime>;
