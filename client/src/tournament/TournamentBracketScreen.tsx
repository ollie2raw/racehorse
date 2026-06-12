import { useEffect, useMemo, useRef, useState } from 'react';
import { GlobalNav } from '../components';
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
  /** Refreshes /me phase (match_ready) when lobby countdown hits zero. */
  onSyncTournamentState?: () => void;
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
  regs: Registration[],
  match: TournamentMatch,
): string {
  if (!userId) return 'TBD';
  const reg = regs.find((r) => r.user_id === userId);
  return registrationNameFor(userId, reg?.username, match);
}

function MatchCard({
  match,
  regs,
  youUserId,
  assignedMatchId,
  highlightOpponentId,
  bracketDisplay,
}: {
  match: TournamentMatch;
  regs: Registration[];
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
  const p1Name = slotName(match.player1_id, regs, match);
  const p2Name = slotName(match.player2_id, regs, match);
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
}

function TerminalBracketBanner({
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
}

const TOURNAMENT_FLOW_STEPS = [
  { id: 'register', label: 'Register' },
  { id: 'lock', label: 'Bracket locks' },
  { id: 'r1', label: 'Round 1' },
  { id: 'sf', label: 'Semifinal' },
  { id: 'final', label: 'Final' },
] as const;

function TournamentFlowRail({ currentStepId }: { currentStepId: (typeof TOURNAMENT_FLOW_STEPS)[number]['id'] }) {
  const currentIndex = TOURNAMENT_FLOW_STEPS.findIndex((s) => s.id === currentStepId);
  return (
    <nav className="tb-waiting__rail" aria-label="Tournament flow">
      {TOURNAMENT_FLOW_STEPS.map((step, index) => {
        const isCurrent = step.id === currentStepId;
        const isPast = index < currentIndex;
        return (
          <span key={step.id} className="tb-waiting__rail-item">
            {index > 0 ? <span className="tb-waiting__rail-sep" aria-hidden /> : null}
            <span
              className={[
                'tb-waiting__rail-step',
                isCurrent ? 'tb-waiting__rail-step--current' : '',
                isPast ? 'tb-waiting__rail-step--past' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {step.label}
            </span>
          </span>
        );
      })}
    </nav>
  );
}

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

function WaitingRoomPanel({
  bracket,
  youUserId,
  countdownAt,
  countdownKind,
  now,
  onWithdraw,
}: {
  bracket: BracketView;
  youUserId: string | null;
  countdownAt: string | null;
  countdownKind: TournamentCountdownKind | null;
  now: number;
  onWithdraw?: (tournamentId: string) => void;
}) {
  const maxPlayers = bracket.tournament.max_players;
  const fieldRows = buildWaitingFieldRows(bracket.registrations, maxPlayers);
  const entrants = fieldRows.filter((row): row is Extract<WaitingFieldRow, { kind: 'player' }> => row.kind === 'player');
  const openSeats = maxPlayers - entrants.length;
  const closeIso =
    countdownKind === 'registration_close' && countdownAt
      ? countdownAt
      : bracket.tournament.registration_close_at;
  const closeMs = Date.parse(closeIso);
  const countdownText = Number.isFinite(closeMs) ? padCountdown(closeMs - now) : '--:--';
  const startLabel = formatTimePst(bracket.tournament.scheduled_start);
  const fillPct = Math.max(0, Math.min(100, (entrants.length / maxPlayers) * 100));
  const fieldLocked = openSeats === 0;
  const fillSubtext = fieldLocked
    ? 'Field locked'
    : `${openSeats} seat${openSeats === 1 ? '' : 's'} still open · Fritz bots fill remaining seats at lock`;

  const qfPreview =
    bracket.matches
      .filter((m) => m.round === 1)
      .sort((a, b) => a.match_number - b.match_number) ?? [];
  const hasPairings = qfPreview.length > 0;
  const previewTitle = hasPairings ? 'Bracket preview' : 'Projected bracket';
  const previewSub = hasPairings
    ? 'Quarterfinal pairings for this event'
    : 'Pairings generate when registration closes';

  const renderQfSlot = (userId: string | null, match?: (typeof qfPreview)[number]) => {
    if (!userId) return 'TBD';
    if (userId === youUserId) return 'You';
    return registrationNameFor(userId, null, match ?? null);
  };

  return (
    <div className="tb-waiting">
      <div className="tb-waiting__top" aria-label="Event status">
        <div className="tb-waiting__hero" aria-live="polite">
          <span className="tb-waiting__hero-label">Registration closes in</span>
          <span className="tb-waiting__hero-time">{countdownText}</span>
          <span className="tb-waiting__hero-meta">
            Locks at close · Starts {startLabel} PT
          </span>
        </div>
        <div className="tb-waiting__fill">
          <div className="tb-waiting__fill-head">
            <span className="tb-waiting__fill-label">Field</span>
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
      </div>

      <TournamentFlowRail currentStepId="register" />

      <div className="tb-waiting__deck">
        <section className="tb-waiting__pane tb-waiting__pane--field" aria-label="Tournament field">
          <header className="tb-waiting__pane-head">
            <div>
              <h3 className="tb-waiting__pane-title">Registered field</h3>
              <p className="tb-waiting__pane-sub">Seats lock when registration closes</p>
            </div>
            {onWithdraw ? (
              <button
                type="button"
                className="tb-waiting__withdraw"
                onClick={() => onWithdraw(bracket.tournament.id)}
              >
                Withdraw
              </button>
            ) : null}
          </header>
          <ul className="tb-waiting__seats">
            {fieldRows.map((row) => {
              if (row.kind === 'open') {
                return (
                  <li key={`open-${row.seat}`} className="tb-waiting__seat tb-waiting__seat--open">
                    <span className="tb-waiting__seat-index">{row.seat}</span>
                    <span className="tb-waiting__seat-name">Open</span>
                  </li>
                );
              }
              const { reg, seat } = row;
              const isYou = reg.user_id === youUserId;
              const isBot = isTournamentBotId(reg.user_id);
              const displayName = isYou
                ? 'You'
                : registrationNameFor(reg.user_id, reg.username, null);
              return (
                <li
                  key={reg.id}
                  className={`tb-waiting__seat${isYou ? ' tb-waiting__seat--you' : ''}${isBot ? ' tb-waiting__seat--bot' : ''}`}
                >
                  <span className="tb-waiting__seat-index">{seat}</span>
                  <span className="tb-waiting__seat-name">{displayName}</span>
                  {isYou ? <span className="tb-waiting__seat-tag">You</span> : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="tb-waiting__pane tb-waiting__pane--bracket" aria-label={previewTitle}>
          <header className="tb-waiting__pane-head">
            <div>
              <h3 className="tb-waiting__pane-title">{previewTitle}</h3>
              <p className="tb-waiting__pane-sub">{previewSub}</p>
            </div>
          </header>
          <div className="tb-waiting__qf-grid">
            {hasPairings
              ? qfPreview.map((match) => (
                  <div key={match.id} className="tb-waiting__qf">
                    <span className="tb-waiting__qf-label">QF {match.match_number}</span>
                    <span className="tb-waiting__qf-slot">{renderQfSlot(match.player1_id, match)}</span>
                    <span className="tb-waiting__qf-slot">{renderQfSlot(match.player2_id, match)}</span>
                  </div>
                ))
              : Array.from({ length: 4 }, (_, i) => (
                  <div key={i} className="tb-waiting__qf">
                    <span className="tb-waiting__qf-label">QF {i + 1}</span>
                    <span className="tb-waiting__qf-slot">TBD</span>
                    <span className="tb-waiting__qf-slot">TBD</span>
                  </div>
                ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default function TournamentBracketScreen(props: TournamentBracketScreenProps) {
  const userId = props.identity?.userId ?? null;
  const { onLoadBracket, onSyncTournamentState } = props;
  const [now, setNow] = useState(Date.now());
  const isBracketLobby = props.tournamentPhase === 'bracket_lobby';
  const startCountdownSyncRef = useRef(false);

  useEffect(() => {
    onLoadBracket(props.tournamentId);
    const pollMs =
      props.tournamentPhase === 'bracket_lobby' &&
      props.countdownKind === 'scheduled_start' &&
      props.countdownAt
        ? 5_000
        : 20_000;
    const poll = window.setInterval(() => onLoadBracket(props.tournamentId), pollMs);
    return () => window.clearInterval(poll);
  }, [
    props.countdownAt,
    props.countdownKind,
    props.tournamentId,
    props.tournamentPhase,
    onLoadBracket,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

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
  const countdownMs = props.countdownAt ? Date.parse(props.countdownAt) - now : null;
  const countdownPastStart = countdownMs != null && countdownMs <= 0;
  const countdownText =
    countdownMs == null
      ? '--:--'
      : countdownPastStart && isBracketLobby
        ? 'Starting…'
        : padCountdown(countdownMs);

  useEffect(() => {
    if (!isBracketLobby || !onSyncTournamentState) return;
    if (countdownMs == null || countdownMs > 0) {
      startCountdownSyncRef.current = false;
      return;
    }
    if (startCountdownSyncRef.current) return;
    startCountdownSyncRef.current = true;
    // #region agent log
    fetch('http://127.0.0.1:7623/ingest/c349b922-447d-4c33-a504-5ce40eaa2c91',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'a715da'},body:JSON.stringify({sessionId:'a715da',location:'TournamentBracketScreen.tsx:startCountdownZero',message:'bracket lobby countdown reached zero, syncing state',data:{tournamentId:props.tournamentId,phase:props.tournamentPhase,countdownKind:props.countdownKind},timestamp:Date.now(),hypothesisId:'H-D',runId:'post-fix'})}).catch(()=>{});
    // #endregion
    onSyncTournamentState();
    const interval = window.setInterval(() => onSyncTournamentState(), 5_000);
    return () => window.clearInterval(interval);
  }, [
    countdownMs,
    isBracketLobby,
    onSyncTournamentState,
    props.countdownKind,
    props.tournamentId,
    props.tournamentPhase,
  ]);

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

  const qf = bracket?.matches.filter((m) => m.round === 1).sort((a, b) => a.match_number - b.match_number) ?? [];
  const sf = bracket?.matches.filter((m) => m.round === 2).sort((a, b) => a.match_number - b.match_number) ?? [];
  const fnl = bracket?.matches.filter((m) => m.round === 3) ?? [];
  const finalMatch = fnl[0] ?? null;
  const champion =
    finalMatch && isBracketMatchCompletedForDisplay(finalMatch, bracketDisplay)
      ? finalMatch.winner_id
      : null;
  const championName =
    champion && bracket
      ? resolveTournamentPlayerName(champion, {
          username: bracket.registrations.find((r) => r.user_id === champion)?.username,
          botTier: fnl[0]?.bot_tier,
          round: 3,
        })
      : null;

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
          {isBracketLobby && assigned ? (
            <div className="tb-countdown-card" aria-live="polite">
              <span className="tb-countdown-card__eyebrow">Bracket locked</span>
              <span className="tb-countdown-card__timer">{countdownText}</span>
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
              {isWaitingRoom ? 'Waiting room' : isBracketLobby ? 'Bracket locked' : 'Tournament'}
            </div>
            <h2 className="tb-title">
              {isWaitingRoom ? 'Tournament Lobby' : isBracketLobby ? 'Bracket Lobby' : 'Bracket'}
            </h2>
            {isWaitingRoom && bracket ? (
              <p className="tb-head-sub">
                {bracket.tournament.max_players} players · First to {bracket.tournament.win_target} per match
              </p>
            ) : null}
          </div>
        </div>

        {bracket && isWaitingRoom ? (
          <WaitingRoomPanel
            bracket={bracket}
            youUserId={userId}
            countdownAt={waitingCountdownAt}
            countdownKind={props.countdownKind ?? null}
            now={now}
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
                    regs={bracket.registrations}
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
                    regs={bracket.registrations}
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
                    regs={bracket.registrations}
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
