/**
 * Server-owned rollout gate for post-game reviews.
 *
 * The value is a comma-separated list of exact Supabase user IDs. Keeping
 * this parser pure makes the rollout policy easy to test without coupling
 * tests to process-global environment state.
 */
export const GAME_REVIEW_COHORT_ENV = 'POST_GAME_REVIEW_COHORT_USER_IDS';

export function parseGameReviewCohortUserIds(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
}

export function isGameReviewCohortUser(
  userId: string | null | undefined,
  configuredValue = process.env[GAME_REVIEW_COHORT_ENV],
): boolean {
  if (!userId) return false;
  return parseGameReviewCohortUserIds(configuredValue).has(userId);
}
