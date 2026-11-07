import React from 'react';
import { PlayVsFritzResultOverlay } from './PlayVsFritzResultOverlay';
import { buildPostGameReviewView } from './postGameReviewView';
import { formatRatingDelta } from '../modules/ghost/ghostMatchHelpers.ts';

import type { GhostCompletionResult } from '../ghost/api';
import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import type { AppMode } from '../appRouteTypes';
import type { PlayerDecisionLedgerSummary } from '../modules/review/reviewDecisionAccounting';
import type { ReviewUnavailableReason, ReviewWaitState } from '../modules/review/reviewCompletionClient';
import type { ReviewRetryUiState } from '../training/pivotalReview/PostGameReviewPrompt';

export interface BotPostGameCardProps {
  showPlayVsFritzResultOverlay: boolean;
  winnerId: 'you' | 'bot' | null;
  opponentLabel: string;
  youScore: number;
  botScore: number;
  isJourneyTrial: boolean;
  hasConfirmedFritzRatingUpdate: boolean;
  fritzNewGlickoRating: number | null;
  fritzGlickoDelta: number | null;
  ghostResult: GhostCompletionResult | null;
  onNavigate: ((mode: AppMode) => void) | null;
  botPostGameReviewEligible: boolean;
  postGameAnalysisPending: boolean;
  postGameAnalysis: GameAnalysis | null;
  accuracyModelPending: boolean;
  reviewUnavailable?: boolean;
  reviewUnavailableReason?: ReviewUnavailableReason | null;
  reviewWait?: ReviewWaitState | null;
  decisionLedger?: PlayerDecisionLedgerSummary | null;
  reviewRetryState?: ReviewRetryUiState;

  onRematch: () => void;
  onChangeSetup: () => void;
  onHome?: () => void;
  exitJourneyTrial: (success: boolean) => void;
  onReviewGame: () => void;
  onRetryReview?: () => void;
  /** Present for a guest: offers to keep this game by creating an account. */
  onSaveGuestGame?: () => void;
}

export const BotPostGameCard: React.FC<BotPostGameCardProps> = ({
  showPlayVsFritzResultOverlay,
  winnerId,
  opponentLabel,
  youScore,
  botScore,
  isJourneyTrial,
  hasConfirmedFritzRatingUpdate,
  fritzNewGlickoRating,
  fritzGlickoDelta,
  onNavigate,
  botPostGameReviewEligible,
  postGameAnalysisPending,
  postGameAnalysis,
  accuracyModelPending,
  reviewUnavailable = false,
  reviewUnavailableReason = null,
  reviewWait = null,
  decisionLedger = null,
  reviewRetryState = 'idle',
  onRematch,
  onChangeSetup,
  onHome,
  exitJourneyTrial,
  onReviewGame,
  onRetryReview,
  onSaveGuestGame,
}) => {
  if (!showPlayVsFritzResultOverlay) return null;

  const review = isJourneyTrial
    ? null
    : buildPostGameReviewView({
        eligible: botPostGameReviewEligible,
        analysis: postGameAnalysis,
        analysisPending: postGameAnalysisPending,
        accuracyModelPending,
        reviewUnavailable,
        reviewUnavailableReason,
        reviewWait,
        decisionLedger,
        retryAvailable: Boolean(onRetryReview),
        retryState: reviewRetryState,
      });

  // Only a rating change the server has confirmed is shown. A pending sync, a prediction or a missing update shows nothing:
  // the player's rating is in the header, and "syncing…" that never resolves says nothing true.
  const confirmedRating = !isJourneyTrial && hasConfirmedFritzRatingUpdate && fritzGlickoDelta != null && fritzNewGlickoRating != null
    ? `Rating ${formatRatingDelta(fritzGlickoDelta)} · ${fritzNewGlickoRating}`
    : null;

  return (
    <PlayVsFritzResultOverlay
      won={winnerId === 'you'}
      opponentLabel={opponentLabel}
      youScore={youScore}
      botScore={botScore}
      ratingSlot={confirmedRating ?? undefined}
      onRematch={onRematch}
      onChangeSetup={onChangeSetup}
      onHome={onHome}
      showHome={Boolean(onNavigate)}
      customActions={
        isJourneyTrial
          ? winnerId === 'you'
            ? [
                {
                  label: 'Continue Trail',
                  onClick: () => exitJourneyTrial(true),
                  variant: 'primary',
                },
                { label: 'Try Again', onClick: onRematch, variant: 'secondary' },
              ]
            : [
                { label: 'Try Again', onClick: onRematch, variant: 'primary' },
                {
                  label: 'Return to Trail',
                  onClick: () => exitJourneyTrial(false),
                  variant: 'secondary',
                },
              ]
          : undefined
      }
      review={review}
      onReviewGame={onReviewGame}
      onRetryReview={onRetryReview}
      savePrompt={
        onSaveGuestGame && !isJourneyTrial
          ? {
              text: 'Keep this game and your history: create an account. Nothing you have played is lost.',
              actionLabel: 'Create account',
              // Leave this card first (back to setup), so the sign-up sheet opens over a normal screen, not under it.
              onAction: () => {
                onChangeSetup();
                onSaveGuestGame();
              },
            }
          : undefined
      }
    />
  );
};
