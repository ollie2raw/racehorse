import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  fetchRecentGameReviews,
  loadHistoricalGameReview,
  type RecentGameReviewListEntry,
} from './historicalGameReviewApi';
import type { HistoricalGameReviewHydration } from './hydrateHistoricalGameReview';
import {
  NO_FILTERS,
  computeArchiveStats,
  filterGames,
  formatAccuracy,
  tiersPresent,
  titleCase,
  type ArchiveFilters,
} from './gamesArchiveModel';
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
  /**
   * `strip` (default): the compact list on Rating History. `page`: the Games page, with stats, filters and the full
   * list (the page itself scrolls).
   */
  layout?: 'strip' | 'page';
  /** Strip only: opens the dedicated Games page. The link is hidden when this is not provided. */
  onOpenGamesPage?: () => void;
};

const GAMES_SHOWN = { strip: 20, page: 100 } as const;
/** The reviews list is only used for older reviews that have no saved game; the server caps it at 20. */
const REVIEWS_SHOWN = 20;

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
export function HistoricalGameReviewPortal({ enabled, layout = 'strip', onOpenGamesPage }: HistoricalGameReviewPortalProps) {
  const isPage = layout === 'page';
  const [probedAccess, setProbedAccess] = useState<boolean | null>(null);
  const accessEnabled = enabled !== undefined ? enabled : probedAccess === true;

  // null = loading for the current accessEnabled=true session
  const [entries, setEntries] = useState<RecentGameReviewListEntry[] | null>(null);
  const [games, setGames] = useState<SavedGameSummary[] | null>(null);
  const [gamesError, setGamesError] = useState(false);
  const [analyzingGameId, setAnalyzingGameId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ArchiveFilters>(NO_FILTERS);
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
    void fetchRecentGameReviews(REVIEWS_SHOWN)
      .then((reviews) => {
        if (!cancelled) setEntries(reviews);
      })
      .catch(() => {
        if (!cancelled) { setEntries([]); setError('Could not load saved reviews. Please try again.'); }
      });
    void fetchRecentGames(GAMES_SHOWN[layout])
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
  }, [accessEnabled, listKey, layout]);

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

  const allGames = useMemo(() => games ?? [], [games]);
  const stats = useMemo(() => computeArchiveStats(allGames), [allGames]);
  const tiers = useMemo(() => tiersPresent(allGames), [allGames]);
  const visibleGames = useMemo(() => filterGames(allGames, filters), [allGames, filters]);

  if (!accessEnabled) return null;

  const loadingList = entries === null;
  const allReviews = entries ?? [];
  const loadingGames = games === null;
  const filtersActive = filters.result !== 'all' || filters.tier !== 'all';

  // Reviews already shown against a game are not listed a second time.
  const listedGameIds = new Set(allGames.map((game) => game.sourceMatchId));
  const rows = allReviews.filter((review) => !(review.sourceMatchId && listedGameIds.has(review.sourceMatchId)));
  // The Games page is about games: older reviews that have no saved game only appear there when there are some.
  const showLegacyReviews = !isPage || rows.length > 0 || Boolean(error);

  return (
    <>
      <section className={`rh-recent-reviews rh-saved-games${isPage ? ' rh-saved-games--page' : ''}`} aria-label="Your games">
        <div className="rh-saved-games__head">
          <p className="rh-recent-reviews__eyebrow">Your games</p>
          {!isPage && onOpenGamesPage ? (
            <button type="button" className="rh-saved-games__all" onClick={onOpenGamesPage}>All games →</button>
          ) : null}
        </div>
        {isPage && !loadingGames && allGames.length > 0 ? (
          <dl className="rh-saved-games__stats" aria-label="Your games at a glance">
            <div><dt>Games</dt><dd>{stats.games}</dd></div>
            <div><dt>Win rate</dt><dd>{stats.winRate === null ? '—' : `${stats.winRate}%`}</dd></div>
            <div><dt>Reviewed</dt><dd>{stats.reviewed}</dd></div>
            <div><dt>Avg accuracy</dt><dd>{formatAccuracy(stats.averageAccuracy) ?? '—'}</dd></div>
          </dl>
        ) : null}
        {isPage && !loadingGames && allGames.length > 0 ? (
          <div className="rh-saved-games__filters">
            <div role="group" aria-label="Filter by result" className="rh-saved-games__chips">
              {(['all', 'wins', 'losses'] as const).map((result) => (
                <button
                  key={result}
                  type="button"
                  className="rh-saved-games__chip"
                  aria-pressed={filters.result === result}
                  onClick={() => setFilters((current) => ({ ...current, result }))}
                >
                  {result === 'all' ? 'All' : result === 'wins' ? 'Wins' : 'Losses'}
                </button>
              ))}
            </div>
            {tiers.length > 1 ? (
              <div role="group" aria-label="Filter by Fritz tier" className="rh-saved-games__chips">
                {['all', ...tiers].map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    className="rh-saved-games__chip"
                    aria-pressed={filters.tier === tier}
                    onClick={() => setFilters((current) => ({ ...current, tier }))}
                  >
                    {tier === 'all' ? 'All tiers' : titleCase(tier)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {loadingGames ? <p className="rh-recent-reviews__status">Loading…</p> : null}
        {!loadingGames && allGames.length === 0 && !gamesError ? (
          <p className="rh-recent-reviews__status">No saved games yet. Finish a Play vs Fritz game and it will appear here.</p>
        ) : null}
        {!loadingGames && allGames.length > 0 && visibleGames.length === 0 ? (
          <p className="rh-recent-reviews__status">
            No games match these filters.{' '}
            {filtersActive ? <button type="button" className="rh-saved-games__all" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button> : null}
          </p>
        ) : null}
        <ul className="rh-recent-reviews__list">
          {visibleGames.map((game) => {
            const reviewId = game.review?.id;
            const accuracy = formatAccuracy(game.review?.accuracy ?? null);
            const won = game.result.winner === 'you';
            const lost = game.result.winner === 'opponent';
            return (
              <li key={game.sourceMatchId} className="rh-recent-reviews__row">
                <span className="rh-recent-reviews__meta">
                  <span className="rh-saved-games__line">
                    <strong className={won ? 'rh-saved-games__win' : lost ? 'rh-saved-games__loss' : undefined}>
                      {won ? 'Victory' : lost ? 'Defeat' : 'Final'} {game.result.you}–{game.result.opponent}
                    </strong>
                    {' · '}{titleCase(game.fritzTier)} · {gameWhen(game)}
                  </span>
                  <span className="rh-saved-games__state">
                    {reviewId ? 'Review ready' : 'Not analyzed yet'}
                    {accuracy ? ` · ${accuracy} accuracy${game.review?.grade ? ` · ${game.review.grade}` : ''}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className={`dfd__btn rh-recent-reviews__btn rh-saved-games__btn${reviewId ? ' rh-saved-games__btn--ready' : ''}`}
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
      {showLegacyReviews ? (
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
      ) : null}
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
