import { memo, useEffect, useMemo, useState } from 'react';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { useSyncNow } from '../ui/useSyncNow';
import type { Registration, ScheduledTournament } from './types';
import { deriveTournamentHubViewModel, type TournamentRecoveryMatch } from './hubState';
import { isTerminalTournamentMatch } from './terminalMatches';
import './tournamentHub.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentHubScreenProps {
  identity: Identity;
  upcoming: ScheduledTournament[];
  registrations: Registration[];
  recoveryMatch: TournamentRecoveryMatch;
  tournamentPhase?: import('./types').TournamentUserPhase | null;
  activeTournamentId?: string | null;
  error: string | null;
  isLoading: boolean;
  hasLoaded: boolean;
  activeBracketStatus?: ScheduledTournament['status'] | null;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onBackHome: () => void;
  onOpenBracket: (tournamentId: string) => void;
  onRegister: (tournamentId: string) => void | Promise<void>;
  onWithdraw: (tournamentId: string) => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  onAttachAssignedMatch: (matchId: string) => void | Promise<void>;
  attachJoinPhase?: 'idle' | 'pending' | 'failed';
  attachJoinError?: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatCountdown(ms: number): string {
  const safe = Math.max(0, ms);
  const totalS = Math.floor(safe / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function buildTournamentCountdownLabel(targetMs: number | null): string {
  if (targetMs == null || !Number.isFinite(targetMs)) return '--:--:--';
  return formatCountdown(targetMs - Date.now());
}

function formatTimePst(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusFor(t: ScheduledTournament): { label: string; cls: string } {
  if (t.status === 'registration_open') return { label: 'Open', cls: 'th-card__status--open' };
  const startMs = Date.parse(t.scheduled_start);
  if (startMs - Date.now() < 30 * 60 * 1000) return { label: 'Starting Soon', cls: 'th-card__status--soon' };
  return { label: 'Upcoming', cls: 'th-card__status--upcoming' };
}

function useScheduledBoundaryTick(boundaryTimes: readonly number[]): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const boundaryKey = useMemo(() => boundaryTimes.join(','), [boundaryTimes]);

  useEffect(() => {
    if (boundaryTimes.length === 0) return;
    const currentNow = Date.now();
    const nextBoundary = boundaryTimes.find((ts) => ts > currentNow) ?? null;
    if (nextBoundary == null) return;
    const timer = window.setTimeout(
      () => setNowMs(Date.now()),
      Math.max(0, nextBoundary - currentNow + 50),
    );
    return () => window.clearTimeout(timer);
  }, [boundaryKey, boundaryTimes]);

  return nowMs;
}

const TournamentCountdownText = memo(function TournamentCountdownText({
  targetMs,
  fallback = '--:--:--',
}: {
  targetMs: number | null;
  fallback?: string;
}) {
  const validTarget = targetMs != null && Number.isFinite(targetMs);
  const now = useSyncNow(1000, validTarget);
  void now;
  const label = validTarget ? buildTournamentCountdownLabel(targetMs) : fallback;

  return <>{label}</>;
});

const TournamentCardStatus = memo(function TournamentCardStatus({
  tournament,
}: {
  tournament: ScheduledTournament;
}) {
  const startSoonAtMs = useMemo(
    () => Date.parse(tournament.scheduled_start) - 30 * 60 * 1000,
    [tournament.scheduled_start],
  );
  const needsStatusTick =
    tournament.status === 'registration_open' ||
    (Number.isFinite(startSoonAtMs) && Date.now() < startSoonAtMs);
  const now = useSyncNow(1000, needsStatusTick);
  void now;
  const status = useMemo(() => statusFor(tournament), [tournament, now]);

  return <span className={`th-card__status ${status.cls}`}>{status.label}</span>;
});

const TournamentCard = memo(function TournamentCard({
  tournament,
  registered,
  userId,
  onRegister,
  onWithdraw,
}: {
  tournament: ScheduledTournament;
  registered: boolean;
  userId: string | null;
  onRegister: (tournamentId: string) => void | Promise<void>;
  onWithdraw: (tournamentId: string) => void | Promise<void>;
}) {
  const open = tournament.status === 'registration_open';
  const count = tournament.registered_count ?? 0;
  const isFull = count >= tournament.max_players;
  const fillPct = Math.max(0, Math.min(100, (count / tournament.max_players) * 100));
  const showFirstRegisterCopy = count === 0 && tournament.status === 'upcoming';

  return (
    <div className="th-card">
      <div className="th-card__time">{formatTimePst(tournament.scheduled_start)}</div>
      <div className="th-card__middle">
        <div className="th-card__count">
          {showFirstRegisterCopy
            ? 'Be the first to register'
            : `${count} / ${tournament.max_players} Registered`}
        </div>
        <div className="th-card__bar">
          <span className="th-card__bar-fill" style={{ width: `${fillPct}%` }} />
        </div>
        {!showFirstRegisterCopy ? (
          <div className="th-card__count-sub">
            {isFull ? 'All seats claimed' : `${tournament.max_players - count} seats remaining`}
          </div>
        ) : (
          <div className="th-card__count-sub">Registration opens 30 minutes before start.</div>
        )}
        <TournamentCardStatus tournament={tournament} />
      </div>
      <div className="th-card__actions">
        {registered ? (
          <>
            <span className="th-card__registered">Registered ✓</span>
            {open ? (
              <button
                className="th-card__withdraw"
                onClick={() => void onWithdraw(tournament.id)}
              >
                Withdraw
              </button>
            ) : null}
          </>
        ) : isFull ? (
          <span className="th-card__full">Full</span>
        ) : !open ? (
          <span className="th-card__soon">Opens soon</span>
        ) : (
          <button
            className="th-cta"
            disabled={!userId}
            onClick={() => void onRegister(tournament.id)}
          >
            Register
          </button>
        )}
      </div>
    </div>
  );
});

function tournamentBoundaryTimes(tournament: ScheduledTournament | null): number[] {
  if (!tournament) return [];
  return [
    Date.parse(tournament.registration_close_at),
    Date.parse(tournament.scheduled_start),
  ].filter((ts) => Number.isFinite(ts));
}

function Trophy() {
  return (
    <svg className="th-trophy-svg" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="th-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6c45a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#b8782b" />
        </linearGradient>
      </defs>
      <path d="M50 30h100v50a50 50 0 0 1-100 0V30z" fill="url(#th-gold)" />
      <path d="M50 50 H20 a20 20 0 0 0 30 35" fill="none" stroke="url(#th-gold)" strokeWidth="6" />
      <path d="M150 50 H180 a20 20 0 0 1 -30 35" fill="none" stroke="url(#th-gold)" strokeWidth="6" />
      <rect x="80" y="130" width="40" height="40" fill="url(#th-gold)" opacity="0.85" />
      <rect x="60" y="170" width="80" height="14" rx="3" fill="url(#th-gold)" />
      <rect x="50" y="184" width="100" height="20" rx="4" fill="url(#th-gold)" />
    </svg>
  );
}

function CheckBadgeArt() {
  return (
    <div className="th-confirmation-mark" aria-hidden>
      <span>✓</span>
    </div>
  );
}

export default function TournamentHubScreen(props: TournamentHubScreenProps) {
  const userId = props.identity?.userId ?? null;
  const nextTournament = props.upcoming[0] ?? null;
  const registeredTournamentIds = useMemo(
    () =>
      new Set(
        props.registrations
          .filter((r) => r.status === 'registered' || r.status === 'active')
          .map((r) => r.tournament_id),
      ),
    [props.registrations],
  );
  const hubBoundaryTimes = useMemo(
    () => tournamentBoundaryTimes(nextTournament),
    [nextTournament],
  );
  const hubNowMs = useScheduledBoundaryTick(hubBoundaryTimes);

  const hubState = useMemo(
    () =>
      deriveTournamentHubViewModel({
        upcoming: props.upcoming,
        registrations: props.registrations,
        recoveryMatch: props.recoveryMatch,
        tournamentPhase: props.tournamentPhase ?? null,
        activeTournamentId: props.activeTournamentId ?? null,
        activeBracketStatus: props.activeBracketStatus ?? null,
        isLoading: props.isLoading,
        hasLoaded: props.hasLoaded,
        error: props.error,
        nowMs: hubNowMs,
      }),
    [
      props.upcoming,
      props.registrations,
      props.recoveryMatch,
      props.tournamentPhase,
      props.activeTournamentId,
      props.activeBracketStatus,
      props.isLoading,
      props.hasLoaded,
      props.error,
      hubNowMs,
    ],
  );

  const nextTournamentRegistered = nextTournament
    ? registeredTournamentIds.has(nextTournament.id)
    : false;

  const lobbyBracketTournamentId = useMemo(() => {
    if (props.activeTournamentId) return props.activeTournamentId;
    return props.upcoming.find((t) => registeredTournamentIds.has(t.id))?.id ?? null;
  }, [props.activeTournamentId, props.upcoming, registeredTournamentIds]);

  const showLobbyBracketBanner =
    Boolean(lobbyBracketTournamentId) &&
    (props.tournamentPhase === 'registered' || props.tournamentPhase === 'bracket_lobby');
  const countdownTargetMs = useMemo(
    () =>
      nextTournament
        ? nextTournament.status === 'registration_open'
          ? Date.parse(nextTournament.registration_close_at)
          : Date.parse(nextTournament.scheduled_start)
        : null,
    [nextTournament],
  );
  const countdownLabel = nextTournament?.status === 'registration_open'
    ? 'Registration Closes In'
    : 'Next Tournament In';
  const countdownDetail = nextTournament?.status === 'registration_open'
    ? 'Claim your seat before registration closes.'
    : hubState.detail;
  const visibleUpcoming = useMemo(() => props.upcoming.slice(0, 3), [props.upcoming]);

  return (
    <div className="th-page">
      <GlobalNav
        currentMode={'tournament' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        onOpenAccount={props.onOpenAccount}
        activeColor="var(--accent-amber)"
      />
      <div className="th-shell">
        <div className="th-toolbar">
          <button type="button" className="th-back" onClick={props.onBackHome}>
            <span aria-hidden>←</span> Back to Home
          </button>
        </div>

        <div className="th-layout">
          <div className="th-left">
            <div>
              <p className="th-kicker">Tournament</p>
              <h1 className="th-title">Compete</h1>
              <p className="th-desc">8-player bracket. First to 30 wins. One champion every 30 minutes.</p>
            </div>
            <div
              className={`th-trophy-stage${nextTournamentRegistered && nextTournament?.status !== 'completed' ? ' th-trophy-stage--confirmed' : ''}`}
              aria-hidden
            >
              {nextTournamentRegistered && nextTournament?.status !== 'completed' ? (
                <div className="th-confirmation-stage">
                  <CheckBadgeArt />
                  <div className="th-confirmation-copy">
                    <span className="th-confirmation-eyebrow">Seat Confirmed</span>
                    <strong>You're registered</strong>
                    <span>Your entry is locked in for the next bracket.</span>
                  </div>
                </div>
              ) : (
                <Trophy />
              )}
            </div>
            <div className="th-features">
              <div className="th-feature">
                <div className="th-feature__header">8 Players</div>
                <div className="th-feature__desc">Single-elimination bracket.</div>
              </div>
              <div className="th-feature">
                <div className="th-feature__header">QF → SF → Final</div>
                <div className="th-feature__desc">Win three to take the crown.</div>
              </div>
              <div className="th-feature">
                <div className="th-feature__header">First to 30</div>
                <div className="th-feature__desc">Quick, decisive matches.</div>
              </div>
            </div>
          </div>

          <div className="th-panel">
            <div className="th-countdown">
              <span className="th-countdown__label">{nextTournament ? countdownLabel : hubState.title}</span>
              <span className="th-countdown__time" aria-live="polite">
                <TournamentCountdownText targetMs={countdownTargetMs} />
              </span>
              <span className="th-countdown__sub">
                {nextTournament ? countdownDetail : hubState.detail}
              </span>
            </div>

            {showLobbyBracketBanner && lobbyBracketTournamentId ? (
              <div className="th-recovery-banner">
                <div className="th-recovery-banner__copy">
                  <span className="th-recovery-banner__eyebrow">
                    {props.tournamentPhase === 'bracket_lobby' ? 'Bracket locked' : 'Registered'}
                  </span>
                  <span className="th-recovery-banner__title">
                    {props.tournamentPhase === 'bracket_lobby'
                      ? 'View your bracket and opponent'
                      : 'Return to the tournament lobby and bracket'}
                  </span>
                </div>
                <button
                  className="th-cta"
                  type="button"
                  onClick={() => props.onOpenBracket(lobbyBracketTournamentId)}
                >
                  View Bracket ›
                </button>
              </div>
            ) : null}

            {props.recoveryMatch &&
            props.tournamentPhase !== 'bracket_lobby' &&
            props.tournamentPhase !== 'completed' &&
            props.activeBracketStatus !== 'completed' &&
            props.activeBracketStatus !== 'cancelled' &&
            !isTerminalTournamentMatch(props.recoveryMatch.matchId) ? (
              <div className="th-recovery-banner">
                <div className="th-recovery-banner__copy">
                  <span className="th-recovery-banner__eyebrow">
                    {props.recoveryMatch.matchStatus === 'ready' ? 'Match Ready' : 'Match In Progress'}
                  </span>
                  <span className="th-recovery-banner__title">
                    {props.attachJoinPhase === 'pending'
                      ? 'Joining your assigned match…'
                      : props.attachJoinPhase === 'failed'
                        ? props.attachJoinError ?? 'Could not join match'
                        : props.recoveryMatch.matchStatus === 'ready'
                          ? 'Your match is ready — Start Match'
                          : 'Your match is in progress — Rejoin Match'}
                  </span>
                </div>
                <button
                  className="th-cta"
                  type="button"
                  disabled={props.attachJoinPhase === 'pending'}
                  onClick={() => void props.onAttachAssignedMatch(props.recoveryMatch!.matchId)}
                >
                  {props.attachJoinPhase === 'pending'
                    ? 'Joining match…'
                    : props.attachJoinPhase === 'failed'
                      ? 'Retry Join Match'
                      : props.recoveryMatch.matchStatus === 'ready'
                        ? 'Start Match'
                        : 'Rejoin Match'}
                </button>
              </div>
            ) : null}

            <div className="th-panel-body">
              {hubState.state === 'loading' ? (
                <div className="th-state-card" role="status" aria-live="polite">
                  <div className="th-spinner" aria-hidden />
                  <div className="th-state-card__text">
                    <strong>{hubState.title}</strong>
                    <span>{hubState.detail}</span>
                  </div>
                </div>
              ) : null}
              {hubState.state === 'api_error' ? (
                <div className="th-state-card th-state-card--error">
                  <div className="th-state-card__text">
                    <strong>{hubState.title}</strong>
                    <span>{hubState.detail}</span>
                  </div>
                  <button className="th-cta th-cta--ghost" onClick={() => void props.onRetry()}>
                    Retry
                  </button>
                </div>
              ) : null}
              {hubState.state === 'cancelled' ? (
                <div className="th-state-card th-state-card--cancelled">
                  <div className="th-state-card__text">
                    <strong>{hubState.title}</strong>
                    <span>{hubState.detail}</span>
                  </div>
                </div>
              ) : null}
              {hubState.state === 'eliminated' ? (
                <div className="th-state-card th-state-card--cancelled">
                  <div className="th-state-card__text">
                    <strong>{hubState.title}</strong>
                    <span>{hubState.detail}</span>
                  </div>
                </div>
              ) : null}
              {visibleUpcoming.map((t) => (
                <TournamentCard
                  key={t.id}
                  tournament={t}
                  registered={registeredTournamentIds.has(t.id)}
                  userId={userId}
                  onRegister={props.onRegister}
                  onWithdraw={props.onWithdraw}
                />
              ))}
              {props.hasLoaded && !props.error && props.upcoming.length === 0 ? (
                <p className="th-empty">No upcoming tournaments. Check back soon.</p>
              ) : null}
            </div>

            <div className="th-summary-strip">
              <div className="th-summary-item">
                <span className="th-summary-key">Format</span>
                <span className="th-summary-value">7-Tile</span>
              </div>
              <div className="th-summary-item">
                <span className="th-summary-key">Win Target</span>
                <span className="th-summary-value">First to 30</span>
              </div>
              <div className="th-summary-item">
                <span className="th-summary-key">Cadence</span>
                <span className="th-summary-value">Every 30 minutes</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
