export type RankingSkipReason = 'move_log_verification_failed' | 'duplicate' | 'not_ranked';

export type RankingOutcome = {
  glickoEligible: boolean;
  glickoApplied: boolean;
  skipReason?: RankingSkipReason | null;
};

export const RANKING_NOT_UPDATED_COPY = 'Rating not updated for this match';

export function rankingMessage(applied: boolean): string | null {
  return applied ? null : RANKING_NOT_UPDATED_COPY;
}

export function rankingOutcomeNotRanked(): RankingOutcome {
  return { glickoEligible: false, glickoApplied: false, skipReason: 'not_ranked' };
}

export function rankingOutcomeVerificationSkipped(): RankingOutcome {
  return {
    glickoEligible: false,
    glickoApplied: false,
    skipReason: 'move_log_verification_failed',
  };
}

export function rankingOutcomeApplied(): RankingOutcome {
  return { glickoEligible: true, glickoApplied: true, skipReason: null };
}

export function rankingOutcomeDuplicate(): RankingOutcome {
  return { glickoEligible: true, glickoApplied: false, skipReason: 'duplicate' };
}

export function rankingOutcomeEligibleNotApplied(): RankingOutcome {
  return { glickoEligible: true, glickoApplied: false, skipReason: null };
}
