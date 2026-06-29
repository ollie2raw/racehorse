import React from 'react';
import { PivotalTurnReviewCard } from '../training/pivotalReview/PivotalTurnReviewCard';

export interface BotPivotalReviewPortalProps {
  enabled: boolean;
  open: boolean;
  selection: any;
  onComplete: (reflections: any[]) => void;
}

export const BotPivotalReviewPortal: React.FC<BotPivotalReviewPortalProps> = ({
  enabled,
  open,
  selection,
  onComplete,
}) => {
  if (!enabled || !open || !selection) return null;

  return (
    <PivotalTurnReviewCard
      open
      accent="gold"
      selection={selection}
      onComplete={onComplete}
    />
  );
};
