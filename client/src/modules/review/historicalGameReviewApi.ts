import { apiGet } from '../../api/client.ts';
import type { GameReviewReadPayload } from './hydrateHistoricalGameReview';
import {
  hydrateHistoricalGameReview,
  type HistoricalGameReviewHydration,
} from './hydrateHistoricalGameReview';

export type RecentGameReviewListEntry = {
  readonly id: string;
  readonly gameDigest: string;
  readonly sourceMatchId: string | null;
  readonly mode: string;
  readonly createdAt: string;
  readonly hasReplayArtifact: boolean;
};

/** Exact review-id fetch — never “latest”. */
export async function fetchGameReviewById(reviewId: string): Promise<GameReviewReadPayload | null> {
  const result = await apiGet<GameReviewReadPayload>(
    `/api/game-reviews/by-id/${encodeURIComponent(reviewId)}`,
  );
  if (result.error || !result.data) return null;
  return result.data;
}

export async function fetchRecentGameReviews(
  limit = 10,
): Promise<RecentGameReviewListEntry[]> {
  const result = await apiGet<{ reviews: RecentGameReviewListEntry[] }>(
    `/api/game-reviews/recent?limit=${Math.max(1, Math.min(20, Math.floor(limit)))}`,
  );
  if (result.error || !result.data?.reviews) return [];
  return result.data.reviews;
}

export async function loadHistoricalGameReview(
  reviewId: string,
): Promise<HistoricalGameReviewHydration | null> {
  const payload = await fetchGameReviewById(reviewId);
  if (!payload) return null;
  return hydrateHistoricalGameReview(payload);
}
