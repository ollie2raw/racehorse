/**
 * E2E-only harness (Phase 3D phone verification). Vite serves it from
 * e2e/harness; it is not part of the app build. It mounts the real tournament
 * play screens with fixture data and seeds the turn-clock store directly, so
 * the match HUD, bracket, result and post-match screens can be measured at
 * phone sizes without a server. Views: ?view=hud|bracket|result|overlay|banner.
 */
import '../../src/styles/tokens.css';
import '../../src/styles/rh-mobile-chrome.css';
import '../../src/styles/buttons.css';
import '../../src/styles/toast.css';
import '../../src/styles/lobby.css';
import '../../src/styles/screen-loader.css';
import '../../src/index.css';
import '../../src/premium-theme.css';
import '../../src/styles/walnut-live.css';
import '../../src/styles/rh-glow-underline.css';
import '../../src/styles/rh-soon-pill.css';
import '../../src/styles/game-interactions.css';
import '../../src/styles/match-hud-polish.css';
import '../../src/styles/match-board-architecture.css';
import '../../src/styles/match-gameplay.css';
import '../../src/styles/match-in-game.css';
import '../../src/styles/home-hub.css';
import '../../src/styles/match-standard-live-board.css';
import '../../src/match/gameLayoutLayers.css';
import '../../src/styles/racehorse-background.css';
import '../../src/styles/rh-image-surface.css';
import '../../src/styles/board/index.css';
import '../../src/styles/native-landscape.css';
import '../../src/App.css';
import '../../src/match/match-live.css';
import '../../src/styles/room-lobby.css';
import '../../src/styles/rotate-overlay.css';
import '../../src/styles/match-hud-corner-pills.css';
import '../../src/styles/large-mode.css';
import '../../src/styles/table-theme-toggle.css';
import '../../src/styles/weekly-awards.css';
import '../../src/styles/responsive.css';
import { createRef, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyMove, createInitialState, getLegalMoves, startNewHand } from '@racehorse/game-core';
import type { GameState } from '../../src/types';
import { AuthProvider } from '../../src/auth/useAuth';
import { LiveMatchScreen } from '../../src/match/LiveMatchScreen';
import type { LiveMatchScreenProps } from '../../src/match/liveMatchScreenTypes';
import TournamentBracketScreen from '../../src/tournament/TournamentBracketScreen';
import TournamentResultScreen from '../../src/tournament/TournamentResultScreen';
import TournamentGameOverOverlay from '../../src/tournament/TournamentGameOverOverlay';
import TournamentReadyBanner from '../../src/tournament/TournamentReadyBanner';
import { TournamentPostgameContext } from '../../src/tournament/TournamentPostgameContext';
import { tournamentPlayerDisplay } from '../../src/tournament/displayNames';
import { recordTournamentClock } from '../../src/tournament/tournamentMatchClock';
import { observeTournamentRequest, monotonicNow } from '../../src/tournament/tournamentClock';
import { deriveResultView } from '../../src/tournament/tournamentResultView';
import type { BracketView, MyTournament, Registration, TournamentMatch } from '../../src/tournament/types';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'hud';
const ME = 'me-seat';
const T = 'trn-h';
const bot = (n: number) => `bot:fritz:${T}:${n}`;
const LONG = 'Alexandria-Konstantinopoulou-Featherstonehaugh';
const NOW = Date.now();
observeTournamentRequest(monotonicNow(), monotonicNow(), new Date(NOW).toISOString());

function dealtState(oppId: string, myTurn: boolean): GameState {
  let s = startNewHand(createInitialState([ME, oppId], { winningScore: 30 } as never), undefined, myTurn ? oppId : ME);
  // One opening tile so the board is not empty; it is then the other seat's turn.
  const first = s.playerIds[s.currentPlayerIndex];
  const moves = getLegalMoves(s, first);
  if (moves[0]) s = applyMove(s, first, moves[0]).state;
  // Whose turn the view asks for (the opening seat is the engine's choice).
  // The client's GameState is the mutable mirror of game-core's.
  return { ...s, currentPlayerIndex: s.playerIds.indexOf(myTurn ? ME : oppId) } as unknown as GameState;
}

function Hud() {
  const fritz = q.get('opp') !== 'human';
  const oppId = fritz ? bot(5) : 'rival-seat';
  const myTurn = q.get('turn') !== 'opp';
  const state = dealtState(oppId, myTurn);
  const youAreCurrent = state.playerIds[state.currentPlayerIndex] === ME;
  const clock = q.get('clock') ?? 'turn';
  const missed = Number(q.get('missed') ?? 0);
  if (clock === 'turn' && !(fritz && !youAreCurrent)) {
    recordTournamentClock('ROOM-H', {
      kind: 'turn', seatId: youAreCurrent ? ME : oppId, deadlineAt: new Date(NOW + 32_000).toISOString(), missedTurns: missed, maxMissedTurns: 3,
    }, new Date(NOW).toISOString());
  } else if (clock === 'next_hand') {
    recordTournamentClock('ROOM-H', { kind: 'next_hand', seatId: null, waitingSeatIds: [ME], deadlineAt: new Date(NOW + 18_000).toISOString() }, new Date(NOW).toISOString());
  }
  const oppLabel = fritz ? 'Elite Fritz' : LONG;
  const noop = () => undefined;
  const props: LiveMatchScreenProps = {
    shell: { visible: true, state, flyingTiles: [], scoreToast: null },
    identity: { you: ME, opponentId: oppId, opponentName: oppLabel, myName: 'You', players: [{ id: ME, username: 'me', userId: 'u-me' }, { id: oppId, username: oppLabel, userId: null }] },
    hud: {
      myScore: 15, opponentScore: 20, opponentTileCount: state.players[oppId].hand.length, isMyTurn: youAreCurrent, isHandActive: clock !== 'next_hand',
      hudScorePulse: {}, hudRightLabel: 'You', hudRightScore: 15, hudRightScorePulse: false, boneyardCount: state.boneyard.length, openEndsSum: 10, winTarget: 30,
    },
    board: {
      opponentPillRef: createRef(), boneyardRef: createRef(), boardRef: createRef(), handAreaRef: createRef(), trayCenterRef: createRef(), confettiCanvasRef: createRef(),
      boardForDisplay: state.board, boardLegalMoves: [], boardSelectedTile: null, lastPlayedTile: null, boardShowOpenEndGlow: false, onPositionClick: noop, historyScrubberEnabled: false,
    },
    hand: {
      myHand: state.players[ME].hand, handSelectedTile: null, onHandTileSelect: noop, legalMoves: youAreCurrent ? [...getLegalMoves(state as never, ME)] : [],
      handTileSize: 56, handCompactStacked: false, drawPulseIndex: null,
    },
    chrome: { scoreTrackOpen: false, onScoreTrackOpenChange: noop, roomReactions: [], onSendRoomEmote: noop, isMuted: true, onToggleMute: noop, isFullscreen: false, onToggleFullscreen: noop },
    connection: {
      opponentDisconnected: q.get('disconnect') === '1',
      opponentDisconnectMessage: q.get('disconnect') === '1' ? 'Opponent disconnected. The match continues on the turn clock.' : null,
      roomRecoveryState: 'idle', roomRecoveryMessage: '', onRetryRoomRecovery: noop,
    },
    tournament: {
      tournamentMatch: { tournamentId: T, matchId: 'm-sf', round: 2, matchNumber: 1, roomCode: 'ROOM-H', stageLabel: 'Semifinal', isTournament: true, opponentUserId: oppId, opponentUsername: oppLabel, opponentRating: null },
      consumedTournamentGameOverMatchIds: new Set(), tournamentMyLabel: 'me', tournamentOpponentLabel: oppLabel,
      onTournamentViewBracket: noop, onTournamentViewFinalResult: noop, onTournamentReturnToHub: noop,
    },
    postGame: {
      canUseRematch: false, rematchRequested: false, rematchWaitingText: undefined, onRematch: noop, onPostGame: noop, multiplayerRatingSummary: null,
      onOpenMultiplayerAnalyzer: noop, handReveal: null, handRevealAutoProgress: 0,
    },
    leave: { showLeaveConfirm: false, onRequestLeaveConfirm: noop, onLeaveConfirmDismiss: noop, leaveModalIsTournament: true, onConfirmLeaveMatch: noop },
  };
  return (
    <AuthProvider>
      <div className="app">
        <LiveMatchScreen {...props} />
        {q.get('banner') === '1' ? (
          <TournamentReadyBanner match={{ matchId: 'm-other', tournamentId: 'live-2', round: 1, roomCode: null }} mode="in_game" joining={false} onJoin={noop} onDismiss={noop} />
        ) : null}
      </div>
    </AuthProvider>
  );
}

const m = (id: string, round: 1 | 2 | 3, n: number, p1: string | null, p2: string | null, over: Partial<TournamentMatch> = {}): TournamentMatch => ({
  id, tournament_id: T, round, match_number: n, player1_id: p1, player2_id: p2, winner_id: null, room_code: null, status: 'waiting',
  bot_tier: null, started_at: null, completed_at: null, player1_score: null, player2_score: null, ...over,
});
const reg = (user_id: string, username: string): Registration => ({ id: `r-${user_id}`, tournament_id: T, user_id, registered_at: '', seed: null, placement: null, status: 'active', username });
const tournamentRow = { id: T, kind: 'live' as const, status: 'in_progress' as const, scheduled_start: new Date(NOW - 600_000).toISOString(), registration_open_at: '', registration_close_at: '', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '' };

function bracketMatches(stage: string): TournamentMatch[] {
  const qf = [
    m('qf1', 1, 1, 'u-me', bot(2), { status: 'completed', winner_id: 'u-me', bot_tier: 'standard', outcomeKind: 'played', player1_score: 30, player2_score: 17 }),
    m('qf2', 1, 2, 'u-ana', 'u-long', { status: 'completed', winner_id: 'u-long', outcomeKind: 'forfeit', player1_score: 0, player2_score: 30 }),
    m('qf3', 1, 3, bot(3), bot(7), { status: 'completed', winner_id: bot(7), bot_tier: 'standard', outcomeKind: 'bot_simulated', player1_score: 22, player2_score: 30 }),
    m('qf4', 1, 4, 'u-kai', bot(8), { status: 'completed', winner_id: 'u-kai', bot_tier: 'standard', outcomeKind: 'missed_turns', player1_score: 30, player2_score: 0 }),
  ];
  const sfReady = [
    m('sf1', 2, 1, 'u-me', 'u-long', { status: 'ready' }),
    m('sf2', 2, 2, bot(7), 'u-kai', { status: 'in_progress', bot_tier: 'elite' }),
  ];
  if (stage === 'sf') return [...qf, ...sfReady, m('f', 3, 1, null, null)];
  // final-fritz: Master Fritz beat the player in the Final.
  const sfDone = [
    m('sf1', 2, 1, 'u-me', 'u-long', { status: 'completed', winner_id: 'u-me', outcomeKind: 'administrative', player1_score: 24, player2_score: 19 }),
    m('sf2', 2, 2, bot(7), 'u-kai', { status: 'completed', winner_id: bot(7), bot_tier: 'elite', outcomeKind: 'played', player1_score: 30, player2_score: 26 }),
  ];
  return [...qf, ...sfDone, m('f', 3, 1, 'u-me', bot(7), { status: 'completed', winner_id: bot(7), bot_tier: 'master', outcomeKind: 'played', player1_score: 21, player2_score: 30 })];
}

function Bracket() {
  const stage = q.get('stage') ?? 'sf';
  const matches = bracketMatches(stage);
  const view: BracketView = { tournament: tournamentRow, registrations: [reg('u-me', 'me'), reg('u-ana', 'ana'), reg('u-long', LONG), reg('u-kai', 'kai')], matches };
  const noop = () => undefined;
  return (
    <AuthProvider>
      <div className="app">
        <TournamentBracketScreen
          identity={{ userId: 'u-me', username: 'me' }}
          tournamentId={T}
          bracket={view}
          tournamentPhase={stage === 'sf' ? 'match_ready' : 'eliminated'}
          assignedMatch={stage === 'sf' ? { matchId: 'sf1', tournamentId: T, round: 2, matchNumber: 1, opponentId: 'u-long', opponentUsername: LONG, roomCode: 'R', matchStatus: 'ready', scheduledStart: '', matchStartsAt: null, readyDeadlineAt: null } : null}
          onLoadBracket={noop}
          onBack={noop}
          onExitToHub={noop}
          onAttachAssignedMatch={noop}
        />
      </div>
    </AuthProvider>
  );
}

function Result() {
  const result = {
    tournamentId: T, kind: 'live' as const, scheduledStart: '', format: '7-tile', winTarget: 30, championId: bot(7), championName: 'Master Fritz',
    championIsFritz: true, championFritzTier: 'master' as const, finalOutcomeKind: 'played' as const, placements: [],
  };
  const mine: MyTournament[] = [{ ...tournamentRow, status: 'completed', myRegistration: { status: 'eliminated', placement: 2, placementLabel: '2nd', seed: 1 }, myLastMatch: { matchId: 'f', round: 3, won: false, outcomeKind: 'played', opponentId: bot(7), opponentBotTier: 'master' } }];
  const upcoming = [{ ...tournamentRow, id: 'next', status: 'registration_open' as const, scheduled_start: new Date(NOW + 3 * 3_600_000).toISOString() }];
  const v = deriveResultView({ tournamentId: T, result, myTournaments: mine, upcoming, activeAssignedMatch: null });
  return (
    <div className="app">
      <TournamentResultScreen champion={v.champion} yourPlacement="2nd" myOutcome={v.myOutcome} nextEventStart={v.nextEventStart} nextMatch={q.get('next') === '1' ? { matchId: 'x', round: 3 } : null} onJoinNextMatch={() => undefined} onNextTournament={() => undefined} />
    </div>
  );
}

function Overlay() {
  const kind = q.get('outcome') ?? 'played';
  const dealt = dealtState(bot(2), true);
  const state: GameState = {
    ...dealt,
    gameOver: true,
    winnerId: ME,
    players: { ...dealt.players, [ME]: { ...dealt.players[ME], score: 30 }, [bot(2)]: { ...dealt.players[bot(2)], score: 18 } },
  };
  const myTournaments: MyTournament[] = kind === 'administrative'
    ? [{ ...tournamentRow, myRegistration: { status: 'active', placement: null, placementLabel: null, seed: null }, myLastMatch: { matchId: 'm-qf', round: 1, won: true, outcomeKind: 'administrative', opponentId: bot(2), opponentBotTier: 'standard' } }]
    : [];
  const next = q.get('next') === '1'
    ? { matchId: 'm-sf', tournamentId: T, round: 2 as const, matchNumber: 1, roomCode: 'R2', opponentId: null, opponentUsername: null, matchStatus: 'ready' as const, readyDeadlineAt: null }
    : null;
  const noop = () => undefined;
  return (
    <TournamentPostgameContext.Provider value={{ myTournaments, activeAssignedMatch: next, joining: false, onJoin: noop }}>
      <div className="app">
        <TournamentGameOverOverlay
          state={state}
          myId={ME}
          tournamentMatch={{ tournamentId: T, matchId: 'm-qf', round: 1, matchNumber: 1, roomCode: 'R1', stageLabel: 'Quarterfinal', isTournament: true, opponentUserId: bot(2), opponentUsername: 'Fritz', opponentRating: null }}
          myDisplayName="me"
          opponent={tournamentPlayerDisplay(bot(2), { round: 1 })}
          onViewBracket={noop}
          onViewFinalResult={noop}
          onReturnToTournament={noop}
        />
      </div>
    </TournamentPostgameContext.Provider>
  );
}

const VIEWS: Record<string, () => ReactNode> = { hud: () => <Hud />, bracket: () => <Bracket />, result: () => <Result />, overlay: () => <Overlay /> };
createRoot(document.getElementById('root')!).render(<StrictMode>{(VIEWS[view] ?? VIEWS.hud)()}</StrictMode>);
