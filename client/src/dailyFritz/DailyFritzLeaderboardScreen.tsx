import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import { fetchFriends } from '../friends/friendsApi';
import FilterPills from '../social/hub/FilterPills';
import { avatarHue, getInitials } from '../components/hub/playerInitialsAvatarUtils';
import {
  fetchDailyFritzLeaderboard,
  getTodayDailyFritz,
  type DailyFritzLeaderboardRow,
  type DailyFritzSetGameNumber,
  type DailyFritzSetResult,
  type DailyFritzTodayResponse,
} from './api';
import { buildDailyFritzFinalOverlayViewModel } from './buildFinalOverlayViewModel';
import { DailyFritzFinalResultOverlay } from './DailyFritzFinalResultOverlay';
import { buildShareText } from './shareCard';
import { describeSetStory } from './setStory';
import { formatCountdownHms, secondsUntilNextPacificMidnight } from './format';
import '../components/hub/hubDesignTokens.css';
import '../social/hub/hubShared.css';
import './dailyFritzLeaderboardBoard.css';

type LeaderboardFilter = 'global' | 'friends' | 'topRated';

const FILTER_OPTIONS = [
  { id: 'global' as const, label: 'Global' },
  { id: 'friends' as const, label: 'Friends' },
  { id: 'topRated' as const, label: 'Top Rated' },
];

const GAME_NUMBERS: DailyFritzSetGameNumber[] = [1, 2, 3];
/** Racers named outright in the skunk record before it collapses to a count. */
const SKUNK_NAMES_SHOWN = 2;

type LeaderboardGame = NonNullable<DailyFritzLeaderboardRow['games']>[number];

interface DailyFritzLeaderboardScreenProps {
  user: User | null;
  runDate: string;
  /**
   * The /api/daily-fritz/today response the route already fetched to resolve
   * `runDate`. Seeds state so this screen doesn't request it a second time.
   */
  initialToday?: DailyFritzTodayResponse | null;
  currentUsername?: string | null;
  glickoRating?: number | null;
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

function ordinalSuffix(rank: number): string {
  const tens = rank % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  const ones = rank % 10;
  if (ones === 1) return 'st';
  if (ones === 2) return 'nd';
  if (ones === 3) return 'rd';
  return 'th';
}

function hasSkunk(row: DailyFritzLeaderboardRow): boolean {
  return (row.games ?? []).some((game) => game.skunk);
}

function isCurrentUserRow(row: DailyFritzLeaderboardRow, currentUsername: string | null): boolean {
  return (
    Boolean(row.is_current_user) ||
    (currentUsername != null &&
      currentUsername.trim().length > 0 &&
      row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase())
  );
}

function RacerAvatar({ username }: { username: string }) {
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

function GameMarginBar({ game }: { game: LeaderboardGame | undefined }) {
  if (!game) {
    return (
      <div className="dfl-game dfl-game--empty">
        <div className="dfl-game__track" />
        <span className="dfl-game__score">—</span>
      </div>
    );
  }

  return (
    <div className="dfl-game">
      <div
        className={`dfl-game__track is-${game.playerWon ? 'win' : 'loss'}`}
        role="img"
        aria-label={`Game ${game.gameNumber}: ${game.playerWon ? 'won' : 'lost'}, you ${game.playerScore}, Fritz ${game.fritzScore}`}
      />
      <span className="dfl-game__score">
        {game.playerScore}–{game.fritzScore}
        {game.skunk ? <span className="dfl-game__skunk">SKUNK</span> : null}
      </span>
    </div>
  );
}

function LeaderboardRow({
  row,
  isSelf,
}: {
  row: DailyFritzLeaderboardRow;
  isSelf: boolean;
}) {
  const story = describeSetStory(row);
  const gamesByNumber = new Map((row.games ?? []).map((game) => [game.gameNumber, game] as const));

  return (
    <article className={`dfl-row dfl-row-grid${isSelf ? ' dfl-row--self' : ''}`}>
      <div className="dfl-rank">
        {row.rank === 1 ? <CrownGlyph /> : null}
        <span>{row.rank}</span>
      </div>

      <div className="dfl-racer">
        <RacerAvatar username={row.username} />
        <div className="dfl-racer__copy">
          <div className="dfl-racer__name">
            <span className="dfl-racer__handle">{row.username}</span>
            {isSelf ? <span className="dfl-you">YOU</span> : null}
          </div>
          <div className={`dfl-racer__story is-${story.tone}`}>{story.label}</div>
        </div>
      </div>

      <div className="dfl-set">
        <div className="dfl-set__games">
          {row.finalScore}-{row.opponentScore}
        </div>
        <div className={`dfl-set__margin ${row.pointDiff >= 0 ? 'is-win' : 'is-loss'}`}>
          {formatMargin(row.pointDiff)}
        </div>
      </div>

      <div className="dfl-games">
        {GAME_NUMBERS.map((gameNumber) => (
          <GameMarginBar key={gameNumber} game={gamesByNumber.get(gameNumber)} />
        ))}
      </div>

      <div className="dfl-finished">{formatCompletedAt(row.completedAt)}</div>
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

export default function DailyFritzLeaderboardScreen({
  user,
  runDate,
  initialToday = null,
  currentUsername = null,
  glickoRating = null,
  onBack,
  onNavigate,
}: DailyFritzLeaderboardScreenProps) {
  const [rows, setRows] = useState<DailyFritzLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeaderboardFilter>('global');
  const [friendUsernames, setFriendUsernames] = useState<Set<string>>(new Set());
  const [countdownTick, setCountdownTick] = useState(0);
  const [today, setToday] = useState<DailyFritzTodayResponse | null>(initialToday ?? null);
  // Identity the seeded response is valid for; consumed once, then refetches resume.
  const seededKeyRef = useRef<string | null>(
    initialToday && user?.id ? `${user.id}:${runDate}` : null,
  );
  const [resultOverlayOpen, setResultOverlayOpen] = useState(false);
  const [shareDone, setShareDone] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setCountdownTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const resetLabel = useMemo(
    () => formatCountdownHms(secondsUntilNextPacificMidnight(new Date())),
    // countdownTick is not read here: it is the 1s interval that re-runs this
    // memo so the impure new Date() is re-read. Dropping it freezes the label.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countdownTick],
  );

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDailyFritzLeaderboard(runDate);
      setRows(data);
    } catch (err) {
      void err;
      setError('Couldn’t load the leaderboard. Please try again.');
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

  const hasCompletedSetToday = Boolean(
    today?.attempt_status === 'completed' && today.set_result?.setWinner,
  );
  const completedButUnranked = Boolean(hasCompletedSetToday && !selfRow);

  useEffect(() => {
    if (!user?.id) {
      setToday(null);
      return;
    }
    const key = `${user.id}:${runDate}`;
    if (seededKeyRef.current === key) {
      // The route fetched this exact response moments ago. Consume the seed so a
      // later runDate/user change still refetches.
      seededKeyRef.current = null;
      return;
    }
    let cancelled = false;
    void getTodayDailyFritz()
      .then((response) => {
        if (!cancelled) setToday(response);
      })
      .catch(() => {
        if (!cancelled) setToday(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id, runDate]);

  const resultOverlayConfig = useMemo(() => {
    if (!hasCompletedSetToday || !today) return null;
    const setResult = today.set_result as DailyFritzSetResult | null | undefined;
    if (!setResult?.setWinner) return null;
    const profileRating =
      typeof glickoRating === 'number' && Number.isFinite(glickoRating) ? Math.round(glickoRating) : undefined;
    return buildDailyFritzFinalOverlayViewModel({
      setResult,
      rank: selfRow?.rank ?? today.rank ?? null,
      runDate: today.run_date || runDate,
      fritzTier: today.fritz_tier,
      shareRating: profileRating,
      shareStreak: today.streak ?? 0,
      canViewLeaderboard: true,
      onPrimary: () => setResultOverlayOpen(false),
      onSecondary: () => {
        setResultOverlayOpen(false);
        if (onNavigate) {
          onNavigate('dailyFritz');
          return;
        }
        onBack();
      },
    });
  }, [hasCompletedSetToday, today, selfRow?.rank, runDate, glickoRating, onNavigate, onBack]);

  const resultShareText = useMemo(
    () => (resultOverlayConfig ? buildShareText(resultOverlayConfig) : ''),
    [resultOverlayConfig],
  );

  const handleShareResult = useCallback(() => {
    if (!resultShareText) return;
    const markShared = (): void => {
      setShareDone(true);
      window.setTimeout(() => setShareDone(false), 2000);
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator
        .share({ title: 'Daily Fritz', text: resultShareText })
        .then(() => {
          markShared();
        })
        .catch(() => {
          /* user dismissed native share */
        });
      return;
    }
    void navigator.clipboard.writeText(resultShareText).then(() => {
      markShared();
    });
  }, [resultShareText]);

  useEffect(() => {
    setShareDone(false);
  }, [resultShareText, resultOverlayOpen]);

  const bestMargin = useMemo(() => {
    const winners = rows.filter((r) => r.won);
    if (winners.length === 0) return null;
    return [...winners].sort((a, b) => b.pointDiff - a.pointDiff)[0];
  }, [rows]);

  const skunkRacers = useMemo(() => rows.filter(hasSkunk), [rows]);

  const skunkRacersLabel = useMemo(() => {
    if (skunkRacers.length === 0) return null;
    const named = skunkRacers.slice(0, SKUNK_NAMES_SHOWN).map((row) => row.username);
    const rest = skunkRacers.length - named.length;
    return rest > 0 ? `${named.join(', ')} +${rest}` : named.join(', ');
  }, [skunkRacers]);

  const goBackToDailyFritz = useCallback(() => {
    if (onNavigate) {
      onNavigate('dailyFritz');
      return;
    }
    onBack();
  }, [onNavigate, onBack]);

  return (
    <div className="rh-hub-screen dfl-page">
      <div className="rh-hub-shell">
        <GlobalNav
          currentMode="leaderboard"
          activeColor="var(--tier-elite)"
          solidDarkChrome
          onNavigate={(mode) => {
            if (mode === 'home') {
              if (onNavigate) onNavigate('home');
              else onBack();
              return;
            }
            onNavigate?.(mode);
          }}
        />

        <div className="rh-hub-body">
          <div className="rh-hub-inner dfl-inner">
            <div className="dfl-board">
              <header className="dfl-masthead">
                <div>
                  <span className="dfl-eyebrow">Daily Fritz</span>
                  <h1 className="dfl-title">
                    Leaderboard<span className="dfl-title__dot">.</span>
                  </h1>
                  <p className="dfl-tagline">Everyone plays the same tiles. The only variable is you.</p>
                </div>
                <div className="dfl-masthead__actions">
                  <button type="button" className="dfl-btn" onClick={goBackToDailyFritz}>
                    <span aria-hidden>←</span>
                    Daily Fritz
                  </button>
                  {hasCompletedSetToday && resultOverlayConfig ? (
                    <button
                      type="button"
                      className="dfl-btn dfl-btn--accent"
                      onClick={() => setResultOverlayOpen(true)}
                    >
                      Share Result
                    </button>
                  ) : null}
                </div>
              </header>

              <div className="dfl-meta" aria-label="Daily board status">
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Date</span>
                  <span className="dfl-meta__value">{formatDateLabel(runDate)}</span>
                </div>
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Racers</span>
                  <span className="dfl-meta__value">{rows.length}</span>
                </div>
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Skunks today</span>
                  <span className="dfl-meta__value is-accent">{skunkRacers.length}</span>
                </div>
                <div className="dfl-meta__cell">
                  <span className="dfl-meta__label">Resets in</span>
                  <span className="dfl-meta__value">{resetLabel}</span>
                </div>
              </div>

              <FilterPills
                options={FILTER_OPTIONS}
                value={filter}
                onChange={setFilter}
                ariaLabel="Leaderboard filters"
              />

              <div className="dfl-layout">
                <section className="dfl-table" aria-label="Daily Fritz standings">
                  <div className="dfl-thead dfl-row-grid" aria-hidden="true">
                    <span>Rank</span>
                    <span>Racer</span>
                    <span>Set · Margin</span>
                    <span className="dfl-thead__games">The three games</span>
                    <span className="dfl-thead__finished">Finished</span>
                  </div>

                  <div className="dfl-tbody">
                    {loading ? <p className="dfl-state">Loading leaderboard…</p> : null}
                    {!loading && error ? (
                      <p className="dfl-state dfl-state--error" role="alert">
                        Couldn&apos;t load the leaderboard. Please try again.
                      </p>
                    ) : null}
                    {!loading && !error && filteredRows.length === 0 ? (
                      <div className="dfl-state">
                        <p style={{ margin: 0 }}>No runs match this filter yet.</p>
                        <p className="dfl-state__hint">
                          Complete today&apos;s Daily Fritz set to claim the first spot.
                        </p>
                      </div>
                    ) : null}
                    {!loading && !error
                      ? filteredRows.map((row) => (
                          <LeaderboardRow
                            key={`${row.rank}-${row.username}-${row.completedAt}`}
                            row={row}
                            isSelf={isCurrentUserRow(row, currentUsername)}
                          />
                        ))
                      : null}
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
                            of {rows.length} {rows.length === 1 ? 'racer' : 'racers'}
                          </span>
                        </div>
                        <dl className="dfl-position__stats">
                          <div>
                            <dt>Set</dt>
                            <dd>
                              {selfRow.finalScore}-{selfRow.opponentScore}
                            </dd>
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
                      </>
                    ) : (
                      <p className="dfl-position__empty">
                        {completedButUnranked
                          ? today?.verification_status === 'verified'
                            ? 'Your result is still syncing to the board.'
                            : 'Finished today — not on the ranked board.'
                          : "Play today's set to take your place."}
                      </p>
                    )}
                  </section>

                  <section className="dfl-card" aria-label="Today's records">
                    <h2 className="dfl-card__head">Today&apos;s records</h2>
                    <RecordRow
                      label="Best margin"
                      name={bestMargin?.username ?? null}
                      value={bestMargin ? formatMargin(bestMargin.pointDiff) : '—'}
                      tone="win"
                    />
                    <RecordRow
                      label="Skunks today"
                      name={skunkRacersLabel}
                      value={String(skunkRacers.length)}
                      tone="accent"
                    />
                  </section>
                </aside>
              </div>
            </div>
          </div>
        </div>
      </div>

      {resultOverlayOpen && resultOverlayConfig ? (
        <GameOverlayPortal>
          <DailyFritzFinalResultOverlay
            overlay={resultOverlayConfig}
            shareDone={shareDone}
            onShare={handleShareResult}
          />
        </GameOverlayPortal>
      ) : null}
    </div>
  );
}
