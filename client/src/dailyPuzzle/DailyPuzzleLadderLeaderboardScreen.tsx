import { track } from '../lib/analytics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { fetchFriends } from '../friends/friendsApi';
import FilterPills from '../social/hub/FilterPills';
import { PlayerInitialsAvatar } from '../components/hub';
import { fetchDailyPuzzleLadderLeaderboard, getTodayDailyPuzzleLadder } from './api';
import {
  buildLadderShareData,
  buildLadderShareText,
  invokeLadderShareResult,
} from './ladderShareCard';
import { getDisplayStreak } from './streakStorage';
import {
  getDailyPuzzleBestSlotDisplay,
  getDailyPuzzleLeaderboardSlotCode,
  getDailyPuzzleLeaderboardSlotTitle,
} from './presentation';
import type { DailyPuzzleLeaderboardRow, DailyPuzzleSlotIndex } from './types';
import { DAILY_PUZZLE_SLOT_COUNT, DAILY_PUZZLE_SLOT_INDICES } from './types';
import { formatCountdownHms, secondsUntilNextPacificMidnight } from '../dailyFritz/format';
import '../components/hub/hubDesignTokens.css';
import '../social/hub/hubShared.css';
import '../dailyFritz/dailyFritzLeaderboardScreen.css';

type LeaderboardFilter = 'global' | 'friends' | 'topRated';

const FILTER_OPTIONS = [
  { id: 'global' as const, label: 'Global' },
  { id: 'friends' as const, label: 'Friends' },
  { id: 'topRated' as const, label: 'Top Rated' },
];

const SLOT_INDICES = DAILY_PUZZLE_SLOT_INDICES;
const SPARSE_ROW_THRESHOLD = 8;

interface DailyPuzzleLadderLeaderboardScreenProps {
  user: User | null;
  runDate: string;
  currentUsername?: string | null;
  currentUserId?: string | null;
  glickoRating?: number | null;
  onBack: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

function formatCompletedAt(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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

function isCurrentUserRow(
  row: DailyPuzzleLeaderboardRow,
  currentUserId: string | null,
  currentUsername: string | null,
): boolean {
  if (currentUserId && row.userId === currentUserId) return true;
  return (
    currentUsername != null &&
    currentUsername.trim().length > 0 &&
    row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase()
  );
}

function RankIcon({ rank }: { rank: 1 | 2 | 3 }) {
  if (rank === 1) {
    return (
      <span className="dflb-crown dflb-rank-icon--gold" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
            fill="var(--tier-elite)"
          />
        </svg>
      </span>
    );
  }

  const trophyColor = rank === 2 ? '#94a3b8' : '#c97b3f';
  const tone = rank === 2 ? 'silver' : 'bronze';

  return (
    <span className={`dflb-trophy dflb-rank-icon--${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={trophyColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    </span>
  );
}

function PuzzleBreakdown({
  row,
  bestSlotIndex,
}: {
  row: DailyPuzzleLeaderboardRow;
  bestSlotIndex: DailyPuzzleSlotIndex | null;
}) {
  const slotsByIndex = new Map(row.breakdown.map((slot) => [slot.slotIndex, slot] as const));

  return (
    <div className="dflb-breakdown-chips dpl-ladder-breakdown-chips">
      {SLOT_INDICES.map((slotIndex) => {
        const slot = slotsByIndex.get(slotIndex);
        const slotCode = getDailyPuzzleLeaderboardSlotCode(slotIndex);
        const slotTitle = getDailyPuzzleLeaderboardSlotTitle(slotIndex);
        if (!slot || !slot.solved) {
          return (
            <span
              key={`${row.userId}-p${slotIndex}`}
              className="dflb-game-chip is-muted"
              title={slotTitle}
            >
              <span className="dpl-pill-slot">{slotCode}</span>
              <span className="dpl-pill-score">—</span>
            </span>
          );
        }
        const isBest = bestSlotIndex === slotIndex;
        const points = slot.awardedPoints ?? '—';
        return (
          <span
            key={`${row.userId}-p${slotIndex}`}
            className={[
              'dflb-game-chip',
              isBest ? 'is-best' : slot.perfect ? 'is-win' : 'is-solved',
            ]
              .filter(Boolean)
              .join(' ')}
            title={`${slotTitle}: ${points}`}
          >
            <span className="dpl-pill-slot">{slotCode}</span>
            <span className="dpl-pill-score">{points}</span>
          </span>
        );
      })}
    </div>
  );
}

function LeaderboardRow({
  row,
  currentUserId,
  currentUsername,
}: {
  row: DailyPuzzleLeaderboardRow;
  currentUserId: string | null;
  currentUsername: string | null;
}) {
  const topRank = row.rank <= 3 ? (row.rank as 1 | 2 | 3) : null;
  const isSelf = isCurrentUserRow(row, currentUserId, currentUsername);
  const ladderComplete = row.puzzlesCompleted >= DAILY_PUZZLE_SLOT_COUNT;
  const bestSlot = getDailyPuzzleBestSlotDisplay(row.breakdown);

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
      <div className={`dflb-cell dpl-ladder-cell${ladderComplete ? ' is-complete' : ''}`}>
        <span className="dpl-ladder-cell__ratio">{row.puzzlesCompleted}/{DAILY_PUZZLE_SLOT_COUNT}</span>
        {ladderComplete ? <span className="dpl-ladder-cell__status">Complete</span> : null}
      </div>
      <div className="dflb-cell dpl-total-score">{row.totalScore}</div>
      <div className={`dflb-cell dpl-best-cell${bestSlot.slotIndex != null ? ' has-best' : ''}`}>
        {bestSlot.label}
      </div>
      <div className="dflb-cell dflb-finished">{formatCompletedAt(row.completedAt)}</div>
      <div className="dflb-breakdown">
        <PuzzleBreakdown row={row} bestSlotIndex={bestSlot.slotIndex} />
      </div>
    </article>
  );
}

function PodiumSlot({
  rank,
  row,
}: {
  rank: 1 | 2 | 3;
  row: DailyPuzzleLeaderboardRow | null;
}) {
  const ring = rank === 1 ? 'gold' : rank === 2 ? 'silver' : 'bronze';

  const rankDisplay = rank === 1 ? null : (
    <RankIcon rank={rank} />
  );

  const crownBadge = rank === 1 ? (
    <span className="dflb-podium-crown-badge" aria-hidden="true">
      <RankIcon rank={1} />
    </span>
  ) : null;

  if (!row) {
    return (
      <div className={`dflb-podium-slot place-${rank} is-empty`}>
        {crownBadge}
        {rankDisplay}
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
      {crownBadge}
      {rankDisplay}
      <PlayerInitialsAvatar username={row.username} size={rank === 1 ? 'lg' : 'md'} ring={ring} />
      <span className="dflb-podium-name">{row.username}</span>
      <span className="dflb-podium-score">{row.totalScore} pts</span>
      <span className="dflb-podium-margin">{row.puzzlesCompleted}/{DAILY_PUZZLE_SLOT_COUNT} · M{DAILY_PUZZLE_SLOT_COUNT} {row.masterChainScore}</span>
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

export default function DailyPuzzleLadderLeaderboardScreen({
  user,
  runDate,
  currentUsername = null,
  currentUserId = null,
  glickoRating = null,
  onBack,
  onNavigate,
}: DailyPuzzleLadderLeaderboardScreenProps) {
  const [rows, setRows] = useState<DailyPuzzleLeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeaderboardFilter>('global');
  const [friendUsernames, setFriendUsernames] = useState<Set<string>>(new Set());
  const [countdownTick, setCountdownTick] = useState(0);
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
      const data = await fetchDailyPuzzleLadderLeaderboard(runDate);
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
    () => rows.find((row) => isCurrentUserRow(row, currentUserId, currentUsername)) ?? null,
    [rows, currentUserId, currentUsername],
  );

  const [ladderShareText, setLadderShareText] = useState('');

  useEffect(() => {
    if (!selfRow) {
      setLadderShareText('');
      return;
    }
    let cancelled = false;
    void getTodayDailyPuzzleLadder()
      .then((today) => {
        if (cancelled) return;
        const attempt = today.attempt;
        if (attempt?.status !== 'completed') {
          setLadderShareText('');
          return;
        }
        const profileRating =
          typeof glickoRating === 'number' && Number.isFinite(glickoRating)
            ? Math.round(glickoRating)
            : undefined;
        const data = buildLadderShareData({
          runDate: today.runDate,
          attempt,
          rank: selfRow.rank,
          shareStreak: getDisplayStreak(today.runDate),
          shareRating: profileRating,
        });
        setLadderShareText(buildLadderShareText(data));
      })
      .catch(() => {
        if (!cancelled) setLadderShareText('');
      });
    return () => {
      cancelled = true;
    };
  }, [selfRow, runDate, glickoRating]);

  const handleShareResult = useCallback(() => {
    if (!ladderShareText) return;
    track('share_initiated', { mode: 'daily_puzzle_ladder' });
    invokeLadderShareResult(ladderShareText, () => {
      setShareDone(true);
      window.setTimeout(() => setShareDone(false), 2000);
    });
  }, [ladderShareText]);

  const podiumSlots = useMemo(
    () => [rows[0] ?? null, rows[1] ?? null, rows[2] ?? null] as const,
    [rows],
  );

  const fastestFinisher = useMemo(() => {
    const finishers = rows.filter((row) => row.completedAt);
    if (finishers.length === 0) return null;
    return [...finishers].sort(
      (a, b) => new Date(a.completedAt!).getTime() - new Date(b.completedAt!).getTime(),
    )[0];
  }, [rows]);

  const topScore = useMemo(() => {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.totalScore - a.totalScore)[0];
  }, [rows]);

  const isSparse = !loading && !error && filteredRows.length > 0 && filteredRows.length < SPARSE_ROW_THRESHOLD;
  const playerCountLabel = `${rows.length} ${rows.length === 1 ? 'player' : 'players'}`;

  return (
    <div className="rh-hub-screen dflb-page dflb-page--ladder daily-puzzle-root">
      <div className="rh-hub-shell">
        <GlobalNav
          currentMode="leaderboard"
          activeColor="var(--accent-blue, #4cc9f0)"
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
          <div className="rh-hub-inner dflb-inner">
            <header className="dflb-command">
              <div className="dflb-command-hero">
                <div className="dflb-command__brand">
                  <span className="rh-hub-tag dflb-eyebrow dflb-eyebrow--ladder">Daily Puzzle Ladder</span>
                  <h1 className="dflb-command__title">Leaderboard</h1>
                  <p className="dflb-command__sub">
                    Global ranking · Climb five puzzles for today&apos;s ladder total.
                  </p>
                </div>
                <div className="dflb-command__aside">
                  <div className="dflb-command__actions">
                    {ladderShareText ? (
                      <button
                        type="button"
                        className="dpl-share-result-btn dflb-share-result-btn"
                        onClick={handleShareResult}
                      >
                        {shareDone ? 'Copied' : 'Share Result'}
                      </button>
                    ) : null}
                    <button type="button" className="dflb-back-link rh-back-button" onClick={onBack}>
                      <span aria-hidden>←</span>
                      Back to Ladder
                    </button>
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
                      label="Top score"
                      name={topScore?.username ?? null}
                      value={topScore ? `${topScore.totalScore} pts` : '—'}
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
                            <dt>Total</dt>
                            <dd>{selfRow.totalScore}</dd>
                          </div>
                          <div>
                            <dt>Ladder</dt>
                            <dd>{selfRow.puzzlesCompleted}/{DAILY_PUZZLE_SLOT_COUNT}</dd>
                          </div>
                          <div>
                            <dt>Best</dt>
                            <dd>{getDailyPuzzleBestSlotDisplay(selfRow.breakdown).label}</dd>
                          </div>
                        </dl>
                      </div>
                    ) : (
                      <div className="dflb-you-empty">
                        <p>Finish today&apos;s ladder to take your place.</p>
                      </div>
                    )}
                  </section>
                </div>
              </aside>

              <section className="dflb-standings" aria-label="Daily Puzzle Ladder standings">
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
                    <span>Ladder</span>
                    <span>Total</span>
                    <span>Best</span>
                    <span>Time</span>
                    <span>Puzzles</span>
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
                    {!loading && error ? (
                      <p className="dflb-state dflb-state--error" role="alert">
                        Couldn&apos;t load the leaderboard. Please try again.
                      </p>
                    ) : null}
                    {!loading && !error && filteredRows.length === 0 ? (
                      <div className="dflb-empty-board">
                        <p className="dflb-state">No runs match this filter yet.</p>
                        <p className="dflb-empty-hint">Complete today&apos;s Daily Puzzle Ladder to claim the first spot.</p>
                      </div>
                    ) : null}
                    {!loading && !error
                      ? filteredRows.map((row) => (
                          <LeaderboardRow
                            key={`${row.rank}-${row.userId}-${row.completedAt ?? 'pending'}`}
                            row={row}
                            currentUserId={currentUserId}
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
                        <p className="dflb-standings-foot__title">More ladder scores on the way</p>
                        <p className="dflb-standings-foot__sub">
                          Players will appear as they complete today&apos;s puzzle ladder.
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
