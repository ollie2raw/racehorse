import { useEffect, useMemo, useState } from 'react';
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
import type { BracketView, Registration, TournamentAssignedMatch, TournamentMatch, TournamentUserPhase } from './types';
import './tournamentBracket.css';

type Identity = { userId: string; username: string } | null;

export interface TournamentBracketScreenProps {
  identity: Identity;
  tournamentId: string;
  bracket: BracketView | null;
  tournamentPhase?: TournamentUserPhase | null;
  assignedMatch?: TournamentAssignedMatch | null;
  countdownAt?: string | null;
  onLoadBracket: (tournamentId: string) => void;
  onBack: () => void;
  onExitToHub: () => void;
  onViewResult?: () => void;
  onNavigate?: (mode: AppMode) => void;
  onAttachAssignedMatch: (matchId: string) => void;
  attachJoinPhase?: 'idle' | 'pending' | 'failed';
  attachJoinError?: string | null;
}

function padCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
}: {
  match: TournamentMatch;
  regs: Registration[];
  youUserId: string | null;
  assignedMatchId?: string | null;
  highlightOpponentId?: string | null;
}) {
  const isYours = Boolean(youUserId) && (match.player1_id === youUserId || match.player2_id === youUserId);
  const isOpponentPath =
    Boolean(highlightOpponentId) &&
    (match.player1_id === highlightOpponentId || match.player2_id === highlightOpponentId);
  const isLive = match.status === 'ready' || match.status === 'in_progress';
  const isCompleted = match.status === 'completed' || Boolean(match.winner_id);
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

export default function TournamentBracketScreen(props: TournamentBracketScreenProps) {
  const userId = props.identity?.userId ?? null;
  const { onLoadBracket } = props;
  const [now, setNow] = useState(Date.now());
  const isBracketLobby = props.tournamentPhase === 'bracket_lobby';

  useEffect(() => {
    onLoadBracket(props.tournamentId);
  }, [props.tournamentId, onLoadBracket]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const bracket: BracketView | null =
    props.bracket?.tournament.id === props.tournamentId ? props.bracket : null;

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
  const countdownText = countdownMs != null ? padCountdown(countdownMs) : '--:--';

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
  const champion = fnl[0]?.winner_id ?? null;
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
        activeColor="var(--accent-amber)"
      />
      <div className="tb-shell">
        <div className="tb-toolbar">
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
            <div className="tb-kicker">{isBracketLobby ? 'Bracket locked' : 'Tournament'}</div>
            <h2 className="tb-title">{isBracketLobby ? 'Bracket Lobby' : 'Bracket'}</h2>
          </div>
        </div>

        {bracket ? (
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
        ) : (
          <p className="tb-empty">Loading bracket…</p>
        )}

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
