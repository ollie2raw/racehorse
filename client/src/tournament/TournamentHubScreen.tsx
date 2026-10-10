import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppMode } from '../types';
import { GlobalNav } from '../components';
import { tournamentStageShortLabel } from './displayNames';
import { trackTournamentHubViewed } from './tournamentAnalytics';
import {
  deriveFritzCupCardState,
  deriveLiveEventCardState,
  selectHubLiveEvents,
  type FritzCupCardState,
  type LiveEventCardState,
} from './hubCardState';
import { fritzCupErrorCopy, registrationErrorCopy } from './tournamentErrorCopy';
import { formatCountdown, formatEventWhen } from './tournamentTime';
import { useTournamentNow } from './useTournamentNow';
import type { FritzLaunchState } from './useTournament';
import type {
  MyTournament,
  ScheduledTournament,
  TournamentAssignedPlayable,
  TournamentFeatures,
} from './types';
import './tournamentHub.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentHubScreenProps {
  identity: Identity;
  /** Null until the first response (or the build flag is off: pass tournaments false). */
  features: TournamentFeatures | null;
  upcoming: ScheduledTournament[];
  myTournaments: MyTournament[];
  activeAssignedMatch: TournamentAssignedPlayable | null;
  cancelledTournamentIds: ReadonlySet<string>;
  fritzLaunch: FritzLaunchState;
  upcomingError: string | null;
  myError: string | null;
  isLoading: boolean;
  hasLoaded: boolean;
  attachJoinPhase?: 'idle' | 'pending' | 'failed';
  attachJoinError?: string | null;
  /** Local zone override — tests only. */
  timeZone?: string;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
  onBackHome: () => void;
  /** Opens the History sub-view (signed in only). */
  onOpenHistory?: () => void;
  onPlayFritzCup: () => void;
  onJoinMatch: (matchId: string) => void;
  onViewBracket: (tournamentId: string) => void;
  onViewResult: (tournamentId: string) => void;
  onRegister: (tournamentId: string) => Promise<unknown>;
  onWithdraw: (tournamentId: string) => Promise<unknown>;
  onRetry: () => void;
  /** A countdown reached its boundary: re-read server state (deduplicated, backed off). */
  onBoundary: () => void;
}

/** Retry delays after a boundary while the server state has not moved on yet. */
export const BOUNDARY_REFRESH_BACKOFF_MS = [0, 2_000, 5_000, 15_000, 30_000, 60_000] as const;

/**
 * One refresh when a displayed countdown reaches zero, then a few backed-off
 * retries while that same boundary is still displayed (the server has not
 * advanced yet). Keys are `${tournamentId}:${boundary}`.
 */
function useBoundaryRefresh(boundaries: Array<{ key: string; atMs: number }>, nowMs: number, onBoundary: () => void) {
  const attemptsRef = useRef(new Map<string, { attempts: number; nextAtMs: number }>());
  useEffect(() => {
    const seen = new Set<string>();
    for (const { key, atMs } of boundaries) {
      seen.add(key);
      if (!Number.isFinite(atMs) || nowMs < atMs) continue;
      const entry = attemptsRef.current.get(key) ?? { attempts: 0, nextAtMs: atMs };
      if (entry.attempts >= BOUNDARY_REFRESH_BACKOFF_MS.length || nowMs < entry.nextAtMs) {
        attemptsRef.current.set(key, entry);
        continue;
      }
      const attempts = entry.attempts + 1;
      attemptsRef.current.set(key, { attempts, nextAtMs: nowMs + (BOUNDARY_REFRESH_BACKOFF_MS[attempts] ?? Infinity) });
      onBoundary();
    }
    for (const key of [...attemptsRef.current.keys()]) if (!seen.has(key)) attemptsRef.current.delete(key);
  }, [boundaries, nowMs, onBoundary]);
}

function countdownTo(iso: string, nowMs: number): number {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : 0;
}

function boundaryOf(state: LiveEventCardState): string | null {
  switch (state.kind) {
    case 'not_open': return state.opensAt;
    case 'open': return state.closesAt;
    case 'registered':
    case 'full':
    case 'bracket_set': return state.startsAt;
    case 'closed': return state.underway ? null : state.startsAt;
    default: return null;
  }
}

const NEAR_START_MS = 60 * 60_000;

function StatusChip({ tone, children }: { tone: 'ok' | 'muted' | 'warn'; children: React.ReactNode }) {
  return <span className={`th-chip th-chip--${tone}`}>{children}</span>;
}

function LiveEventCard(props: {
  event: ScheduledTournament;
  state: LiveEventCardState;
  compact: boolean;
  nowMs: number;
  signedIn: boolean;
  timeZone?: string;
  attachJoinPhase?: 'idle' | 'pending' | 'failed';
  attachJoinError?: string | null;
  onOpenAuth?: () => void;
  onJoinMatch: (matchId: string) => void;
  onViewBracket: (tournamentId: string) => void;
  onViewResult: (tournamentId: string) => void;
  onRegister: (tournamentId: string) => Promise<unknown>;
  onWithdraw: (tournamentId: string) => Promise<unknown>;
}) {
  const { event, state, nowMs } = props;
  const [pending, setPending] = useState<'register' | 'withdraw' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const when = formatEventWhen(event.scheduled_start, nowMs, { timeZone: props.timeZone });
  const showCount = ['not_open', 'open', 'full', 'registered', 'closed'].includes(state.kind) && !(state.kind === 'closed' && state.underway);
  const count = typeof event.registered_count === 'number' ? event.registered_count : null;

  const act = async (kind: 'register' | 'withdraw') => {
    if (pending) return;
    setPending(kind);
    setError(null);
    try {
      await (kind === 'register' ? props.onRegister(event.id) : props.onWithdraw(event.id));
    } catch (err) {
      setError(registrationErrorCopy(err, { timeZone: props.timeZone }));
    } finally {
      setPending(null);
    }
  };

  let status: React.ReactNode = null;
  let action: React.ReactNode = null;
  const startsIn = (iso: string) => `Starts in ${formatCountdown(countdownTo(iso, nowMs))}`;
  const joining = props.attachJoinPhase === 'pending';

  switch (state.kind) {
    case 'not_open': {
      const ms = countdownTo(state.opensAt, nowMs);
      status = ms > 0 ? `Registration opens in ${formatCountdown(ms)}` : 'Registration opens shortly';
      break;
    }
    case 'open':
      status = startsIn(state.startsAt);
      action = props.signedIn ? (
        <button type="button" className="th-cta" disabled={pending !== null} aria-busy={pending === 'register'} onClick={() => void act('register')}>
          {pending === 'register' ? 'Registering…' : 'Register'}
        </button>
      ) : (
        <button type="button" className="th-cta" onClick={props.onOpenAuth}>Sign in to register</button>
      );
      break;
    case 'full':
      status = <><StatusChip tone="muted">Full</StatusChip> {startsIn(state.startsAt)}</>;
      break;
    case 'registered':
      status = <><StatusChip tone="ok"><span aria-hidden>✓</span> Registered</StatusChip> {startsIn(state.startsAt)}</>;
      action = state.canWithdraw ? (
        <button type="button" className="th-cta th-cta--ghost" disabled={pending !== null} aria-busy={pending === 'withdraw'} onClick={() => void act('withdraw')}>
          {pending === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
        </button>
      ) : null;
      break;
    case 'closed': {
      if (state.underway) {
        status = 'In progress';
        break;
      }
      const ms = countdownTo(state.startsAt, nowMs);
      status = ms > 0 && ms <= NEAR_START_MS ? <>Registration closed · {startsIn(state.startsAt)}</> : 'Registration closed';
      break;
    }
    case 'bracket_set':
      status = `Bracket set · starts in ${formatCountdown(countdownTo(state.startsAt, nowMs))}`;
      action = <button type="button" className="th-cta th-cta--ghost" onClick={() => props.onViewBracket(event.id)}>View bracket</button>;
      break;
    case 'starting':
      status = <span className="th-inline-busy" role="status"><span className="th-spinner th-spinner--sm" aria-hidden /> Setting up your match…</span>;
      break;
    case 'match_ready':
      status = `Your ${tournamentStageShortLabel(state.round)} is ready`;
      action = (
        <button type="button" className="th-cta" disabled={joining} aria-busy={joining} onClick={() => props.onJoinMatch(state.matchId)}>
          {joining ? 'Joining…' : 'Join Match'}
        </button>
      );
      break;
    case 'in_match':
      status = `Your ${tournamentStageShortLabel(state.round)} is in progress`;
      action = (
        <button type="button" className="th-cta" disabled={joining} aria-busy={joining} onClick={() => props.onJoinMatch(state.matchId)}>
          {joining ? 'Joining…' : 'Resume Match'}
        </button>
      );
      break;
    case 'advanced':
      status = 'You advanced · next match is being set up';
      action = <button type="button" className="th-cta th-cta--ghost" onClick={() => props.onViewBracket(event.id)}>View bracket</button>;
      break;
    case 'eliminated':
      status = state.placementLabel ?? (state.exitRound ? `${tournamentStageShortLabel(state.exitRound)} finish` : 'Eliminated');
      action = <button type="button" className="th-cta th-cta--ghost" onClick={() => props.onViewBracket(event.id)}>View bracket</button>;
      break;
    case 'champion':
      status = <StatusChip tone="ok"><span aria-hidden>🏆</span> Champion</StatusChip>;
      action = <button type="button" className="th-cta" onClick={() => props.onViewResult(event.id)}>View result</button>;
      break;
    case 'cancelled':
      status = 'This event was cancelled';
      break;
    case 'finished':
      status = 'Finished';
      action = <button type="button" className="th-cta th-cta--ghost" onClick={() => props.onViewResult(event.id)}>View result</button>;
      break;
  }

  const joinFailed = (state.kind === 'match_ready' || state.kind === 'in_match') && props.attachJoinPhase === 'failed';

  return (
    <article
      className={`th-event${props.compact ? ' th-event--compact' : ''}${state.kind === 'cancelled' ? ' th-event--cancelled' : ''}`}
      aria-label={`Live Event, ${when}`}
      data-state={state.kind}
    >
      <div className="th-event__head">
        <span className="th-event__kicker">Live Event</span>
        <span className="th-event__when">{when}</span>
      </div>
      {showCount && !props.compact ? (
        <p className="th-event__meta">
          {count !== null && count > 0 ? `${count} registered · ` : ''}Fritz fills open seats
        </p>
      ) : null}
      <div className="th-event__row">
        <p className="th-event__status" aria-live="polite">{status}</p>
        {action ? <div className="th-event__action">{action}</div> : null}
      </div>
      {error ? <p className="th-event__error" role="alert">{error}</p> : null}
      {joinFailed ? <p className="th-event__error" role="alert">{props.attachJoinError ?? "Couldn't join your match. Try again."}</p> : null}
    </article>
  );
}

function FritzCupCard(props: {
  state: FritzCupCardState;
  timeZone?: string;
  attachJoinPhase?: 'idle' | 'pending' | 'failed';
  attachJoinError?: string | null;
  onPlay: () => void;
  onOpenAuth?: () => void;
  onJoinMatch: (matchId: string) => void;
  onViewBracket: (tournamentId: string) => void;
  onRetry: () => void;
}) {
  const { state } = props;
  if (state.kind === 'hidden') return null;
  const joining = props.attachJoinPhase === 'pending';
  let status: React.ReactNode = 'Beat Fritz, Elite Fritz, and Master Fritz to win the Cup.';
  let action: React.ReactNode = null;
  let error: string | null = null;

  switch (state.kind) {
    case 'sign_in':
      action = <button type="button" className="th-cta" onClick={props.onOpenAuth}>Sign in to play</button>;
      break;
    case 'play':
      action = <button type="button" className="th-cta" onClick={props.onPlay}>Play Fritz Cup</button>;
      break;
    case 'starting':
      action = <button type="button" className="th-cta" disabled aria-busy>Starting Fritz Cup…</button>;
      break;
    case 'building':
      status = <span className="th-inline-busy" role="status"><span className="th-spinner th-spinner--sm" aria-hidden /> Building your bracket…</span>;
      break;
    case 'slow':
      status = 'Taking longer than usual.';
      action = (
        <>
          {state.tournamentId ? <button type="button" className="th-cta th-cta--ghost" onClick={() => props.onViewBracket(state.tournamentId!)}>View bracket</button> : null}
          <button type="button" className="th-cta th-cta--ghost" onClick={props.onRetry}>Refresh</button>
        </>
      );
      break;
    case 'failed':
      error = fritzCupErrorCopy(state.launch.error, { timeZone: props.timeZone });
      action = <button type="button" className="th-cta" onClick={props.onPlay}>Play Fritz Cup</button>;
      break;
    case 'join':
      status = `Your ${tournamentStageShortLabel(state.round)} vs Fritz is ready`;
      action = (
        <button type="button" className="th-cta" disabled={joining} aria-busy={joining} onClick={() => props.onJoinMatch(state.matchId)}>
          {joining ? 'Joining…' : 'Join Match'}
        </button>
      );
      break;
    case 'resume':
      status = `Your ${tournamentStageShortLabel(state.round)} is in progress`;
      action = (
        <button type="button" className="th-cta" disabled={joining} aria-busy={joining} onClick={() => props.onJoinMatch(state.matchId)}>
          {joining ? 'Joining…' : 'Resume Fritz Cup'}
        </button>
      );
      break;
    case 'waiting':
      status = state.round ? `${tournamentStageShortLabel(state.round)} · your next match is being set up` : 'Your next match is being set up';
      action = <button type="button" className="th-cta th-cta--ghost" onClick={() => props.onViewBracket(state.tournamentId)}>Resume Fritz Cup</button>;
      break;
  }
  const inCup = state.kind === 'join' || state.kind === 'resume' || state.kind === 'waiting';
  const joinFailed = (state.kind === 'join' || state.kind === 'resume') && props.attachJoinPhase === 'failed';

  return (
    <article className="th-event th-event--fritz" aria-label="Fritz Cup" data-state={state.kind}>
      <div className="th-event__head">
        <span className="th-event__kicker">{inCup ? 'Your Fritz Cup' : 'Solo'}</span>
        <h2 className="th-event__title">Fritz Cup</h2>
      </div>
      {!inCup ? <p className="th-event__meta">Play now · 3 rounds vs Fritz</p> : null}
      <div className="th-event__row">
        <p className="th-event__status" aria-live="polite">{status}</p>
        {action ? <div className="th-event__action">{action}</div> : null}
      </div>
      {error ? <p className="th-event__error" role="alert">{error}</p> : null}
      {joinFailed ? <p className="th-event__error" role="alert">{props.attachJoinError ?? "Couldn't join your match. Try again."}</p> : null}
    </article>
  );
}

function SkeletonCard() {
  return <div className="th-event th-event--skeleton" aria-hidden />;
}

export default function TournamentHubScreen(props: TournamentHubScreenProps) {
  const signedIn = Boolean(props.identity?.userId);
  const nowMs = useTournamentNow(1000, props.hasLoaded);
  const disabled = props.features?.tournaments === false;

  const liveRows = useMemo(
    () => selectHubLiveEvents({ upcoming: props.upcoming, myTournaments: props.myTournaments, nowMs }),
    [props.upcoming, props.myTournaments, nowMs],
  );
  const liveCards = useMemo(
    () => liveRows.map((row) => ({
      ...row,
      state: deriveLiveEventCardState({
        event: row.event,
        mine: row.mine,
        playable: props.activeAssignedMatch,
        cancelled: props.cancelledTournamentIds.has(row.event.id),
        nowMs,
      }),
    })),
    [liveRows, props.activeAssignedMatch, props.cancelledTournamentIds, nowMs],
  );
  const fritzState = useMemo(
    () => deriveFritzCupCardState({
      features: props.features,
      signedIn,
      myTournaments: props.myTournaments,
      playable: props.activeAssignedMatch,
      launch: props.fritzLaunch,
    }),
    [props.features, signedIn, props.myTournaments, props.activeAssignedMatch, props.fritzLaunch],
  );

  const boundaries = useMemo(
    () => liveCards.flatMap(({ event, state }) => {
      const at = boundaryOf(state);
      return at ? [{ key: `${event.id}:${state.kind}:${at}`, atMs: Date.parse(at) }] : [];
    }),
    [liveCards],
  );
  useBoundaryRefresh(boundaries, nowMs, props.onBoundary);

  // Once per visit (a ref survives StrictMode's effect replay).
  const viewedRef = useRef(false);
  useEffect(() => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    trackTournamentHubViewed();
  }, []);

  const loading = props.isLoading && !props.hasLoaded;
  const cardProps = {
    nowMs,
    signedIn,
    timeZone: props.timeZone,
    attachJoinPhase: props.attachJoinPhase,
    attachJoinError: props.attachJoinError,
    onOpenAuth: props.onOpenAuth,
    onJoinMatch: props.onJoinMatch,
    onViewBracket: props.onViewBracket,
    onViewResult: props.onViewResult,
    onRegister: props.onRegister,
    onWithdraw: props.onWithdraw,
  };

  return (
    <div className="th-page">
      <GlobalNav
        currentMode={'tournament' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        onSignOut={props.onSignOut}
        activeColor="var(--accent-amber)"
      />
      <div className="th-shell">
        <div className="th-toolbar">
          <button type="button" className="th-back" onClick={props.onBackHome}>
            <span aria-hidden>←</span> Back to Home
          </button>
          {signedIn && !disabled && props.onOpenHistory ? (
            <button type="button" className="th-back th-history-link" onClick={props.onOpenHistory}>
              History
            </button>
          ) : null}
        </div>

        <div className="th-layout">
          <div className="th-left">
            <div>
              <p className="th-kicker">Tournaments</p>
              <h1 className="th-title">Compete</h1>
              <p className="th-desc">
                {props.features?.fritzCup
                  ? 'Play a Fritz Cup any time, or join a Live Event with other players.'
                  : 'Join a Live Event with other players.'}
              </p>
            </div>
            <ul className="th-format" aria-label="Format">
              <li>8 players</li>
              <li>3 rounds</li>
              <li>First to 30</li>
            </ul>
          </div>

          <div className="th-panel">
            <div className="th-panel-body" aria-busy={loading}>
              {disabled ? (
                <div className="th-state-card" role="status">
                  <div className="th-state-card__text">
                    <strong>Tournaments are unavailable right now</strong>
                    <span>Tournaments are coming back soon.</span>
                  </div>
                </div>
              ) : loading ? (
                <>
                  <span className="th-sr-only" role="status">Loading tournaments…</span>
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              ) : (
                <>
                  <FritzCupCard
                    state={fritzState}
                    timeZone={props.timeZone}
                    attachJoinPhase={props.attachJoinPhase}
                    attachJoinError={props.attachJoinError}
                    onPlay={props.onPlayFritzCup}
                    onOpenAuth={props.onOpenAuth}
                    onJoinMatch={props.onJoinMatch}
                    onViewBracket={props.onViewBracket}
                    onRetry={props.onRetry}
                  />

                  {liveCards.map((card, index) => (
                    <LiveEventCard key={card.event.id} event={card.event} state={card.state} compact={index > 0} {...cardProps} />
                  ))}

                  {liveCards.length === 0 && !props.upcomingError ? (
                    fritzState.kind === 'hidden' ? (
                      <div className="th-state-card" role="status">
                        <div className="th-state-card__text">
                          <strong>No tournaments right now</strong>
                          <span>No Live Event is scheduled right now.</span>
                        </div>
                        <button type="button" className="th-cta th-cta--ghost" onClick={props.onRetry}>Retry</button>
                      </div>
                    ) : (
                      <p className="th-empty">No Live Event is scheduled right now.</p>
                    )
                  ) : null}

                  {props.upcomingError && liveCards.length === 0 ? (
                    <div className="th-state-card th-state-card--error" role="alert">
                      <div className="th-state-card__text">
                        <strong>Couldn&apos;t load Live Events</strong>
                        <span>Check your connection and try again.</span>
                      </div>
                      <button type="button" className="th-cta th-cta--ghost" onClick={props.onRetry}>Retry</button>
                    </div>
                  ) : null}

                  {signedIn && props.myError ? (
                    <p className="th-event__error" role="alert">
                      Your entries couldn&apos;t be loaded.{' '}
                      <button type="button" className="th-link" onClick={props.onRetry}>Retry</button>
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
