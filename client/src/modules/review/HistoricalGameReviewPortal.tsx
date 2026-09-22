import React, { useCallback, useEffect, useState } from 'react';
import GameReviewer from '../../analyzer/GameReviewer';
import {
  fetchRecentGameReviews,
  loadHistoricalGameReview,
  type RecentGameReviewListEntry,
} from './historicalGameReviewApi';
import type { HistoricalGameReviewHydration } from './hydrateHistoricalGameReview';
import './HistoricalGameReviewPortal.css';

type HistoricalGameReviewPortalProps = {
  /**
   * When omitted, the portal probes `/api/game-reviews/access` and only
   * renders the history strip for cohort users.
   */
  enabled?: boolean;
};

/**
 * Smallest history entry for F1e-5: list recent persisted reviews and open
 * GameReviewer in historical mode (zero worker / Fritz recomputation).
 */
export function HistoricalGameReviewPortal({ enabled }: HistoricalGameReviewPortalProps) {
  const [accessEnabled, setAccessEnabled] = useState(enabled === true);
  const [entries, setEntries] = useState<RecentGameReviewListEntry[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydration, setHydration] = useState<HistoricalGameReviewHydration | null>(null);
  const [open, setOpen] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);

  useEffect(() => {
    if (enabled !== undefined) {
      setAccessEnabled(enabled);
      return;
    }
    let cancelled = false;
    void import('../../api/client.ts')
      .then(({ apiGet }) => apiGet<{ enabled: boolean }>('/api/game-reviews/access'))
      .then((result) => {
        if (!cancelled) setAccessEnabled(result.data?.enabled === true && !result.error);
      })
      .catch(() => {
        if (!cancelled) setAccessEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!accessEnabled) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoadingList(true);
    void fetchRecentGameReviews(8)
      .then((reviews) => {
        if (!cancelled) setEntries(reviews);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessEnabled]);

  const openReview = useCallback((reviewId: string) => {
    setLoadingReview(true);
    setError(null);
    void loadHistoricalGameReview(reviewId)
      .then((loaded) => {
        if (!loaded) {
          setError('Could not load that review.');
          return;
        }
        setHydration(loaded);
        setOpen(true);
      })
      .catch(() => setError('Could not load that review.'))
      .finally(() => setLoadingReview(false));
  }, []);

  if (!accessEnabled) return null;

  return (
    <>
      <section className="rh-recent-reviews" aria-label="Recent game reviews">
        <p className="rh-recent-reviews__eyebrow">Recent reviews</p>
        {loadingList ? <p className="rh-recent-reviews__status">Loading…</p> : null}
        {!loadingList && entries.length === 0 ? (
          <p className="rh-recent-reviews__status">No saved reviews yet.</p>
        ) : null}
        <ul className="rh-recent-reviews__list">
          {entries.map((entry) => (
            <li key={entry.id} className="rh-recent-reviews__row">
              <span className="rh-recent-reviews__meta">
                {entry.mode.toUpperCase()} · {new Date(entry.createdAt).toLocaleString()}
                {!entry.hasReplayArtifact ? ' · legacy' : ''}
              </span>
              <button
                type="button"
                className="dfd__btn rh-recent-reviews__btn"
                disabled={loadingReview}
                onClick={() => openReview(entry.id)}
              >
                Review Game
              </button>
            </li>
          ))}
        </ul>
        {error ? (
          <p className="rh-recent-reviews__error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
      {hydration ? (
        <GameReviewer
          open={open}
          onClose={() => setOpen(false)}
          analysis={hydration.analysis}
          reviewWorkerBatch={hydration.reviewWorkerBatch}
          decisionIdByMoveNumber={hydration.decisionIdByMoveNumber}
          historicalCoachingByDecisionId={
            hydration.hasReplayArtifact ? hydration.historicalCoachingByDecisionId : new Map()
          }
          historicalLegacyNotice={hydration.legacyNotice}
          title="Game Review"
        />
      ) : null}
    </>
  );
}
