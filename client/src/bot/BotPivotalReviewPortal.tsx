import React from 'react';
import { PivotalTurnReviewCard } from '../training/pivotalReview/PivotalTurnReviewCard';

import type { PivotalTurnSelection } from '../training/pivotalReview/pivotalTurnSelector';
import type { PivotalTurnReflection } from '../training/pivotalReview/pivotalReviewStorage';

export interface BotPivotalReviewPortalProps {
  enabled: boolean;
  open: boolean;
  selection: PivotalTurnSelection | null;
  onComplete: (reflections: PivotalTurnReflection[]) => void;
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
