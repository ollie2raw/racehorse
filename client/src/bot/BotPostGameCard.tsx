import React from 'react';
import { PlayVsFritzResultOverlay } from './PlayVsFritzResultOverlay';
import { formatRatingDelta } from '../modules/ghost/ghostMatchHelpers.ts';

import type { GhostCompletionResult } from '../ghost/api';
import type { GameAnalysis } from '../analyzer/moveAnalyzer';
import type { AppMode } from '../appRouteTypes';

export interface BotPostGameCardProps {
  showPlayVsFritzResultOverlay: boolean;
  winnerId: 'you' | 'bot' | null;
  opponentLabel: string;
  dealSize: number;
  youScore: number;
  botScore: number;
  isJourneyTrial: boolean;
  ghostResultLoading: boolean;
  ghostResultError: string | null;
  hasConfirmedFritzRatingUpdate: boolean;
  fritzNewGlickoRating: number | null;
  showFritzRatingSyncing: boolean;
  currentGlickoRating: number | null;
  matchStartGlickoRating: number | null;
  fritzGlickoDelta: number | null;
  ghostResult: GhostCompletionResult | null;
  onNavigate: ((mode: AppMode) => void) | null;
  botPostGameReviewEligible: boolean;
  postGameAnalysisPending: boolean;
  postGameAnalysis: GameAnalysis | null;
  showPostGameReviewPrompt: boolean;

  onRematch: () => void;
  onChangeSetup: () => void;
  onHome?: () => void;
  exitJourneyTrial: (success: boolean) => void;
  onReviewGame: () => void;
}

export const BotPostGameCard: React.FC<BotPostGameCardProps> = ({
  showPlayVsFritzResultOverlay,
  winnerId,
  opponentLabel,
  dealSize,
  youScore,
  botScore,
  isJourneyTrial,
  ghostResultLoading,
  ghostResultError,
  hasConfirmedFritzRatingUpdate,
  fritzNewGlickoRating,
  showFritzRatingSyncing,
  currentGlickoRating,
  matchStartGlickoRating,
  fritzGlickoDelta,
  ghostResult,
  onNavigate,
  botPostGameReviewEligible,
  postGameAnalysisPending,
  postGameAnalysis,
  showPostGameReviewPrompt,
  onRematch,
  onChangeSetup,
  onHome,
  exitJourneyTrial,
  onReviewGame,
}) => {
  if (!showPlayVsFritzResultOverlay) return null;

  return (
    <PlayVsFritzResultOverlay
      won={winnerId === 'you'}
      opponentLabel={opponentLabel}
      dealSize={dealSize}
      youScore={youScore}
      botScore={botScore}
      ratingSlot={
        isJourneyTrial ? undefined : ghostResultLoading || ghostResultError || hasConfirmedFritzRatingUpdate || fritzNewGlickoRating != null ? (
          <div className="df-result-meta-pill">
            <span className="df-result-meta-label">Rating</span>
            <span className="df-result-meta-value">
              {showFritzRatingSyncing
                ? (currentGlickoRating ?? matchStartGlickoRating) != null
                  ? `${Math.round(Number(currentGlickoRating ?? matchStartGlickoRating))}  •  syncing...`
                  : 'Syncing...'
                : fritzGlickoDelta != null && fritzNewGlickoRating != null
                  ? `${formatRatingDelta(fritzGlickoDelta)}  •  ${fritzNewGlickoRating}`
                  : fritzNewGlickoRating != null
                    ? `${fritzNewGlickoRating}`
                    : ghostResultError
                      ? ghostResultError
                      : ghostResult
                        ? 'Saved, rating unavailable'
                        : 'Rating unavailable'}
            </span>
          </div>
        ) : undefined
      }
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
      statusNote={
        botPostGameReviewEligible && postGameAnalysisPending && !postGameAnalysis
          ? 'Analyzing your game…'
          : undefined
      }
      showReviewGame={botPostGameReviewEligible && postGameAnalysis != null && !showPostGameReviewPrompt}
      onReviewGame={onReviewGame}
    />
  );
};
