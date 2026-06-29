import React from 'react';
import { PivotalReviewSummary } from '../training/pivotalReview/PivotalReviewSummary';
import { PostGameReviewPrompt } from '../training/pivotalReview/PostGameReviewPrompt';

export interface BotReviewSummaryPortalProps {
  pivotalReviewWizardEnabled: boolean;
  pivotalReviewSummary: any;
  pivotalSelection: any;
  postGameAnalysis: any;
  opponentLabel: string;
  showPostGameReviewPrompt: boolean;
  winnerId: 'you' | 'bot' | null;
  youScore: number;
  opponentScore: number;

  onSavePivotalReviewSummary: () => void;
  onOpenHandScopedReview: (handNumber: number) => void;
  onOpenReviewGameFromPrompt: () => void;
  onSkipPostGameReview: () => void;
}

export const BotReviewSummaryPortal: React.FC<BotReviewSummaryPortalProps> = ({
  pivotalReviewWizardEnabled,
  pivotalReviewSummary,
  pivotalSelection,
  postGameAnalysis,
  opponentLabel,
  showPostGameReviewPrompt,
  winnerId,
  youScore,
  opponentScore,
  onSavePivotalReviewSummary,
  onOpenHandScopedReview,
  onOpenReviewGameFromPrompt,
  onSkipPostGameReview,
}) => {
  return (
    <>
      {pivotalReviewWizardEnabled && pivotalReviewSummary && pivotalSelection ? (
        <PivotalReviewSummary
          open
          accent="gold"
          session={pivotalReviewSummary}
          candidates={pivotalSelection.candidates}
          onSaveAndClose={onSavePivotalReviewSummary}
          onSelectHand={onOpenHandScopedReview}
          hands={postGameAnalysis?.hands ?? []}
          worstHandNumber={postGameAnalysis?.worstHandNumber ?? null}
          opponentLabel={opponentLabel}
        />
      ) : null}
      {showPostGameReviewPrompt && postGameAnalysis ? (
        <PostGameReviewPrompt
          open
          accent="gold"
          modeLabel="Play vs Fritz"
          resultLabel={winnerId === 'you' ? 'Victory' : 'Defeat'}
          won={winnerId === 'you'}
          youScore={youScore}
          opponentScore={opponentScore}
          opponentLabel={opponentLabel}
          analysis={postGameAnalysis}
          onReviewGame={onOpenReviewGameFromPrompt}
          onSkip={onSkipPostGameReview}
        />
      ) : null}
    </>
  );
};
