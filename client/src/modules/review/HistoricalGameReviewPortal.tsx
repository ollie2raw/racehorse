import { lazy, Suspense, useCallback, useEffect, useState, useRef } from 'react';
import {
  fetchRecentGameReviews,
  loadHistoricalGameReview,
  type RecentGameReviewListEntry,
} from './historicalGameReviewApi';
import type { HistoricalGameReviewHydration } from './hydrateHistoricalGameReview';
import { fetchRecentGames, type SavedGameSummary } from './savedGames';
import './HistoricalGameReviewPortal.css';

const GameReviewer = lazy(() => import('../../analyzer/GameReviewer'));
// Replaying a saved game and running the review hook is only needed when a game is opened for analysis.
const SavedGameReview = lazy(() => import('./SavedGameReview'));

type HistoricalGameReviewPortalProps = {
  /**
   * When omitted, the portal probes `/api/game-reviews/access` and only
   * renders the history strip for cohort users.
   */
  enabled?: boolean;
};

const GAMES_SHOWN = 20;

const titleCase = (value: string | null): string => (value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Fritz');

function gameWhen(game: SavedGameSummary): string {
  const date = new Date(game.playedAt ?? game.savedAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The games archive and the review history, on the Rating History page.
 *
 * "Your games": every saved Play vs Fritz game, newest first. A game whose review was already saved reopens instantly
 * (zero recomputation); one that was never analyzed is replayed from its saved record and analyzed on demand, and its
 * review is then saved so the next open is instant. "Recent reviews" keeps older reviews that have no saved game.
 */
export function HistoricalGameReviewPortal({ enabled }: HistoricalGameReviewPortalProps) {
  const [probedAccess, setProbedAccess] = useState<boolean | null>(null);
  const accessEnabled = enabled !== undefined ? enabled : probedAccess === true;

  // null = loading for the current accessEnabled=true session
  const [entries, setEntries] = useState<RecentGameReviewListEntry[] | null>(null);
  const [games, setGames] = useState<SavedGameSummary[] | null>(null);
  const [gamesError, setGamesError] = useState(false);
  const [analyzingGameId, setAnalyzingGameId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hydration, setHydration] = useState<HistoricalGameReviewHydration | null>(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [loadingReview, setLoadingReview] = useState(false);

  // Reset list when access flips on — render-phase adjustment (not an effect).
  const [trackedAccess, setTrackedAccess] = useState(accessEnabled);
  if (accessEnabled !== trackedAccess) {
    setTrackedAccess(accessEnabled);
    if (accessEnabled) {
      setEntries(null);
      setGames(null);
      setListKey((k) => k + 1);
    } else {
      setEntries([]);
      setGames([]);
    }
  }

  useEffect(() => {
    if (enabled !== undefined) return;
    let cancelled = false;
    void import('../../api/client.ts')
      .then(({ apiGet }) => apiGet<{ enabled: boolean }>('/api/game-reviews/access'))
      .then((result) => {
        if (!cancelled) setProbedAccess(result.data?.enabled === true && !result.error);
      })
      .catch(() => {
        if (!cancelled) setProbedAccess(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!accessEnabled) return;
    let cancelled = false;
    void fetchRecentGameReviews(GAMES_SHOWN)
      .then((reviews) => {
        if (!cancelled) setEntries(reviews);
      })
      .catch(() => {
        if (!cancelled) { setEntries([]); setError('Could not load saved reviews. Please try again.'); }
      });
    void fetchRecentGames(GAMES_SHOWN)
      .then((result) => {
        if (cancelled) return;
        setGamesError(!result.ok);
        setGames(result.ok ? result.games : []);
      })
      .catch(() => {
        if (!cancelled) { setGamesError(true); setGames([]); }
      });
    return () => {
      cancelled = true;
    };
  }, [accessEnabled, listKey]);

  const openReview = useCallback((reviewId: string) => {
    const request = ++requestRef.current;
    setLoadingReview(true);
    setError(null);
    void loadHistoricalGameReview(reviewId)
      .then((loaded) => {
        if (request !== requestRef.current) return;
        if (!loaded) {
          setError('Could not load that review.');
          return;
        }
        setHydration(loaded);
        setOpen(true);
        const url = new URL(window.location.href);
        url.searchParams.set('review', reviewId);
        window.history.replaceState(window.history.state, '', url);
      })
      .catch(() => { if (request === requestRef.current) setError('Could not load that review.'); })
      .finally(() => { if (request === requestRef.current) setLoadingReview(false); });
  }, []);

  useEffect(() => {
    if (!accessEnabled) return;
    const restore = () => {
      const reviewId = new URLSearchParams(window.location.search).get('review');
      if (reviewId) openReview(reviewId);
      else setOpen(false);
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => {
      // This counter invalidates asynchronous requests; it is not a DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      ++requestRef.current;
      window.removeEventListener('popstate', restore);
    };
  }, [accessEnabled, openReview]);

  if (!accessEnabled) return null;

  const loadingList = entries === null;
  const allReviews = entries ?? [];
  const loadingGames = games === null;
  const gameRows = games ?? [];

  // A game's saved review, when it has one (with its frozen explanations): that review reopens instantly.
  const reviewIdBySourceMatch = new Map<string, string>();
  for (const review of allReviews) {
    if (review.sourceMatchId && review.hasReplayArtifact && !reviewIdBySourceMatch.has(review.sourceMatchId)) {
      reviewIdBySourceMatch.set(review.sourceMatchId, review.id);
    }
  }
  // Reviews already shown against a game are not listed a second time.
  const listedGameIds = new Set(gameRows.map((game) => game.sourceMatchId));
  const rows = allReviews.filter((review) => !(review.sourceMatchId && listedGameIds.has(review.sourceMatchId)));

  return (
    <>
      <section className="rh-recent-reviews rh-saved-games" aria-label="Your games">
        <p className="rh-recent-reviews__eyebrow">Your games</p>
        {loadingGames ? <p className="rh-recent-reviews__status">Loading…</p> : null}
        {!loadingGames && gameRows.length === 0 && !gamesError ? (
          <p className="rh-recent-reviews__status">No saved games yet. Finish a Play vs Fritz game and it will appear here.</p>
        ) : null}
        <ul className="rh-recent-reviews__list">
          {gameRows.map((game) => {
            const reviewId = reviewIdBySourceMatch.get(game.sourceMatchId);
            const won = game.result.winner === 'you';
            const lost = game.result.winner === 'opponent';
            return (
              <li key={game.sourceMatchId} className="rh-recent-reviews__row">
                <span className="rh-recent-reviews__meta">
                  <strong className={won ? 'rh-saved-games__win' : lost ? 'rh-saved-games__loss' : undefined}>
                    {won ? 'Victory' : lost ? 'Defeat' : 'Final'} {game.result.you}–{game.result.opponent}
                  </strong>
                  {' · '}{titleCase(game.fritzTier)} · {gameWhen(game)}
                  <span className="rh-saved-games__state">{reviewId ? 'Review ready' : 'Not analyzed yet'}</span>
                </span>
                <button
                  type="button"
                  className="dfd__btn rh-recent-reviews__btn"
                  disabled={loadingReview}
                  onClick={() => (reviewId ? openReview(reviewId) : setAnalyzingGameId(game.sourceMatchId))}
                >
                  {reviewId ? 'Review' : 'Analyze'}
                </button>
              </li>
            );
          })}
        </ul>
        {gamesError ? (
          <>
            <p className="rh-recent-reviews__error" role="alert">Could not load your games.</p>
            <button type="button" className="dfd__btn" onClick={() => { setGames(null); setGamesError(false); setListKey((key) => key + 1); }}>
              Try again
            </button>
          </>
        ) : null}
      </section>
      {analyzingGameId ? (
        <Suspense fallback={<p role="status">Loading game…</p>}>
          <SavedGameReview
            sourceMatchId={analyzingGameId}
            onClose={() => {
              setAnalyzingGameId(null);
              // The review may have finished and saved while it was open: refresh so the row now says "Review ready".
              setListKey((key) => key + 1);
            }}
          />
        </Suspense>
      ) : null}
      <section className="rh-recent-reviews" aria-label="Recent game reviews">
        <p className="rh-recent-reviews__eyebrow">Recent reviews</p>
        {loadingList ? <p className="rh-recent-reviews__status">Loading…</p> : null}
        {!loadingList && rows.length === 0 && !error ? (
          <p className="rh-recent-reviews__status">No saved reviews yet.</p>
        ) : null}
        <ul className="rh-recent-reviews__list">
          {rows.map((entry) => (
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
        {error ? <button type="button" className="dfd__btn" disabled={loadingReview} onClick={() => {
          setError(null);
          const reviewId = new URLSearchParams(window.location.search).get('review');
          if (reviewId) openReview(reviewId);
          else { setEntries(null); setListKey((key) => key + 1); }
        }}>Retry</button> : null}
      </section>
      {hydration ? (
        <Suspense fallback={<p role="status">Loading game review…</p>}>
          <GameReviewer
            open={open}
            onClose={() => {
              setOpen(false);
              const url = new URL(window.location.href);
              url.searchParams.delete('review');
              window.history.replaceState(window.history.state, '', url);
            }}
            analysis={hydration.analysis}
            reviewWorkerBatch={hydration.reviewWorkerBatch}
            decisionIdByMoveNumber={hydration.decisionIdByMoveNumber}
            historicalCoachingByDecisionId={
              hydration.hasReplayArtifact ? hydration.historicalCoachingByDecisionId : new Map()
            }
            historicalLegacyNotice={hydration.legacyNotice}
            title="Game Review"
          />
        </Suspense>
      ) : null}
    </>
  );
}
