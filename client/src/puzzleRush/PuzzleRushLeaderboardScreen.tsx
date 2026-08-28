import { useEffect, useMemo, useState } from 'react';
import { GlobalNav } from '../components';
import FilterPills from '../social/hub/FilterPills';
import { avatarHue, getInitials } from '../components/hub/playerInitialsAvatarUtils';
import { formatCountdownHms, secondsUntilNextPacificMidnight } from '../dailyFritz/format';
import type { AppMode } from '../types';
import { fetchPuzzleRushLeaderboard } from './api';
import type { PuzzleRushLeaderboardEntry, PuzzleRushLeaderboardResponse } from './types';
// Fritz's board depends on all three, in this order: the tokens the dfl-*
// rules reference, then the rh-hub-* page/panel/FilterPills layout, then the
// board rules themselves. Importing only the last one leaves rh-hub-screen /
// rh-hub-shell completely unstyled, which collapses the page.
import '../components/hub/hubDesignTokens.css';
import '../social/hub/hubShared.css';
import '../dailyFritz/dailyFritzLeaderboardBoard.css';
import './puzzleRush.css';

/**
 * Puzzle Rush leaderboard, built on Daily Fritz's leaderboard.
 *
 * Reuses its `dfl-*` board wholesale — masthead, meta strip, ranked table and
 * rail — so the two daily modes read as one product. Only the columns differ,
 * because Rush's data is score/solved/time rather than result/set/margin.
 *
 * Fritz's three per-game bars have no equivalent here: a Rush entry carries a
 * total and a solved count, not a per-puzzle breakdown, so that column is
 * dropped rather than filled with something the data can't support.
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

function ordinalSuffix(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  const ones = rank % 10;
  if (ones === 1) return 'st';
  if (ones === 2) return 'nd';
  if (ones === 3) return 'rd';
  return 'th';
}

function PlayerAvatar({ username }: { username: string }) {
  const hue = avatarHue(username);
  return (
    <span
      className="dfl-avatar"
      aria-hidden="true"
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 42% 38%), hsl(${(hue + 48) % 360} 48% 24%))`,
      }}
    >
      {getInitials(username)}
    </span>
  );
}

function CrownGlyph() {
  return (
    <span className="dfl-rank__crown" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
        <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
      </svg>
    </span>
  );
}

function LeaderboardRow({ row, isSelf }: { row: PuzzleRushLeaderboardEntry; isSelf: boolean }) {
  return (
    <article className={`dfl-row dfl-row-grid${isSelf ? ' dfl-row--self' : ''}`}>
      <div className="dfl-rank">
        {row.rank === 1 ? <CrownGlyph /> : null}
        <span>{row.rank}</span>
      </div>

      <div className="dfl-racer">
        <PlayerAvatar username={row.username} />
        <div className="dfl-racer__copy">
          <div className="dfl-racer__name">
            <span className="dfl-racer__handle">{row.username}</span>
            {isSelf ? <span className="dfl-you">YOU</span> : null}
          </div>
        </div>
      </div>

      <div className="dfl-set">
        <div className="dfl-set__games pr-board__score">{row.totalScore}</div>
      </div>

      <div className="dfl-solved">
        {row.puzzlesSolved}
        {/* The Solved header is dropped on phones, so the value labels itself. */}
        <span className="pr-board__solved-unit"> solved</span>
      </div>

      <div className="dfl-finished">{formatAchievedAt(row.achievedAt)}</div>
    </article>
  );
}

function RecordRow({
  label,
  name,
  value,
  tone,
}: {
  label: string;
  name: string | null;
  value: string;
  tone?: 'win' | 'accent';
}) {
  return (
    <div className="dfl-record">
      <div className="dfl-record__copy">
        <span className="dfl-record__label">{label}</span>
        <span className="dfl-record__name">{name ?? '—'}</span>
      </div>
      <span className={`dfl-record__value${tone ? ` is-${tone}` : ''}`}>{value}</span>
    </div>
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
  const selfRow = currentUsername
    ? rows.find((row) => row.username.toLowerCase() === currentUsername.toLowerCase()) ?? null
    : null;
  const topScore = rows[0] ?? null;
  const mostSolved = useMemo(
    () => [...rows].sort((a, b) => b.puzzlesSolved - a.puzzlesSolved)[0] ?? null,
    [rows],
  );

  return (
    <div className="rh-hub-screen dfl-page pr-board">
      <div className="rh-hub-shell">
        <GlobalNav currentMode="puzzleRush" onNavigate={onNavigate} activeColor="var(--tier-standard)" />

        <div className="rh-hub-body">
          <div className="rh-hub-inner dfl-inner">
            <div className="dfl-board">
              <header className="dfl-masthead">
                <div>
                  <span className="dfl-eyebrow">Puzzle Rush</span>
                  <h1 className="dfl-title">
                    Leaderboard<span className="dfl-title__dot">.</span>
                  </h1>
                  <p className="dfl-tagline">
                    Today&apos;s official runs · and the all-time best ever posted.
                  </p>
                </div>
                <div className="dfl-masthead__actions">
                  <button type="button" className="dfl-btn" onClick={onBack}>
                    <span aria-hidden>←</span>
                    Puzzle Rush
                  </button>
                </div>
              </header>

              <div className="dfl-meta" aria-label="Daily board status">
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Date</span>
                  <span className="dfl-meta__value">
                    {data ? formatDateLabel(data.runDate) : '—'}
                  </span>
                </div>
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Players</span>
                  <span className="dfl-meta__value">{rows.length}</span>
                </div>
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Top score</span>
                  <span className="dfl-meta__value is-accent">
                    {topScore ? topScore.totalScore : '—'}
                  </span>
                </div>
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Resets in</span>
                  <span className="dfl-meta__value">{formatCountdownHms(resetSeconds)}</span>
                </div>
              </div>

              <FilterPills
                options={[...FILTER_OPTIONS]}
                value={filter}
                onChange={setFilter}
                ariaLabel="Leaderboard filters"
              />

              <div className="dfl-layout">
                <section className="dfl-table" aria-label="Puzzle Rush standings">
                  <div className="dfl-thead dfl-row-grid" aria-hidden="true">
                    <span>Rank</span>
                    <span>Player</span>
                    <span>Score</span>
                    <span className="pr-board__thead-solved">Solved</span>
                    <span className="dfl-thead__finished">Finished</span>
                  </div>

                  <div className="dfl-tbody">
                    {loading ? <p className="dfl-state">Loading leaderboard…</p> : null}
                    {error ? (
                      <p className="dfl-state dfl-state--error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    {!loading && !error && rows.length === 0 ? (
                      <div className="dfl-state" data-ui="rush-leaderboard-empty">
                        <p style={{ margin: 0 }}>
                          {filter === 'today'
                            ? 'No official runs today yet.'
                            : 'No completed runs yet.'}
                        </p>
                        <p className="dfl-state__hint">
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
                </section>

                <aside className="dfl-rail" aria-label="Board highlights">
                  <section className="dfl-card dfl-card--accent" aria-label="Your position">
                    <h2 className="dfl-card__head">Your position</h2>
                    {selfRow ? (
                      <>
                        <div className="dfl-position">
                          <span className="dfl-position__rank">
                            {selfRow.rank}
                            <span className="dfl-position__suffix">{ordinalSuffix(selfRow.rank)}</span>
                          </span>
                          <span className="dfl-position__of">
                            of {rows.length} {rows.length === 1 ? 'player' : 'players'}
                          </span>
                        </div>
                        <dl className="dfl-position__stats">
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
                      </>
                    ) : data?.personalBest ? (
                      <dl className="dfl-position__stats" data-ui="rush-leaderboard-you">
                        <div>
                          <dt>Your best</dt>
                          <dd>{data.personalBest.totalScore}</dd>
                        </div>
                        <div>
                          <dt>Solved</dt>
                          <dd>{data.personalBest.puzzlesSolved}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="dfl-position__empty">Finish a run to claim a spot.</p>
                    )}
                  </section>

                  <section className="dfl-card" aria-label="Records">
                    <h2 className="dfl-card__head">
                      {filter === 'today' ? "Today's records" : 'All-time records'}
                    </h2>
                    <RecordRow
                      label="Top score"
                      name={topScore?.username ?? null}
                      value={topScore ? String(topScore.totalScore) : '—'}
                      tone="accent"
                    />
                    <RecordRow
                      label="Most solved"
                      name={mostSolved?.username ?? null}
                      value={mostSolved ? String(mostSolved.puzzlesSolved) : '—'}
                    />
                  </section>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PuzzleRushLeaderboardScreen;
