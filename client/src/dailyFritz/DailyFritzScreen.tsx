import { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { UserProfile } from '../auth/useAuth';
import type { GhostProfileSummary } from '../ghost/api';
import BotMatchScreen from '../bot/BotMatchScreen';
import LeaderboardPageShell, { type LeaderboardSummaryCard } from '../ui/LeaderboardPageShell';
import DailyFritzLeaderboard from './DailyFritzLeaderboard';
import {
  ClaudePrimaryAction,
  ClaudeSecondaryAction,
  ClaudeSectionLabel,
  ClaudeStatLine,
} from '../ui/claudeMode';
import {
  fetchDailyFritzLeaderboard,
  getTodayDailyFritz,
  startDailyFritz,
  type DailyFritzLeaderboardRow,
  type DailyFritzStartResponse,
  type DailyFritzTodayResponse,
} from './api';
import './dailyFritz.css';

const DAILY_FRITZ_TODAY_CACHE_PREFIX = 'racehorse:daily-fritz:today:';

interface DailyFritzScreenProps {
  user: User | null;
  profile: UserProfile | null;
  ghostProfile: GhostProfileSummary | null;
  onGhostProfileChange: (profile: GhostProfileSummary | null) => void;
  onProfileRefresh?: () => Promise<void> | void;
  onProfilePatch?: (patch: Partial<UserProfile>) => void;
  onOpenAuth: () => void;
  onBack: () => void;
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

function formatLeaderboardDateLabel(dateText: string): string {
  const parsed = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dateText;
  return parsed.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function titleCaseTier(tier: string): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

function tierDisplayLabel(tier: string): string {
  if (tier === 'elite') return 'Elite (1800)';
  return titleCaseTier(tier);
}

function createMockDailyFritzRun(): DailyFritzStartResponse {
  return {
    ok: true,
    attempt_id: 'dev-attempt',
    verified_match_id: 'dev-match',
    run_date: '2026-04-17',
    current_hand_index: 0,
    fritz_tier: 'standard',
    deal_size: 7,
    winning_score: 60,
    first_hand: {
      player_tiles: [
        { low: 6, high: 6 },
        { low: 4, high: 6 },
        { low: 1, high: 4 },
        { low: 0, high: 5 },
        { low: 2, high: 3 },
        { low: 1, high: 1 },
        { low: 0, high: 0 },
      ],
      fritz_tiles: [
        { low: 5, high: 5 },
        { low: 3, high: 5 },
        { low: 2, high: 5 },
        { low: 4, high: 4 },
        { low: 0, high: 4 },
        { low: 2, high: 2 },
        { low: 3, high: 6 },
      ],
      boneyard: [
        { low: 1, high: 6 },
        { low: 0, high: 6 },
        { low: 2, high: 6 },
        { low: 3, high: 3 },
        { low: 0, high: 3 },
        { low: 1, high: 5 },
        { low: 4, high: 5 },
        { low: 1, high: 2 },
        { low: 2, high: 4 },
        { low: 3, high: 4 },
        { low: 1, high: 3 },
        { low: 0, high: 1 },
        { low: 5, high: 6 },
        { low: 0, high: 2 },
      ],
      locked: [
        { low: 2, high: 2 },
        { low: 3, high: 3 },
      ],
    },
  };
}

export default function DailyFritzScreen({
  user,
  profile,
  ghostProfile,
  onGhostProfileChange,
  onProfileRefresh,
  onProfilePatch,
  onOpenAuth,
  onBack,
}: DailyFritzScreenProps) {
  const mockDailyFritzEnabled =
    import.meta.env.DEV &&
    typeof window !== 'undefined' &&
    window.localStorage.getItem('DEV_MOCK_DAILY_FRITZ') === '1';
  const [today, setToday] = useState<DailyFritzTodayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<DailyFritzLeaderboardRow[]>([]);
  const [activeRun, setActiveRun] = useState<DailyFritzStartResponse | null>(() =>
    mockDailyFritzEnabled ? createMockDailyFritzRun() : null,
  );

  const cacheKey = useMemo(
    () => (user?.id ? `${DAILY_FRITZ_TODAY_CACHE_PREFIX}${user.id}` : null),
    [user?.id],
  );

  useEffect(() => {
    if (!cacheKey || typeof window === 'undefined') return;
    try {
      const raw = window.sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as DailyFritzTodayResponse | null;
      if (!parsed?.run_date) return;
      setToday(parsed);
      setLoading(false);
    } catch {
      // no-op
    }
  }, [cacheKey]);

  const loadToday = useCallback(async () => {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setLoading((prev) => !today && prev !== false ? true : !today);
    setError(null);
    try {
      const response = await getTodayDailyFritz();
      setToday(response);
      if (cacheKey && typeof window !== 'undefined') {
        window.sessionStorage.setItem(cacheKey, JSON.stringify(response));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Daily Fritz.');
    } finally {
      const endedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.log('[daily-fritz-client] loadToday', {
        hadCachedToday: Boolean(today),
        userId: user?.id ?? null,
        totalMs: Number((endedAt - startedAt).toFixed(1)),
      });
      setLoading(false);
    }
  }, [cacheKey, today, user?.id]);

  useEffect(() => {
    if (!user) {
      setToday(null);
      setLoading(false);
      setError('Sign in to play Daily Fritz.');
      return;
    }
    void loadToday();
  }, [loadToday, user]);

  const openLeaderboard = useCallback(async () => {
    if (!today?.run_date) return;
    setLeaderboardOpen(true);
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    try {
      const rows = await fetchDailyFritzLeaderboard(today.run_date);
      setLeaderboard(rows);
    } catch (err) {
      setLeaderboardError(err instanceof Error ? err.message : 'Failed to load leaderboard.');
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, [today?.run_date]);

  const beginRun = useCallback(async () => {
    setError(null);
    try {
      const started = await startDailyFritz();
      setActiveRun(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Daily Fritz.');
    }
  }, []);

  const finishEmbeddedRun = useCallback(async () => {
    setActiveRun(null);
    await loadToday();
  }, [loadToday]);

  const primaryLabel = useMemo(() => {
    if (!today) return 'Start Today’s Run';
    if (today.attempt_status === 'started') return 'Resume';
    if (today.attempt_status === 'completed') return 'Completed';
    if (today.attempt_status === 'abandoned') return 'Attempt Spent';
    return 'Start Today’s Run';
  }, [today]);

  const currentUsername = profile?.username?.trim() ?? null;
  const currentLeaderboardRow = useMemo(
    () =>
      leaderboard.find((row) =>
        Boolean(row.is_current_user) ||
        (currentUsername != null &&
          currentUsername.trim().length > 0 &&
          row.username.trim().toLowerCase() === currentUsername.trim().toLowerCase()),
      ) ?? null,
    [currentUsername, leaderboard],
  );
  const leaderboardSummaryCards = useMemo<LeaderboardSummaryCard[]>(() => {
    const rankValue =
      currentLeaderboardRow?.rank != null
        ? `#${currentLeaderboardRow.rank}`
        : today?.rank != null
          ? `#${today.rank}`
          : '—';
    const scoreValue = currentLeaderboardRow
      ? `${currentLeaderboardRow.finalScore}-${currentLeaderboardRow.opponentScore}`
      : today?.result
        ? `${Number(today.result.final_score ?? 0)}-${Number(today.result.opponent_score ?? 0)}`
        : '—';
    const diffValue = currentLeaderboardRow
      ? `${currentLeaderboardRow.pointDiff >= 0 ? '+' : ''}${currentLeaderboardRow.pointDiff}`
      : '—';
    const resultValue = currentLeaderboardRow
      ? currentLeaderboardRow.won ? 'Win' : 'Loss'
      : today?.result
        ? Boolean(today.result.won) ? 'Win' : 'Loss'
        : '—';
    const diffTone =
      currentLeaderboardRow == null
        ? 'neutral'
        : currentLeaderboardRow.pointDiff < 0
          ? 'danger'
          : currentLeaderboardRow.pointDiff > 0
            ? 'success'
            : 'neutral';
    const resultTone =
      currentLeaderboardRow == null && !today?.result
        ? 'neutral'
        : currentLeaderboardRow
          ? currentLeaderboardRow.won ? 'success' : 'danger'
          : Boolean(today?.result?.won)
            ? 'success'
            : 'danger';

    return [
      { label: 'Your Rank', value: rankValue, sublabel: 'Where you finished today', tone: 'accent' },
      { label: 'Score', value: scoreValue, sublabel: 'Your score against Fritz', tone: 'neutral' },
      { label: 'Diff', value: diffValue, sublabel: 'Final point margin', tone: diffTone },
      { label: 'Result', value: resultValue, sublabel: 'Win or loss today', tone: resultTone },
    ];
  }, [currentLeaderboardRow, today]);
  const showAuthPrompt =
    !loading &&
    Boolean(
      error &&
        (error.toLowerCase() === 'unauthorized' ||
          error.toLowerCase().includes('unauthorized')),
    );

  if (activeRun) {
    return (
      <BotMatchScreen
        onBack={() => {
          setActiveRun(null);
          void loadToday();
        }}
        mode="daily-fritz"
        userId={user?.id ?? null}
        username={profile?.username ?? null}
        dealSize={activeRun.deal_size}
        fritzTier={activeRun.fritz_tier}
        winningScore={activeRun.winning_score}
        currentGlickoRating={profile?.glicko_rating ?? null}
        ghostProfile={ghostProfile}
        onGhostProfileChange={onGhostProfileChange}
        onProfileRefresh={onProfileRefresh}
        onProfilePatch={onProfilePatch}
        dailyFritzPackage={activeRun}
        onDailyFritzComplete={() => {
          void finishEmbeddedRun();
        }}
      />
    );
  }

  if (leaderboardOpen) {
    return (
      <LeaderboardPageShell
        mode="fritz"
        className="mode-subpage-screen mode-accent-daily-fritz"
        label="Daily Fritz"
        title="Leaderboard"
        subtitle={`${today ? formatLeaderboardDateLabel(today.run_date) : 'Today'} · Global ranking`}
        backLabel="Back to Daily Fritz"
        summaryCards={leaderboardSummaryCards}
        resultsLabel={`Global Results · ${leaderboard.length} ${leaderboard.length === 1 ? 'player' : 'players'}`}
        onClose={() => setLeaderboardOpen(false)}
      >
        <DailyFritzLeaderboard
          rows={leaderboard}
          loading={leaderboardLoading}
          error={leaderboardError}
          currentUsername={currentUsername}
          variant="page"
        />
      </LeaderboardPageShell>
    );
  }

  return (
    <div className="screen daily-fritz-screen mode-subpage-screen mode-accent-daily-fritz">
      <div className="daily-dash" style={{ ['--dash-accent' as string]: '#e05c6a' }}>

        {/* ── Top bar ── */}
        <header className="daily-dash-topbar">
          <div className="daily-dash-brand">RACEHORSE</div>
          <button type="button" className="daily-dash-back" onClick={onBack}>
            <svg viewBox="0 0 12 12" aria-hidden="true">
              <path d="M7.5 2L3 6l4.5 4" />
            </svg>
            Back to Home
          </button>
        </header>

        {/* ── Main content ── */}
        <main className="daily-dash-main">

          {/* Header */}
          <div className="daily-dash-header">
            <p className="daily-dash-eyebrow">Daily Fritz</p>
            <h1 className="daily-dash-title">Daily Fritz Match</h1>
            <p className="daily-dash-subtitle">Same deal for everyone. One run only.</p>
          </div>

          <div className="daily-dash-separator" aria-hidden="true" />

          {/* Body — varies by load/auth/data state */}
          {loading ? (
            <div className="daily-fritz-empty claude-mode-card">Loading today’s run…</div>
          ) : showAuthPrompt ? (
            <div className="daily-dash-body daily-fritz-home-body">
              <div className="daily-dash-details daily-fritz-home-primary">
                <div className="daily-fritz-empty claude-mode-card">
                  <p>Sign in to play Daily Fritz.</p>
                </div>
              </div>
              <div className="daily-dash-actions daily-fritz-home-secondary">
                <ClaudePrimaryAction accent="#e05c6a" title="Sign In" meta="Open account access" onClick={onOpenAuth} />
              </div>
            </div>
          ) : error ? (
            <div className="daily-fritz-empty claude-mode-card">{error}</div>
          ) : today ? (
            <div className="daily-dash-body daily-fritz-home-body">
              <div className="daily-dash-details daily-fritz-home-primary">
                <div className="claude-mode-info-card">
                  <ClaudeSectionLabel color="#e05c6a">Match Details</ClaudeSectionLabel>
                  <ClaudeStatLine label="Date" value={formatDateLabel(today.run_date)} />
                  <ClaudeStatLine label="Tier" value={tierDisplayLabel(today.fritz_tier)} accent={today.fritz_tier === 'elite' ? '#ff7070' : undefined} />
                  <ClaudeStatLine label="Mode" value={`${today.deal_size}-tile`} />
                  <ClaudeStatLine
                    label="Streak"
                    value={`${today.streak} day${today.streak === 1 ? '' : 's'}`}
                    accent="#e05c6a"
                  />
                </div>

                {today.attempt_status === 'completed' && (
                  <section className="daily-fritz-summary-strip claude-mode-card" aria-label="Daily Fritz result summary">
                    <div className="daily-fritz-summary-strip-header">
                      <span className="daily-fritz-status-label">Result Summary</span>
                    </div>
                    <div className="daily-fritz-summary-strip-grid">
                      <div className="daily-fritz-summary-item">
                        <span className="daily-fritz-summary-label">Result</span>
                        <strong className={`daily-fritz-summary-value ${Boolean(today.result?.won) ? 'is-win' : 'is-loss'}`}>
                          {Boolean(today.result?.won) ? 'Win' : 'Loss'}
                        </strong>
                      </div>
                      <div className="daily-fritz-summary-item">
                        <span className="daily-fritz-summary-label">Score</span>
                        <strong className="daily-fritz-summary-value">
                          {Number(today.result?.final_score ?? 0)}-{Number(today.result?.opponent_score ?? 0)}
                        </strong>
                      </div>
                      <div className="daily-fritz-summary-item">
                        <span className="daily-fritz-summary-label">Point Diff</span>
                        <strong className="daily-fritz-summary-value">
                          {Number(today.result?.point_diff ?? 0) >= 0 ? '+' : ''}
                          {Number(today.result?.point_diff ?? 0)}
                        </strong>
                      </div>
                      <div className="daily-fritz-summary-item">
                        <span className="daily-fritz-summary-label">Rank</span>
                        <strong className="daily-fritz-summary-value">{today.rank ? `#${today.rank}` : '—'}</strong>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              <div className="daily-dash-actions daily-fritz-home-secondary">
                {today.attempt_status === 'started' && (
                  <div className="daily-fritz-status-card is-active claude-mode-card">
                    <span className="daily-fritz-status-label">In Progress</span>
                    <strong>Resume your run.</strong>
                    <p>Your spot is saved.</p>
                  </div>
                )}

                {today.attempt_status === 'completed' && (
                  <div className="daily-fritz-status-card is-complete-panel claude-mode-card">
                    <span className="daily-fritz-status-label">Completed</span>
                    <strong>Today’s run is locked.</strong>
                    <p>Your result is posted. Leaderboard remains available as a secondary view.</p>
                  </div>
                )}

                {today.attempt_status === 'abandoned' && (
                  <div className="daily-fritz-status-card is-muted claude-mode-card">
                    <span className="daily-fritz-status-label">Spent</span>
                    <strong>Today’s run is spent.</strong>
                    <p>Come back tomorrow for a new one.</p>
                  </div>
                )}

                {today.attempt_status !== 'completed' && today.attempt_status !== 'abandoned' ? (
                  <ClaudePrimaryAction
                    accent="#e05c6a"
                    onClick={() => void beginRun()}
                    title={today.attempt_status === 'started' ? 'Resume Match' : 'Start Daily Fritz Match'}
                    meta={
                      today.attempt_status === 'started'
                        ? 'Pick up where you left off'
                        : 'Play today’s fixed Fritz match'
                    }
                  />
                ) : null}

                <div className="daily-fritz-secondary-panel claude-mode-card">
                  <ClaudeSecondaryAction
                    title="Leaderboard"
                    meta="See today’s standings"
                    onClick={() => void openLeaderboard()}
                  />
                </div>
              </div>
            </div>
          ) : null}

        </main>
      </div>
    </div>
  );
}
