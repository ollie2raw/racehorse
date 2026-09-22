/**
 * Review-instance bag for canonical coaching facts.
 *
 * Owned by the post-game / multiplayer review runtime so the map survives
 * GameReviewer remount (close → reopen) within the same review. Values are
 * published once by the analyzer resolver and must not be replaced.
 *
 * Deliberately lives outside `client/src/analyzer` so BotMatchScreen's eager
 * graph can own the store with only a type-only import of ReviewCoachingFacts.
 */
export type ReviewCoachingFactsStore<T = unknown> = {
  readonly reviewIdentity: string;
  readonly byDecisionId: Map<string, T>;
};

export function createReviewCoachingFactsStore<T = unknown>(
  reviewIdentity: string,
): ReviewCoachingFactsStore<T> {
  return { reviewIdentity, byDecisionId: new Map() };
}
