import { useEffect, useMemo, useState } from 'react';
import { GlobalNav } from '../components';
import { PlayerInitialsAvatar } from '../components/hub';
import FilterPills from '../social/hub/FilterPills';
import { formatCountdownHms, secondsUntilNextPacificMidnight } from '../dailyFritz/format';
import type { AppMode } from '../types';
import { fetchPuzzleRushLeaderboard } from './api';
import type { PuzzleRushLeaderboardEntry, PuzzleRushLeaderboardResponse } from './types';
// Fritz's leaderboard depends on all three, in this order: tokens the dflb
// rules reference, then the rh-hub-* page/panel/FilterPills layout, then the
// board rules themselves. Importing only the last one left rh-hub-screen /
// rh-hub-shell / rh-hub-panel completely unstyled, which collapsed the page
// and put the back button somewhere unclickable.
import '../components/hub/hubDesignTokens.css';
import '../social/hub/hubShared.css';
import '../dailyFritz/dailyFritzLeaderboardScreen.css';
import './puzzleRush.css';

/**
 * Puzzle Rush leaderboard, built on Daily Fritz's leaderboard structure.
 *
 * Reuses its `dflb-*` classes wholesale — command header with meta chips,
 * podium, insight stats, "your position" strip, and the ranked table — so the
 * two daily modes read as one product. Only the columns differ, because Rush's
 * data is score/solved/time rather than result/set/margin.
 *
 * Two boards, as a filter pill rather than tabs, matching Fritz's own
 * Global/Friends/Top-Rated control: **Today** is official runs only (one per
 * player), **All-time** is every completed run's personal best.
 */

// `id`, not `value` — that is the key FilterPills reads. The old shape was
// forced through with an `as unknown as` cast, which compiled while handing
// the component options it could not key off.
const FILTER_OPTIONS = [
  { id: 'today', label: 'Today' },
  { id: 'allTime', label: 'All-time best' },
] as const;

type Filter = (typeof FILTER_OPTIONS)[number]['id'];

function RankIcon({ rank }: { rank: 1 | 2 | 3 }) {
  if (rank === 1) {
    return (
      <span className="dflb-crown" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M3.5 8.5 8.5 13l3.5-7 3.5 7 5-4.5-1.8 9H5.3l-1.8-9Z" />
        </svg>
      </span>
    );
  }
  return (
    <span className="dflb-crown" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d="M7 4h10v5a5 5 0 0 1-10 0V4Zm2 13h6v3H9v-3Z" />
      </svg>
    </span>
  );
}

function formatDateLabel(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateKey;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatAchievedAt(iso: string | null): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function PodiumSlot({
  rank,
  row,
}: {
  rank: 1 | 2 | 3;
  row: PuzzleRushLeaderboardEntry | undefined;
}) {
  const crown = rank === 1 ? <span className="dflb-podium-crown-badge" aria-hidden="true"><RankIcon rank={1} /></span> : null;

  if (!row) {
    return (
      <div className={`dflb-podium-slot place-${rank} is-empty`}>
        {crown}
        <span className="dflb-podium-avatar dflb-podium-avatar--empty" aria-hidden="true">
          <span className="dflb-podium-avatar__glyph">+</span>
        </span>
        <span className="dflb-podium-name">—</span>
        <span className="dflb-podium-empty-hint">Unclaimed</span>
      </div>
    );
  }

  return (
    <div className={`dflb-podium-slot place-${rank}${rank === 1 ? ' is-featured' : ''}`}>
      {crown}
      <PlayerInitialsAvatar
        username={row.username}
        size={rank === 1 ? 'lg' : 'md'}
        ring={rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze'}
      />
      <span className="dflb-podium-name">{row.username}</span>
      <span className="dflb-podium-score">{row.totalScore}</span>
      <span className="dflb-podium-margin">{row.puzzlesSolved} solved</span>
    </div>
  );
}

function LeaderboardRow({
  row,
  isSelf,
}: {
  row: PuzzleRushLeaderboardEntry;
  isSelf: boolean;
}) {
  const topRank = row.rank <= 3 ? (row.rank as 1 | 2 | 3) : null;
  return (
    <article
      className={[
        'dflb-row',
        'pr-lb-row',
        topRank ? `dflb-row--rank-${topRank}` : '',
        isSelf ? 'dflb-row--self' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="dflb-rank">
        {topRank ? <RankIcon rank={topRank} /> : null}
        <strong className={`dflb-rank-num${topRank ? ` is-${topRank}` : ''}`}>{row.rank}</strong>
      </div>
      <div className="dflb-player">
        <PlayerInitialsAvatar
          username={row.username}
          size="md"
          ring={topRank === 1 ? 'gold' : topRank === 2 ? 'silver' : topRank === 3 ? 'bronze' : 'none'}
        />
        <div className="dflb-player-copy">
          <strong>
            {row.username}
            {isSelf ? <span className="dflb-you-tag">You</span> : null}
          </strong>
        </div>
      </div>
      <div className="dflb-cell dflb-set-score pr-lb-score">{row.totalScore}</div>
      <div className="dflb-cell">{row.puzzlesSolved}</div>
      <div className="dflb-cell dflb-finished">{formatAchievedAt(row.achievedAt)}</div>
    </article>
  );
}

export function PuzzleRushLeaderboardScreen({
  onBack,
  onNavigate,
  currentUsername = null,
}: {
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  currentUsername?: string | null;
}) {
  const [data, setData] = useState<PuzzleRushLeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('today');
  const [resetSeconds, setResetSeconds] = useState(() => secondsUntilNextPacificMidnight(new Date()));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetchPuzzleRushLeaderboard();
        if (!cancelled) setData(response);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load the leaderboard.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setResetSeconds(secondsUntilNextPacificMidnight(new Date())), 1000);
    return () => window.clearInterval(id);
  }, []);

  const rows: PuzzleRushLeaderboardEntry[] = useMemo(
    () => (filter === 'today' ? data?.daily : data?.leaderboard) ?? [],
    [data, filter],
  );
  const podium = [rows[0], rows[1], rows[2]];
  const selfRow = currentUsername
    ? rows.find((row) => row.username.toLowerCase() === currentUsername.toLowerCase()) ?? null
    : null;
  const topScore = rows[0] ?? null;
  const mostSolved = useMemo(
    () => [...rows].sort((a, b) => b.puzzlesSolved - a.puzzlesSolved)[0] ?? null,
    [rows],
  );

  return (
    <div className="rh-hub-screen dflb-page pr-leaderboard-page">
      <div className="rh-hub-shell">
        <GlobalNav currentMode="puzzleRush" onNavigate={onNavigate} activeColor="var(--tier-standard)" />

        <div className="dflb-inner">
          <header className="dflb-command">
            <div className="dflb-command-hero">
              <div className="dflb-command__brand">
                <span className="rh-hub-tag dflb-eyebrow">Puzzle Rush</span>
                <h1 className="dflb-command__title">Leaderboard</h1>
                <p className="dflb-command__sub">
                  Today&apos;s official runs · and the all-time best ever posted.
                </p>
              </div>
              <div className="dflb-command__aside">
                <div className="dflb-command__actions">
                  <button type="button" className="dflb-back-link rh-back-button" onClick={onBack}>
                    <span aria-hidden>←</span>
                    Back to Puzzle Rush
                  </button>
                </div>
                <div className="dflb-command__meta" aria-label="Daily board status">
                  <div className="dflb-meta-chip">
                    <span className="dflb-meta-chip__label">Date</span>
                    <span className="dflb-meta-chip__value">
                      {data ? formatDateLabel(data.runDate) : '—'}
                    </span>
                  </div>
                  <div className="dflb-meta-chip dflb-meta-chip--board">
                    <span className="dflb-meta-chip__label">Board</span>
                    <span className="dflb-meta-chip__value">
                      {rows.length} {rows.length === 1 ? 'player' : 'players'}
                    </span>
                  </div>
                  <div className="dflb-meta-chip dflb-meta-chip--reset">
                    <span className="dflb-meta-chip__label">Resets in</span>
                    <span className="dflb-meta-chip__value is-cyan">
                      {formatCountdownHms(resetSeconds)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="dflb-command__bar">
              <FilterPills
                options={[...FILTER_OPTIONS]}
                value={filter}
                onChange={setFilter}
                ariaLabel="Leaderboard filters"
              />
            </div>
          </header>

          <div className="dflb-layout">
            <aside className="dflb-insights" aria-label="Board highlights">
              <div className="rh-hub-panel dflb-insights-panel">
                <section className="dflb-insights__section" aria-label="Podium">
                  <h3 className="dflb-insights__label">
                    {filter === 'today' ? "Today's podium" : 'All-time podium'}
                  </h3>
                  <div className="dflb-podium-stage">
                    <div className="dflb-podium">
                      <PodiumSlot rank={2} row={podium[1]} />
                      <PodiumSlot rank={1} row={podium[0]} />
                      <PodiumSlot rank={3} row={podium[2]} />
                    </div>
                  </div>
                </section>

                <div className="dflb-insights__divider" aria-hidden="true" />

                <section className="dflb-insights__section dflb-insights__stats" aria-label="Records">
                  <div className="dflb-insight-stat">
                    <span className="dflb-insight-stat__label">Top score</span>
                    <span className="dflb-insight-stat__name">{topScore?.username ?? '—'}</span>
                    <span className="dflb-insight-stat__value is-gold">
                      {topScore ? topScore.totalScore : '—'}
                    </span>
                  </div>
                  <div className="dflb-insight-stat">
                    <span className="dflb-insight-stat__label">Most solved</span>
                    <span className="dflb-insight-stat__name">{mostSolved?.username ?? '—'}</span>
                    <span className="dflb-insight-stat__value is-blue">
                      {mostSolved ? `${mostSolved.puzzlesSolved}` : '—'}
                    </span>
                  </div>
                </section>

                <div className="dflb-insights__divider" aria-hidden="true" />

                <section className="dflb-insights__section dflb-insights__you" aria-label="Your position">
                  <h3 className="dflb-insights__label">Your position</h3>
                  {selfRow ? (
                    <div className="dflb-you-strip">
                      <div className="dflb-you-strip__rank">
                        <span className="dflb-you-strip__hash">#</span>
                        <span className="dflb-you-strip__num">{selfRow.rank}</span>
                      </div>
                      <dl className="dflb-you-strip__stats">
                        <div>
                          <dt>Score</dt>
                          <dd>{selfRow.totalScore}</dd>
                        </div>
                        <div>
                          <dt>Solved</dt>
                          <dd>{selfRow.puzzlesSolved}</dd>
                        </div>
                        <div>
                          <dt>Finished</dt>
                          <dd>{formatAchievedAt(selfRow.achievedAt)}</dd>
                        </div>
                      </dl>
                    </div>
                  ) : data?.personalBest ? (
                    <div className="dflb-you-strip" data-ui="rush-leaderboard-you">
                      <dl className="dflb-you-strip__stats">
                        <div>
                          <dt>Your best</dt>
                          <dd>{data.personalBest.totalScore}</dd>
                        </div>
                        <div>
                          <dt>Solved</dt>
                          <dd>{data.personalBest.puzzlesSolved}</dd>
                        </div>
                      </dl>
                    </div>
                  ) : (
                    <div className="dflb-you-empty">Finish a run to claim a spot.</div>
                  )}
                </section>
              </div>
            </aside>

            <section className="dflb-standings" aria-label="Puzzle Rush standings">
              <div className="rh-hub-panel dflb-standings-panel">
                <div className="dflb-table-head pr-lb-row" aria-hidden="true">
                  <span>Rank</span>
                  <span>Player</span>
                  <span>Score</span>
                  <span>Solved</span>
                  <span>Time</span>
                </div>
                <div className="dflb-table-body">
                  {loading ? <p className="dflb-state">Loading leaderboard…</p> : null}
                  {error ? (
                    <p className="dflb-state dflb-state--error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  {!loading && !error && rows.length === 0 ? (
                    <div className="dflb-empty-board" data-ui="rush-leaderboard-empty">
                      <p className="dflb-state">
                        {filter === 'today'
                          ? 'No official runs today yet.'
                          : 'No completed runs yet.'}
                      </p>
                      <p className="dflb-empty-hint">
                        Finish today&apos;s Puzzle Rush run to claim the first spot.
                      </p>
                    </div>
                  ) : null}
                  {rows.map((row) => (
                    <LeaderboardRow
                      key={row.runId}
                      row={row}
                      isSelf={
                        currentUsername != null &&
                        row.username.toLowerCase() === currentUsername.toLowerCase()
                      }
                    />
                  ))}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PuzzleRushLeaderboardScreen;
