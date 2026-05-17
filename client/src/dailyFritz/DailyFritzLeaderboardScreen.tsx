import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { fetchFriends } from '../friends/friendsApi';
import FilterPills from '../social/hub/FilterPills';
import { PlayerInitialsAvatar } from '../components/hub';
import {
  fetchDailyFritzLeaderboard,
  type DailyFritzLeaderboardRow,
  type DailyFritzSetGameNumber,
} from './api';
import { formatCountdownHms, secondsUntilNextPacificMidnight } from './format';
import '../components/hub/hubDesignTokens.css';
import '../social/hub/hubShared.css';
import './dailyFritzLeaderboardScreen.css';

type LeaderboardFilter = 'global' | 'friends' | 'topRated';

const FILTER_OPTIONS = [
  { id: 'global' as const, label: 'Global' },
  { id: 'friends' as const, label: 'Friends' },
  { id: 'topRated' as const, label: 'Top Rated' },
];

const GAME_NUMBERS: DailyFritzSetGameNumber[] = [1, 2, 3];
const SPARSE_ROW_THRESHOLD = 8;

interface DailyFritzLeaderboardScreenProps {
  user: User | null;
  runDate: string;
  currentUsername?: string | null;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
}

function formatCompletedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatMargin(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function formatDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatGameChip(game: NonNullable<DailyFritzLeaderboardRow['games']>[number]): string {
  return `G${game.gameNumber} ${game.playerScore}–${game.fritzScore}`;
}

function isCurrentUserRow(row: DailyFritzLeaderboardRow, currentUsername: string | null): boolean {
  return (
    Boolean(row.is_current_user) ||
    (currentUsername != null &&
      currentUsername.trim().length > 0 &&
      row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase())
  );
}

function RankCrown({ rank }: { rank: 1 | 2 | 3 }) {
  const tone = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';
  return (
    <span className={`dflb-crown dflb-crown--${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="16" height="16">
        <path
          d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

function GameBreakdown({ row }: { row: DailyFritzLeaderboardRow }) {
  const gamesByNumber = new Map(
    (row.games ?? []).map((game) => [game.gameNumber, game] as const),
  );

  return (
    <div className="dflb-breakdown-chips">
      {GAME_NUMBERS.map((gameNumber) => {
        const game = gamesByNumber.get(gameNumber);
        if (!game) {
          return (
            <span key={`${row.username}-g${gameNumber}`} className="dflb-game-chip is-muted">
              G{gameNumber} —
            </span>
          );
        }
        return (
          <span
            key={`${row.username}-g${gameNumber}`}
            className={`dflb-game-chip ${game.playerWon ? 'is-win' : 'is-loss'}`}
          >
            {formatGameChip(game)}
          </span>
        );
      })}
    </div>
  );
}

function LeaderboardRow({
  row,
  currentUsername,
}: {
  row: DailyFritzLeaderboardRow;
  currentUsername: string | null;
}) {
  const topRank = row.rank <= 3 ? (row.rank as 1 | 2 | 3) : null;
  const isSelf = isCurrentUserRow(row, currentUsername);
  const showTier = row.rank <= 10;

  return (
    <article
      className={[
        'dflb-row',
        topRank ? `dflb-row--rank-${topRank}` : '',
        isSelf ? 'dflb-row--self' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="dflb-rank">
        {topRank ? <RankCrown rank={topRank} /> : null}
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
          {showTier ? <span className="dflb-tier-chip">Elite</span> : null}
        </div>
      </div>
      <div className={`dflb-cell dflb-result ${row.won ? 'is-win' : 'is-loss'}`}>
        {row.won ? 'Won' : 'Lost'}
      </div>
      <div className="dflb-cell dflb-set-score">
        {row.finalScore}–{row.opponentScore}
      </div>
      <div className={`dflb-cell dflb-margin ${row.pointDiff >= 0 ? 'is-win' : 'is-loss'}`}>
        {formatMargin(row.pointDiff)}
      </div>
      <div className="dflb-cell dflb-finished">{formatCompletedAt(row.completedAt)}</div>
      <div className="dflb-breakdown">
        <GameBreakdown row={row} />
      </div>
    </article>
  );
}

function PodiumSlot({
  rank,
  row,
}: {
  rank: 1 | 2 | 3;
  row: DailyFritzLeaderboardRow | null;
}) {
  const ring = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';

  if (!row) {
    return (
      <div className={`dflb-podium-slot place-${rank} is-empty`}>
        <span className="dflb-podium-rank">#{rank}</span>
        <span className="dflb-podium-avatar dflb-podium-avatar--empty" aria-hidden="true">
          <span className="dflb-podium-avatar__glyph">+</span>
        </span>
        <span className="dflb-podium-name">Open spot</span>
        <span className="dflb-podium-empty-hint">Awaiting racer</span>
      </div>
    );
  }

  return (
    <div className={`dflb-podium-slot place-${rank}${rank === 1 ? ' is-featured' : ''}`}>
      {rank === 1 ? (
        <span className="dflb-podium-crown-badge" aria-hidden="true">
          <RankCrown rank={1} />
        </span>
      ) : null}
      <span className="dflb-podium-rank">#{rank}</span>
      <PlayerInitialsAvatar username={row.username} size={rank === 1 ? 'lg' : 'md'} ring={ring} />
      <span className="dflb-podium-name">{row.username}</span>
      <span className="dflb-podium-score">{row.finalScore}–{row.opponentScore}</span>
      <span className="dflb-podium-margin">{formatMargin(row.pointDiff)}</span>
    </div>
  );
}

function InsightStatIcon({ tone }: { tone: 'blue' | 'gold' }) {
  if (tone === 'blue') {
    return (
      <span className="dflb-insight-stat__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span className="dflb-insight-stat__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <path
          d="M4 18l4-10 4 6 4-8 4 12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function InsightStat({
  label,
  name,
  value,
  tone,
}: {
  label: string;
  name: string | null;
  value: string;
  tone: 'blue' | 'gold';
}) {
  return (
    <div className={`dflb-insight-stat is-${tone}`}>
      <div className="dflb-insight-stat__head">
        <InsightStatIcon tone={tone} />
        <span className="dflb-insight-stat__label">{label}</span>
      </div>
      {name ? (
        <>
          <strong className="dflb-insight-stat__name">{name}</strong>
          <span className="dflb-insight-stat__value">{value}</span>
        </>
      ) : (
        <span className="dflb-insight-stat__empty">—</span>
      )}
    </div>
  );
}

export default function DailyFritzLeaderboardScreen({
  user,
  runDate,
  currentUsername = null,
  onBack,
  onNavigate,
}: DailyFritzLeaderboardScreenProps) {
  const [rows, setRows] = useState<DailyFritzLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeaderboardFilter>('global');
  const [friendUsernames, setFriendUsernames] = useState<Set<string>>(new Set());
  const [countdownTick, setCountdownTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const resetLabel = useMemo(
    () => formatCountdownHms(secondsUntilNextPacificMidnight(new Date())),
    [countdownTick],
  );

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDailyFritzLeaderboard(runDate);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [runDate]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (!user?.id) {
      setFriendUsernames(new Set());
      return;
    }
    void fetchFriends(user.id).then(({ friends }) => {
      setFriendUsernames(new Set(friends.map((f) => f.username.toLowerCase())));
    });
  }, [user?.id]);

  const filteredRows = useMemo(() => {
    if (filter === 'friends') {
      return rows.filter((row) => friendUsernames.has(row.username.toLowerCase()));
    }
    if (filter === 'topRated') {
      return rows.filter((row) => row.rank <= 10);
    }
    return rows;
  }, [rows, filter, friendUsernames]);

  const selfRow = useMemo(
    () => rows.find((row) => isCurrentUserRow(row, currentUsername)) ?? null,
    [rows, currentUsername],
  );

  const podiumSlots = useMemo(
    () => [rows[0] ?? null, rows[1] ?? null, rows[2] ?? null] as const,
    [rows],
  );

  const fastestFinisher = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort(
      (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
    )[0];
  }, [rows]);

  const bestMargin = useMemo(() => {
    const winners = rows.filter((r) => r.won);
    if (winners.length === 0) return null;
    return [...winners].sort((a, b) => b.pointDiff - a.pointDiff)[0];
  }, [rows]);

  const isSparse = !loading && !error && filteredRows.length > 0 && filteredRows.length < SPARSE_ROW_THRESHOLD;
  const playerCountLabel = `${rows.length} ${rows.length === 1 ? 'player' : 'players'}`;

  return (
    <div className="rh-hub-screen dflb-page">
      <div className="rh-hub-shell">
        <GlobalNav
          currentMode="leaderboard"
          activeColor="var(--tier-elite)"
          solidDarkChrome
          onNavigate={(mode) => {
            if (mode === 'home') {
              onBack();
              return;
            }
            onNavigate?.(mode);
          }}
        />

        <div className="rh-hub-body">
          <div className="rh-hub-inner dflb-inner">
            <header className="dflb-command">
              <div className="dflb-command-hero">
                <div className="dflb-command__brand">
                  <span className="rh-hub-tag dflb-eyebrow">Daily Fritz</span>
                  <h1 className="dflb-command__title">Leaderboard</h1>
                  <p className="dflb-command__sub">
                    Global ranking · Compete daily against Fritz and the world.
                  </p>
                </div>
                <div className="dflb-command__meta" aria-label="Daily board status">
                  <div className="dflb-meta-chip">
                    <span className="dflb-meta-chip__label">Date</span>
                    <span className="dflb-meta-chip__value">{formatDateLabel(runDate)}</span>
                  </div>
                  <div className="dflb-meta-chip dflb-meta-chip--board">
                    <span className="dflb-meta-chip__label">Board</span>
                    <span className="dflb-meta-chip__value">{playerCountLabel}</span>
                  </div>
                  <div className="dflb-meta-chip dflb-meta-chip--reset">
                    <span className="dflb-meta-chip__label">Resets in</span>
                    <span className="dflb-meta-chip__value is-cyan">{resetLabel}</span>
                  </div>
                </div>
              </div>
              <div className="dflb-command__bar">
                <FilterPills
                  options={FILTER_OPTIONS}
                  value={filter}
                  onChange={setFilter}
                  ariaLabel="Leaderboard filters"
                />
              </div>
            </header>

            <div className="dflb-layout">
              <aside className="dflb-insights" aria-label="Board highlights">
                <div className="rh-hub-panel dflb-insights-panel">
                  <section className="dflb-insights__section" aria-label="Today's podium">
                    <h3 className="dflb-insights__label">Today&apos;s podium</h3>
                    <div className="dflb-podium-stage">
                      <div className="dflb-podium">
                        <PodiumSlot rank={2} row={podiumSlots[1]} />
                        <PodiumSlot rank={1} row={podiumSlots[0]} />
                        <PodiumSlot rank={3} row={podiumSlots[2]} />
                      </div>
                    </div>
                  </section>

                  <div className="dflb-insights__divider" aria-hidden="true" />

                  <section className="dflb-insights__section dflb-insights__stats" aria-label="Daily records">
                    <InsightStat
                      label="Fastest finisher"
                      name={fastestFinisher?.username ?? null}
                      value={fastestFinisher ? formatCompletedAt(fastestFinisher.completedAt) : '—'}
                      tone="blue"
                    />
                    <InsightStat
                      label="Best margin"
                      name={bestMargin?.username ?? null}
                      value={bestMargin ? formatMargin(bestMargin.pointDiff) : '—'}
                      tone="gold"
                    />
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
                            <dt>Set</dt>
                            <dd>{selfRow.finalScore}–{selfRow.opponentScore}</dd>
                          </div>
                          <div>
                            <dt>Margin</dt>
                            <dd className={selfRow.pointDiff >= 0 ? 'is-win' : 'is-loss'}>
                              {formatMargin(selfRow.pointDiff)}
                            </dd>
                          </div>
                          <div>
                            <dt>Finished</dt>
                            <dd>{formatCompletedAt(selfRow.completedAt)}</dd>
                          </div>
                        </dl>
                      </div>
                    ) : (
                      <div className="dflb-you-empty">
                        <p>Play today&apos;s set to appear on the board.</p>
                        <button type="button" className="dflb-your-cta" onClick={onBack}>
                          Play Daily Fritz
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              </aside>

              <section className="dflb-standings" aria-label="Daily Fritz standings">
                <div
                  className={[
                    'rh-hub-panel',
                    'dflb-standings-panel',
                    isSparse ? 'is-compact' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="dflb-table-head" aria-hidden="true">
                    <span>Rank</span>
                    <span>Player</span>
                    <span>Result</span>
                    <span>Set</span>
                    <span>Margin</span>
                    <span>Time</span>
                    <span>Games</span>
                  </div>

                  <div
                    className={[
                      'dflb-table-body',
                      filteredRows.length > SPARSE_ROW_THRESHOLD ? 'is-scrollable' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {loading ? <p className="dflb-state">Loading leaderboard…</p> : null}
                    {!loading && error ? <p className="dflb-state dflb-state--error">{error}</p> : null}
                    {!loading && !error && filteredRows.length === 0 ? (
                      <div className="dflb-empty-board">
                        <p className="dflb-state">No runs match this filter yet.</p>
                        <p className="dflb-empty-hint">Complete today&apos;s Daily Fritz set to claim the first spot.</p>
                      </div>
                    ) : null}
                    {!loading && !error
                      ? filteredRows.map((row) => (
                          <LeaderboardRow
                            key={`${row.rank}-${row.username}-${row.completedAt}`}
                            row={row}
                            currentUsername={currentUsername}
                          />
                        ))
                      : null}
                  </div>

                  {isSparse ? (
                    <footer className="dflb-standings-foot" aria-live="polite">
                      <span className="dflb-standings-foot__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                          <path
                            d="M4 12h16M12 4v16"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            opacity="0.5"
                          />
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
                        </svg>
                      </span>
                      <div className="dflb-standings-foot__copy">
                        <p className="dflb-standings-foot__title">More racers on the way</p>
                        <p className="dflb-standings-foot__sub">
                          More racers will appear as they finish today&apos;s set.
                        </p>
                      </div>
                    </footer>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
