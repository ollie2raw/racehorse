import { memo, useEffect, useMemo, useState } from 'react';
import { GlobalNav } from '../components';
import { useSyncNow } from '../ui/useSyncNow';
import type { AppMode } from '../types';
import {
  registrationNameFor,
  resolveTournamentOpponentLabel,
  resolveTournamentPlayerName,
  tournamentStageShortLabel,
} from './displayNames';
import { isTerminalTournamentMatch } from './terminalMatches';
import {
  deriveBracketTerminalState,
  isTournamentBracketTerminal,
  type BracketTerminalState,
} from './bracketTerminal';
import {
  type BracketDisplayContext,
  isBracketMatchCompletedForDisplay,
} from './tournamentBracketDisplay';
import { isTournamentBotId } from './displayNames';
import type {
  BracketView,
  Registration,
  TournamentAssignedMatch,
  TournamentCountdownKind,
  TournamentMatch,
  TournamentUserPhase,
} from './types';
import './tournamentBracket.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentBracketScreenProps {
  identity: Identity;
  tournamentId: string;
  bracket: BracketView | null;
  tournamentPhase?: TournamentUserPhase | null;
  assignedMatch?: TournamentAssignedMatch | null;
  countdownAt?: string | null;
  countdownKind?: TournamentCountdownKind | null;
  onLoadBracket: (tournamentId: string) => void;
  onBack: () => void;
  onExitToHub: () => void;
  onWithdraw?: (tournamentId: string) => void;
  onViewResult?: () => void;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onOpenAccount?: () => void;
  onAttachAssignedMatch: (matchId: string) => void;
  attachJoinPhase?: 'idle' | 'pending' | 'failed';
  attachJoinError?: string | null;
}

function padCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function buildCountdownLabel(targetMs: number | null): string {
  if (targetMs == null || !Number.isFinite(targetMs)) return '--:--';
  return padCountdown(targetMs - Date.now());
}

function formatTimePst(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function activeEntrants(regs: Registration[]): Registration[] {
  return regs.filter((reg) => reg.status === 'registered' || reg.status === 'active');
}

function roundLabel(round: 1 | 2 | 3): string {
  return tournamentStageShortLabel(round);
}

function slotName(
  userId: string | null,
  registrationUsernameByUserId: ReadonlyMap<string, string | null | undefined>,
  match: TournamentMatch,
): string {
  if (!userId) return 'TBD';
  return registrationNameFor(userId, registrationUsernameByUserId.get(userId) ?? null, match);
}

const CountdownText = memo(function CountdownText({
  targetMs,
  fallback = '--:--',
}: {
  targetMs: number | null;
  fallback?: string;
}) {
  const validTarget = targetMs != null && Number.isFinite(targetMs);
  const now = useSyncNow(1000, validTarget);
  void now;
  const label = validTarget ? buildCountdownLabel(targetMs) : fallback;

  return <>{label}</>;
});

const MatchCard = memo(function MatchCard({
  match,
  registrationUsernameByUserId,
  youUserId,
  assignedMatchId,
  highlightOpponentId,
  bracketDisplay,
}: {
  match: TournamentMatch;
  registrationUsernameByUserId: ReadonlyMap<string, string | null | undefined>;
  youUserId: string | null;
  assignedMatchId?: string | null;
  highlightOpponentId?: string | null;
  bracketDisplay: BracketDisplayContext;
}) {
  const isYours = Boolean(youUserId) && (match.player1_id === youUserId || match.player2_id === youUserId);
  const isOpponentPath =
    Boolean(highlightOpponentId) &&
    (match.player1_id === highlightOpponentId || match.player2_id === highlightOpponentId);
  const isLive = match.status === 'ready' || match.status === 'in_progress';
  const isCompleted = isBracketMatchCompletedForDisplay(match, bracketDisplay);
  const isCurrent = assignedMatchId === match.id || (isYours && isLive);
  const isBye = match.status === 'bye';
  const p1Name = slotName(
    match.player1_id,
    registrationUsernameByUserId,
    match,
  );
  const p2Name = slotName(
    match.player2_id,
    registrationUsernameByUserId,
    match,
  );
  const showScores = isCompleted && !isBye;

  return (
    <div
      className={[
        'tb-match',
        isYours ? 'is-yours' : '',
        isOpponentPath ? 'is-opponent-path' : '',
        isCurrent ? 'is-current' : '',
        isCompleted ? 'is-completed' : '',
        isBye ? 'is-bye' : '',
        !match.player1_id || !match.player2_id ? 'is-pending' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="tb-match__round">{roundLabel(match.round)}</div>
      <div className="tb-slot">
        <span
          className={[
            'tb-slot__name',
            match.player1_id === youUserId ? 'tb-slot__name--you' : '',
            !match.player1_id ? 'tb-slot__name--tbd' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {match.player1_id ? (match.player1_id === youUserId ? 'You' : p1Name) : 'TBD'}
        </span>
        <span
          className={[
            'tb-slot__score',
            match.winner_id === match.player1_id && match.winner_id ? 'tb-slot__score--win' : '',
            !showScores ? 'tb-slot__score--pending' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {showScores ? (match.player1_score ?? '—') : '—'}
        </span>
      </div>
      <div className="tb-slot">
        <span
          className={[
            'tb-slot__name',
            match.player2_id === youUserId ? 'tb-slot__name--you' : '',
            !match.player2_id ? 'tb-slot__name--tbd' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {match.player2_id ? (match.player2_id === youUserId ? 'You' : p2Name) : 'TBD'}
        </span>
        <span
          className={[
            'tb-slot__score',
            match.winner_id === match.player2_id && match.winner_id ? 'tb-slot__score--win' : '',
            !showScores ? 'tb-slot__score--pending' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {showScores ? (match.player2_score ?? '—') : '—'}
        </span>
      </div>
    </div>
  );
});

const TerminalBracketBanner = memo(function TerminalBracketBanner({
  terminal,
  onExitToHub,
  onViewResult,
}: {
  terminal: BracketTerminalState;
  onExitToHub: () => void;
  onViewResult?: () => void;
}) {
  const showViewResult =
    Boolean(onViewResult) &&
    (terminal.kind === 'final_complete' || terminal.kind === 'tournament_completed');
  return (
    <div className="tb-terminal-banner">
      <div className="tb-terminal-banner__meta">
        <span className="tb-terminal-banner__kicker">Bracket closed</span>
        <span className="tb-terminal-banner__heading">{terminal.title}</span>
        <span className="tb-terminal-banner__sub">{terminal.detail}</span>
        {terminal.championName ? (
          <span className="tb-terminal-banner__champion">
            Champion: <strong>{terminal.championName}</strong>
            {terminal.runnerUpName ? ` · Runner-up: ${terminal.runnerUpName}` : ''}
          </span>
        ) : null}
        {terminal.yourPlacementLabel ? (
          <span className="tb-terminal-banner__placement">You: {terminal.yourPlacementLabel}</span>
        ) : null}
      </div>
      <div className="tb-terminal-banner__actions">
        <button className="tb-terminal-banner__cta" type="button" onClick={onExitToHub}>
          Back to Tournament Home
        </button>
        {showViewResult ? (
          <button className="tb-terminal-banner__secondary" type="button" onClick={onViewResult}>
            View Result
          </button>
        ) : null}
      </div>
    </div>
  );
});

const TOURNAMENT_FLOW_STEPS = [
  { id: 'register', label: 'Register' },
  { id: 'lock', label: 'Bracket locks' },
  { id: 'r1', label: 'Round 1' },
  { id: 'sf', label: 'Semifinal' },
  { id: 'final', label: 'Final' },
] as const;

const TournamentFlowStepper = memo(function TournamentFlowStepper({
  currentStepId,
}: {
  currentStepId: (typeof TOURNAMENT_FLOW_STEPS)[number]['id'];
}) {
  const currentIndex = TOURNAMENT_FLOW_STEPS.findIndex((s) => s.id === currentStepId);
  return (
    <nav className="tb-waiting__flow" aria-label="Tournament progression">
      <span className="tb-waiting__flow-title">What happens next</span>
      <ol className="tb-waiting__flow-steps">
        {TOURNAMENT_FLOW_STEPS.map((step, index) => {
          const isCurrent = step.id === currentStepId;
          const isPast = index < currentIndex;
          return (
            <li
              key={step.id}
              className={[
                'tb-waiting__flow-step',
                isCurrent ? 'tb-waiting__flow-step--current' : '',
                isPast ? 'tb-waiting__flow-step--past' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="tb-waiting__flow-step-index">{index + 1}</span>
              <span className="tb-waiting__flow-step-label">{step.label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
});

const BracketPreviewPanel = memo(function BracketPreviewPanel({
  qfMatches,
  youUserId,
  hasPairings,
}: {
  qfMatches: TournamentMatch[];
  youUserId: string | null;
  hasPairings: boolean;
}) {
  const renderSlot = (userId: string | null, match?: TournamentMatch) => {
    if (!userId) return { label: 'Open · Bot fill', pending: true, isYou: false };
    if (userId === youUserId) return { label: 'You', pending: false, isYou: true };
    return {
      label: registrationNameFor(userId, null, match ?? null),
      pending: false,
      isYou: false,
    };
  };

  const cards = hasPairings
    ? qfMatches.map((match) => ({
        key: match.id,
        roundLabel: `QF ${match.match_number}`,
        slot1: renderSlot(match.player1_id, match),
        slot2: renderSlot(match.player2_id, match),
      }))
    : Array.from({ length: 4 }, (_, index) => ({
        key: `qf-placeholder-${index}`,
        roundLabel: `QF ${index + 1}`,
        slot1: { label: 'Open · Bot fill', pending: true, isYou: false },
        slot2: { label: 'Open · Bot fill', pending: true, isYou: false },
      }));

  return (
    <div className="tb-waiting__preview-stack">
      <div className="tb-waiting__preview-grid">
        {cards.map((card) => {
          const isYours = card.slot1.isYou || card.slot2.isYou;
          return (
            <div
              key={card.key}
              className={`tb-waiting__qf-card${isYours ? ' tb-waiting__qf-card--yours' : ''}`}
            >
              <span className="tb-waiting__qf-card-label">{card.roundLabel}</span>
              <span
                className={[
                  'tb-waiting__qf-card-slot',
                  card.slot1.pending ? 'tb-waiting__qf-card-slot--pending' : '',
                  card.slot1.isYou ? 'tb-waiting__qf-card-slot--you' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {card.slot1.label}
              </span>
              <span className="tb-waiting__qf-card-vs" aria-hidden>
                vs
              </span>
              <span
                className={[
                  'tb-waiting__qf-card-slot',
                  card.slot2.pending ? 'tb-waiting__qf-card-slot--pending' : '',
                  card.slot2.isYou ? 'tb-waiting__qf-card-slot--you' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {card.slot2.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="tb-waiting__preview-path">
        Round 1 → Semifinal → Final · Winner advances
      </p>
    </div>
  );
});

type WaitingFieldRow =
  | { kind: 'player'; seat: number; reg: Registration }
  | { kind: 'open'; seat: number };

function buildWaitingFieldRows(
  registrations: Registration[],
  maxPlayers: number,
): WaitingFieldRow[] {
  const entrants = activeEntrants(registrations).sort((a, b) => {
    const seedA = a.seed ?? Number.POSITIVE_INFINITY;
    const seedB = b.seed ?? Number.POSITIVE_INFINITY;
    if (seedA !== seedB) return seedA - seedB;
    return Date.parse(a.registered_at) - Date.parse(b.registered_at);
  });
  const rows: WaitingFieldRow[] = entrants.map((reg, index) => ({
    kind: 'player',
    seat: reg.seed ?? index + 1,
    reg,
  }));
  for (let seat = rows.length + 1; seat <= maxPlayers; seat += 1) {
    rows.push({ kind: 'open', seat });
  }
  return rows;
}

const WaitingRoomPanel = memo(function WaitingRoomPanel({
  bracket,
  youUserId,
  countdownAt,
  countdownKind,
  registrationUsernameByUserId,
  onWithdraw,
}: {
  bracket: BracketView;
  youUserId: string | null;
  countdownAt: string | null;
  countdownKind: TournamentCountdownKind | null;
  registrationUsernameByUserId: ReadonlyMap<string, string | null | undefined>;
  onWithdraw?: (tournamentId: string) => void;
}) {
  const maxPlayers = bracket.tournament.max_players;
  const fieldRows = useMemo(
    () => buildWaitingFieldRows(bracket.registrations, maxPlayers),
    [bracket.registrations, maxPlayers],
  );
  const entrants = useMemo(
    () =>
      fieldRows.filter(
        (row): row is Extract<WaitingFieldRow, { kind: 'player' }> => row.kind === 'player',
      ),
    [fieldRows],
  );
  const openSeats = maxPlayers - entrants.length;
  const closeIso = useMemo(
    () =>
      countdownKind === 'registration_close' && countdownAt
        ? countdownAt
        : bracket.tournament.registration_close_at,
    [bracket.tournament.registration_close_at, countdownAt, countdownKind],
  );
  const closeMs = useMemo(() => Date.parse(closeIso), [closeIso]);
  const startLabel = formatTimePst(bracket.tournament.scheduled_start);
  const fillPct = Math.max(0, Math.min(100, (entrants.length / maxPlayers) * 100));
  const fieldLocked = openSeats === 0;
  const fillSubtext = fieldLocked
    ? 'Field locked — bracket incoming'
    : `${openSeats} seat${openSeats === 1 ? '' : 's'} remaining · Fritz bots fill unclaimed seats at lock`;

  const qfPreview = useMemo(
    () =>
      bracket.matches
        .filter((m) => m.round === 1)
        .sort((a, b) => a.match_number - b.match_number),
    [bracket.matches],
  );
  const hasPairings = qfPreview.length > 0;
  const previewSub = hasPairings
    ? 'Quarterfinal pairings for this event'
    : 'Matchups finalize when registration closes';
  const isEarlyField = entrants.length <= 2;

  return (
    <div className="tb-waiting">
      <header className="tb-waiting__hero-panel" aria-label="Tournament waiting room status">
        <div className="tb-waiting__hero-panel-main">
          <p className="tb-waiting__hero-eyebrow">Tournament lobby · Waiting room</p>
          <div className="tb-waiting__hero-headline-row">
            <h2 className="tb-waiting__hero-title">You&apos;re in</h2>
            <span className="tb-waiting__status-chip">Seat confirmed</span>
          </div>
          <p className="tb-waiting__hero-lead">
            Bracket locks at registration close. Round 1 begins at lock.
          </p>
          <ul className="tb-waiting__format-pills" aria-label="Tournament format">
            <li>{maxPlayers} players</li>
            <li>First to {bracket.tournament.win_target}</li>
            <li>Single elimination</li>
          </ul>
        </div>

        <div className="tb-waiting__hero-panel-clock" aria-live="polite">
          <span className="tb-waiting__countdown-eyebrow">Bracket locks in</span>
          <span className="tb-waiting__countdown-time">
            <CountdownText targetMs={Number.isFinite(closeMs) ? closeMs : null} />
          </span>
          <span className="tb-waiting__countdown-meta">Starts {startLabel} PT</span>
        </div>

        <div className="tb-waiting__hero-panel-fill">
          <div className="tb-waiting__fill-head">
            <span className="tb-waiting__fill-label">Seats filling</span>
            <span className="tb-waiting__fill-count">
              {entrants.length} / {maxPlayers}
            </span>
          </div>
          <div
            className="tb-waiting__fill-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={maxPlayers}
            aria-valuenow={entrants.length}
            aria-label={`${entrants.length} of ${maxPlayers} players registered`}
          >
            <span className="tb-waiting__fill-bar-inner" style={{ width: `${fillPct}%` }} />
          </div>
          <span className="tb-waiting__fill-sub">{fillSubtext}</span>
        </div>
      </header>

      <TournamentFlowStepper currentStepId="register" />

      <div className="tb-waiting__body">
        <section className="tb-waiting__roster" aria-label="Projected field">
          <header className="tb-waiting__section-head">
            <div>
              <h3 className="tb-waiting__section-label">Projected field</h3>
              <p className="tb-waiting__section-sub">
                {entrants.length} registered · {openSeats} seat{openSeats === 1 ? '' : 's'} remaining
                {isEarlyField
                  ? ' · Early entry — seats fill until close; bots fill unclaimed seats at lock'
                  : ''}
              </p>
            </div>
          </header>
          <ul className="tb-waiting__roster-list">
            {fieldRows.map((row) => {
              if (row.kind === 'open') {
                return (
                  <li key={`open-${row.seat}`} className="tb-waiting__seat tb-waiting__seat--open">
                    <span className="tb-waiting__seat-index">{row.seat}</span>
                    <span className="tb-waiting__seat-name">Open seat</span>
                    <span className="tb-waiting__seat-badge tb-waiting__seat-badge--open">Bot fill at lock</span>
                  </li>
                );
              }
              const { reg, seat } = row;
              const isYou = reg.user_id === youUserId;
              const isBot = isTournamentBotId(reg.user_id);
              const displayName = isYou
                ? 'You'
                : registrationNameFor(
                    reg.user_id,
                    registrationUsernameByUserId.get(reg.user_id) ?? reg.username,
                    null,
                  );
              return (
                <li
                  key={reg.id}
                  className={`tb-waiting__seat${isYou ? ' tb-waiting__seat--you' : ''}${isBot ? ' tb-waiting__seat--bot' : ''}`}
                >
                  <span className="tb-waiting__seat-index">{seat}</span>
                  <span className="tb-waiting__seat-name">{displayName}</span>
                  {isYou ? (
                    <span className="tb-waiting__seat-badge tb-waiting__seat-badge--you">Your seat</span>
                  ) : isBot ? (
                    <span className="tb-waiting__seat-badge tb-waiting__seat-badge--bot">Bot</span>
                  ) : (
                    <span className="tb-waiting__seat-badge tb-waiting__seat-badge--in">In</span>
                  )}
                </li>
              );
            })}
          </ul>
          {onWithdraw ? (
            <footer className="tb-waiting__roster-foot">
              <button
                type="button"
                className="tb-waiting__withdraw"
                onClick={() => onWithdraw(bracket.tournament.id)}
              >
                Withdraw
              </button>
            </footer>
          ) : null}
        </section>

        <section className="tb-waiting__preview" aria-label="Bracket preview">
          <header className="tb-waiting__section-head">
            <div>
              <h3 className="tb-waiting__section-label">Bracket preview</h3>
              <p className="tb-waiting__section-sub">{previewSub}</p>
            </div>
          </header>
          <BracketPreviewPanel
            qfMatches={qfPreview}
            youUserId={youUserId}
            hasPairings={hasPairings}
          />
        </section>
      </div>
    </div>
  );
});

export default function TournamentBracketScreen(props: TournamentBracketScreenProps) {
  const userId = props.identity?.userId ?? null;
  const { onLoadBracket } = props;
  const isBracketLobby = props.tournamentPhase === 'bracket_lobby';

  useEffect(() => {
    onLoadBracket(props.tournamentId);
    const poll = window.setInterval(() => onLoadBracket(props.tournamentId), 20_000);
    return () => window.clearInterval(poll);
  }, [props.tournamentId, onLoadBracket]);

  const bracket: BracketView | null =
    props.bracket?.tournament.id === props.tournamentId ? props.bracket : null;

  const bracketDisplay = useMemo<BracketDisplayContext>(
    () => ({
      isBracketLobby,
      youUserId: userId,
      matches: bracket?.matches ?? [],
    }),
    [isBracketLobby, userId, bracket?.matches],
  );

  const isWaitingRoom = useMemo(() => {
    if (props.tournamentPhase === 'registered') return true;
    if (!bracket) return false;
    return (
      bracket.tournament.status === 'registration_open' && bracket.matches.length === 0
    );
  }, [props.tournamentPhase, bracket]);

  const registrationUsernameByUserId = useMemo(
    () =>
      new Map(
        (bracket?.registrations ?? []).map((registration) => [
          registration.user_id,
          registration.username,
        ]),
      ),
    [bracket?.registrations],
  );

  const waitingCountdownAt = useMemo(() => {
    if (props.countdownKind === 'registration_close' && props.countdownAt) {
      return props.countdownAt;
    }
    return bracket?.tournament.registration_close_at ?? props.countdownAt ?? null;
  }, [props.countdownAt, props.countdownKind, bracket?.tournament.registration_close_at]);

  const assigned = props.assignedMatch;
  const opponentUserId = assigned?.opponentId ?? null;
  const opponentDisplayName = assigned
    ? resolveTournamentOpponentLabel({
        opponentUserId: assigned.opponentId,
        opponentUsername: assigned.opponentUsername,
        round: assigned.round,
      })
    : 'Opponent';
  const bracketLobbyCountdownMs = useMemo(
    () => (props.countdownAt ? Date.parse(props.countdownAt) : null),
    [props.countdownAt],
  );

  const yourReadyMatch = useMemo(() => {
    if (!bracket || !userId || isBracketLobby) return null;
    return (
      bracket.matches.find(
        (m) =>
          (m.status === 'ready' || m.status === 'in_progress') &&
          (m.player1_id === userId || m.player2_id === userId) &&
          !m.winner_id &&
          !m.completed_at &&
          !isTerminalTournamentMatch(m.id),
      ) ?? null
    );
  }, [bracket, userId, isBracketLobby]);

  const qf = useMemo(
    () =>
      bracket?.matches
        .filter((m) => m.round === 1)
        .sort((a, b) => a.match_number - b.match_number) ?? [],
    [bracket?.matches],
  );
  const sf = useMemo(
    () =>
      bracket?.matches
        .filter((m) => m.round === 2)
        .sort((a, b) => a.match_number - b.match_number) ?? [],
    [bracket?.matches],
  );
  const fnl = useMemo(
    () => bracket?.matches.filter((m) => m.round === 3) ?? [],
    [bracket?.matches],
  );
  const finalMatch = fnl[0] ?? null;
  const champion =
    finalMatch && isBracketMatchCompletedForDisplay(finalMatch, bracketDisplay)
      ? finalMatch.winner_id
      : null;
  const championName = useMemo(
    () =>
      champion && bracket
        ? resolveTournamentPlayerName(champion, {
            username: registrationUsernameByUserId.get(champion) ?? null,
            botTier: fnl[0]?.bot_tier,
            round: 3,
          })
        : null,
    [bracket, champion, fnl, registrationUsernameByUserId],
  );

  const terminal = useMemo(
    () =>
      deriveBracketTerminalState({
        bracket,
        userId,
        tournamentPhase: props.tournamentPhase ?? null,
        assignedMatch: assigned ?? null,
      }),
    [bracket, userId, props.tournamentPhase, assigned],
  );

  const canAttach =
    !terminal.suppressJoin &&
    (props.tournamentPhase === 'match_ready' ||
      props.tournamentPhase === 'in_match' ||
      Boolean(assigned?.roomCode));
  const attachMatchId = yourReadyMatch?.id ?? (canAttach ? assigned?.matchId ?? null : null);
  const showAttachBanner = Boolean(attachMatchId) && canAttach && !terminal.suppressJoin;
  const isTerminalBracket = isTournamentBracketTerminal(terminal);

  return (
    <div className="tb-page">
      <GlobalNav
        currentMode={'tournament' as AppMode}
        onNavigate={props.onNavigate}
        onOpenAuth={props.onOpenAuth}
        onOpenAccount={props.onOpenAccount}
        activeColor="var(--accent-amber)"
        compactChrome={isWaitingRoom}
      />
      <div className={`tb-shell${isWaitingRoom ? ' tb-shell--waiting' : ''}`}>
        <div className={`tb-toolbar${isWaitingRoom ? ' tb-toolbar--waiting' : ''}`}>
          <button
            className="tb-back"
            type="button"
            onClick={isTerminalBracket ? props.onExitToHub : props.onBack}
          >
            <span aria-hidden>←</span>{' '}
            {isTerminalBracket ? 'Back to Tournament Home' : 'Back to Tournament'}
          </button>
          {!isWaitingRoom ? (
            <>
              {isBracketLobby && assigned ? (
                <div className="tb-countdown-card" aria-live="polite">
                  <span className="tb-countdown-card__eyebrow">Bracket locked</span>
                  <span className="tb-countdown-card__timer">
                    <CountdownText
                      targetMs={
                        bracketLobbyCountdownMs != null && Number.isFinite(bracketLobbyCountdownMs)
                          ? bracketLobbyCountdownMs
                          : null
                      }
                    />
                  </span>
                  <span className="tb-countdown-card__copy">
                    Your {roundLabel(assigned.round).toLowerCase()} starts soon
                  </span>
                  <span className="tb-countdown-card__matchup">
                    You vs <strong>{opponentDisplayName}</strong>
                  </span>
                </div>
              ) : (
                <div className="tb-toolbar-spacer" aria-hidden />
              )}
              <div className="tb-head">
                <div className="tb-kicker">
                  {isBracketLobby ? 'Bracket locked' : 'Tournament'}
                </div>
                <h2 className="tb-title">
                  {isBracketLobby ? 'Bracket Lobby' : 'Bracket'}
                </h2>
              </div>
            </>
          ) : null}
        </div>

        {bracket && isWaitingRoom ? (
          <WaitingRoomPanel
            bracket={bracket}
            youUserId={userId}
            countdownAt={waitingCountdownAt}
            countdownKind={props.countdownKind ?? null}
            registrationUsernameByUserId={registrationUsernameByUserId}
            onWithdraw={props.onWithdraw}
          />
        ) : null}

        {bracket && !isWaitingRoom ? (
          <div className="tb-bracket">
            <section className="tb-col">
              <header className="tb-col-head">
                <span className="tb-col-label">Quarterfinals</span>
                <span className="tb-col-sub">Round 1</span>
              </header>
              <div className="tb-col-matches">
                {qf.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    registrationUsernameByUserId={registrationUsernameByUserId}
                    youUserId={userId}
                    assignedMatchId={attachMatchId}
                    highlightOpponentId={opponentUserId}
                    bracketDisplay={bracketDisplay}
                  />
                ))}
              </div>
            </section>
            <section className="tb-col">
              <header className="tb-col-head">
                <span className="tb-col-label">Semifinals</span>
                <span className="tb-col-sub">Round 2</span>
              </header>
              <div className="tb-col-matches">
                {sf.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    registrationUsernameByUserId={registrationUsernameByUserId}
                    youUserId={userId}
                    assignedMatchId={attachMatchId}
                    highlightOpponentId={opponentUserId}
                    bracketDisplay={bracketDisplay}
                  />
                ))}
              </div>
            </section>
            <section className="tb-col">
              <header className="tb-col-head">
                <span className="tb-col-label">Final</span>
                <span className="tb-col-sub">Round 3</span>
              </header>
              <div className="tb-col-matches">
                {fnl.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    registrationUsernameByUserId={registrationUsernameByUserId}
                    youUserId={userId}
                    assignedMatchId={attachMatchId}
                    highlightOpponentId={opponentUserId}
                    bracketDisplay={bracketDisplay}
                  />
                ))}
              </div>
            </section>
            <section className="tb-col tb-col--champion">
              <header className="tb-col-head">
                <span className="tb-col-label">Champion</span>
                <span className="tb-col-sub">Winner</span>
              </header>
              <div className="tb-champion-card">
                <span className="tb-champion-label">Tournament Champion</span>
                <span className="tb-champion-name">{championName ?? 'TBD'}</span>
              </div>
            </section>
          </div>
        ) : !isWaitingRoom ? (
          <p className="tb-empty">Loading bracket…</p>
        ) : null}

        {isTerminalBracket ? (
          <TerminalBracketBanner
            terminal={terminal}
            onExitToHub={props.onExitToHub}
            onViewResult={props.onViewResult}
          />
        ) : null}

        {showAttachBanner && attachMatchId ? (
          <div className="tb-your-banner">
            <div className="tb-your-banner__meta">
              <span className="tb-your-banner__kicker">
                {props.attachJoinPhase === 'pending' ? 'Match starting…' : 'Your match is ready'}
              </span>
              <span className="tb-your-banner__heading">
                {assigned ? roundLabel(assigned.round) : 'Assigned match'}
              </span>
              <span className="tb-your-banner__sub">
                vs {opponentDisplayName} · First to {bracket?.tournament.win_target ?? 30}
              </span>
            </div>
            <button
              className="tb-your-cta"
              type="button"
              disabled={props.attachJoinPhase === 'pending'}
              onClick={() => props.onAttachAssignedMatch(attachMatchId)}
            >
              {props.attachJoinPhase === 'pending'
                ? 'Joining match…'
                : props.attachJoinPhase === 'failed'
                  ? 'Retry Join Match'
                  : 'Join Match ›'}
            </button>
            {props.attachJoinPhase === 'failed' && props.attachJoinError ? (
              <span className="tb-your-banner__error">{props.attachJoinError}</span>
            ) : null}
          </div>
        ) : null}

        {props.tournamentPhase === 'eliminated' ? (
          <div className="tb-your-banner tb-your-banner--muted">
            <div className="tb-your-banner__meta">
              <span className="tb-your-banner__kicker">Eliminated</span>
              <span className="tb-your-banner__heading">You have been eliminated from this bracket.</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
