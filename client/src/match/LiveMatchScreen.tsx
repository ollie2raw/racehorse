import React, { useMemo, type RefObject } from 'react';
import {
  AnimatedScore,
  Board,
  BoardOpenEndsPill,
  BoneyardCountPill,
  DominoTile,
  FullscreenIcon,
  HomeIcon,
  RotateOverlay,
  ScoreTrackOverlay,
  VolumeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '../components';
import type { BoardHandle } from '../components';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MatchLiveLayout } from './board';
import LeaveGameModal from '../components/LeaveGameModal';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import HandOverModal from '../components/handOver/HandOverModal';
import {
  buildHandOverReasonCopy,
  buildMultiplayerHandOverReveals,
  loserDisplayLabel,
  resolveWinnerSide,
  winnerDisplayLabel,
} from '../components/handOver/handOverCopy';
import TileRack from '../components/TileRack';
import GameOverModal from '../components/GameOverModal';
import { PreGameTileDrawBoard } from './preGameDraw/PreGameTileDrawBoard';
import type { PreGameDrawState } from './preGameDraw/preGameDrawLogic';
import { RoomReactions, type RoomChatEvent, type RoomEmoteEvent } from '../components/RoomReactions';
import TournamentMatchHud from '../tournament/TournamentMatchHud';
import { tournamentStageShortLabel } from '../tournament/displayNames';
import { shouldShowTournamentGameOverOverlay } from '../tournament/tournamentPostgamePolicy';
import type { TournamentMatchContext } from './session/useTournamentMatchSession';
import { tileEquals } from '../game/tileUtils';
import { useRenderProfiler } from '../debug/renderProfiler';
import { buildPlayableTileKeys, getHandTileLegality } from '../utils/handTileLegality';
import type { GameState, Move, PlacementPosition, Tile } from '../types';
import type { RoomPlayer } from '../multiplayer/multiplayerRuntime';

type HandRevealState = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: { you: number; opponent: number };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

type FlyingTile = { x: number; y: number; toX: number; toY: number; id: number };

type ScoreToastState = {
  message: string;
  tone: 'you' | 'opp';
  visible: boolean;
} | null;

type AbandonedMatchNotice = {
  context: 'tournament' | 'multiplayer';
  title: string;
  detail: string;
  tournamentId?: string | null;
};

export type LiveMatchScreenProps = {
  visible: boolean;
  state: GameState | null;
  you: string;
  opponentId: string | null;
  opponentName: string;
  myName: string;
  myScore: number;
  opponentScore: number;
  opponentTileCount: number;
  isMyTurn: boolean;
  isHandActive: boolean;
  hudScorePulse: Record<string, boolean>;
  hudRightLabel: string;
  hudRightScore: number;
  hudRightScorePulse: boolean;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  boneyardCount: number;
  openEndsSum: number;
  boardRef: RefObject<BoardHandle | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  trayCenterRef: RefObject<HTMLDivElement | null>;
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  boardForDisplay: GameState['board'];
  boardLegalMoves: Move[];
  boardSelectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  boardShowOpenEndGlow: boolean;
  onPositionClick: (position: PlacementPosition) => void;
  myHand: Tile[];
  handSelectedTile: Tile | null;
  onHandTileSelect: (tile: Tile) => void;
  legalMoves: Move[];
  handTileSize: number;
  handCompactStacked: boolean;
  drawPulseIndex: number | null;
  scoreToast: ScoreToastState;
  scoreTrackOpen: boolean;
  onScoreTrackOpenChange: (open: boolean) => void;
  winTarget?: number;
  roomReactions: Array<RoomChatEvent | RoomEmoteEvent>;
  onSendRoomChat: (message: string) => void;
  onSendRoomEmote: (emote: RoomEmoteEvent['emote']) => void;
  isMuted: boolean;
  onToggleMute: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  opponentDisconnected: boolean;
  opponentDisconnectMessage: string | null;
  roomRecoveryState: 'idle' | 'reconnecting' | 'resyncing' | 'failed';
  roomRecoveryMessage: string;
  onRetryRoomRecovery: () => void;
  tournamentMatch: TournamentMatchContext | null;
  consumedTournamentGameOverMatchIds: ReadonlySet<string>;
  tournamentMyLabel: string;
  tournamentOpponentLabel: string | null;
  onTournamentViewBracket: () => void;
  onTournamentViewFinalResult: () => void;
  onTournamentReturnToHub: () => void;
  canUseRematch: boolean;
  rematchRequested: boolean;
  rematchWaitingText: string | undefined;
  onRematch: () => void;
  onPostGame: () => void;
  players: RoomPlayer[];
  multiplayerRatingSummary: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  onOpenMultiplayerAnalyzer: () => void;
  handReveal: HandRevealState | null;
  handRevealAutoProgress: number;
  flyingTiles: FlyingTile[];
  showLeaveConfirm: boolean;
  onRequestLeaveConfirm: () => void;
  onLeaveConfirmDismiss: () => void;
  leaveModalIsTournament: boolean;
  onConfirmLeaveMatch: () => void;
  abandonedMatchNotice: AbandonedMatchNotice | null;
  onAbandonedPrimary: () => void;
  onAbandonedSecondary: () => void;
  onAbandonedDismiss: () => void;
  preGameDraw?: PreGameDrawState | null;
  onPregameTileTap?: (tileId: string) => void;
};

// ─── Hand View ───────────────────────────────────────────────

interface HandViewProps {
  hand: Tile[];
  selectedTile: Tile | null;
  onSelect: (tile: Tile) => void;
  isMyTurn: boolean;
  legalMoves: Move[];
  tileSize: number;
  compactStacked: boolean;
  drawPulseIndex: number | null;
}

const HandView = React.memo(function HandView({
  hand,
  selectedTile,
  onSelect,
  isMyTurn,
  legalMoves,
  tileSize,
  compactStacked,
  drawPulseIndex,
}: HandViewProps) {
  useRenderProfiler('HandView');
  const playableTileKeys = useMemo(() => buildPlayableTileKeys(legalMoves), [legalMoves]);

  const renderTile = (tile: Tile, idx: number) => {
    const isSel = selectedTile && tileEquals(tile, selectedTile);
    const { highlight, unplayable } = getHandTileLegality(tile, isMyTurn, playableTileKeys);
    return (
      <DominoTile
        key={`${tile.low}-${tile.high}`}
        tile={tile}
        size={tileSize}
        selected={isSel ?? false}
        highlight={highlight}
        unplayable={unplayable}
        onClick={() => isMyTurn && onSelect(tile)}
        disabled={!isMyTurn}
        className={drawPulseIndex === idx ? 'new-draw' : ''}
      />
    );
  };

  if (compactStacked) {
    const splitAt = Math.ceil(hand.length / 2);
    const firstRow = hand.slice(0, splitAt);
    const secondRow = hand.slice(splitAt);
    return (
      <div className="hand-container is-stacked">
        <div className="hand-row">{firstRow.map((tile, idx) => renderTile(tile, idx))}</div>
        <div className="hand-row">{secondRow.map((tile, idx) => renderTile(tile, splitAt + idx))}</div>
      </div>
    );
  }

  return (
    <div className="hand-container has-single-row">
      <div className="hand-row">{hand.map((tile, idx) => renderTile(tile, idx))}</div>
    </div>
  );
}, (prev, next) => (
  prev.hand === next.hand &&
  prev.selectedTile === next.selectedTile &&
  prev.onSelect === next.onSelect &&
  prev.isMyTurn === next.isMyTurn &&
  prev.legalMoves === next.legalMoves &&
  prev.tileSize === next.tileSize &&
  prev.compactStacked === next.compactStacked &&
  prev.drawPulseIndex === next.drawPulseIndex
));

// ─── Game Over Overlays ──────────────────────────────────────

interface GameOverOverlayProps {
  state: GameState;
  myId: string;
  onPrimary: () => void;
  primaryLabel: string;
  onExit: () => void;
  secondaryLabel: string;
  waitingText?: string;
  players: RoomPlayer[];
  ratingSummary?: {
    pending: boolean;
    delta: number | null;
    newRating: number | null;
  } | null;
  extraActionLabel?: string;
  onExtraAction?: () => void;
}

function GameOverOverlay({
  state,
  myId,
  onPrimary,
  primaryLabel,
  onExit,
  secondaryLabel,
  waitingText,
  players,
  ratingSummary = null,
  extraActionLabel,
  onExtraAction,
}: GameOverOverlayProps) {
  const winner = state.winnerId;
  const getName = (pid: string, idx: number) => {
    const p = players.find((pl) => pl.id === pid);
    if (p?.username) return `@${p.username}`;
    return pid === myId ? 'You' : `Player ${idx + 1}`;
  };
  const playerScores = state.playerIds.map((pid, idx) => ({
    pid,
    name: getName(pid, idx),
    score: state.players[pid]?.score ?? 0,
  }));
  const myScore = state.players[myId]?.score ?? 0;
  const opponent = playerScores.find((entry) => entry.pid !== myId) ?? null;
  const opponentScore = opponent?.score ?? 0;
  const margin = Math.abs(myScore - opponentScore);
  const didWin = winner === myId;
  const victoryTitle = winner ? (didWin ? 'Victory' : 'Defeat') : 'Match Complete';
  const resultLabel = winner ? (didWin ? 'Victory' : 'Defeat') : 'Complete';
  const subtitle = opponent
    ? didWin
      ? `You finished ahead of ${opponent.name}.`
      : winner
        ? `${opponent.name} closed out the match.`
        : `Final standings are locked in against ${opponent.name}.`
    : 'Final multiplayer standings.';

  return (
    <GameOverModal
      open
      ariaLabel="Game over"
      matchKind="multiplayer"
      primaryAccent="blue"
      kicker="Multiplayer Result"
      title={victoryTitle}
      subtitle={subtitle}
      tone={didWin ? 'blue' : 'red'}
      stats={[
        { label: 'Final Score', value: `${myScore}-${opponentScore}`, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
        { label: 'Margin', value: winner ? `${didWin ? '+' : '-'}${margin}` : `${margin}`, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
        { label: 'Result', value: resultLabel, tone: winner ? (didWin ? 'blue' : 'red') : 'default' },
      ]}
      scores={playerScores.map((row) => ({
        label: row.name,
        value: row.score,
        winner: row.pid === winner,
        showCrown: row.pid === winner,
      }))}
      primaryLabel={primaryLabel}
      onPrimary={onPrimary}
      secondaryLabel={secondaryLabel}
      onSecondary={onExit}
      extraActionLabel={extraActionLabel}
      onExtraAction={onExtraAction}
      onClose={onExit}
    >
      {ratingSummary && (
        <div className="rh-go-rating">
          <span>Rating</span>
          <strong>
            {ratingSummary.pending
              ? 'Updating...'
              : ratingSummary.delta != null && ratingSummary.newRating != null
                ? `${ratingSummary.delta >= 0 ? '+' : ''}${ratingSummary.delta}  •  ${ratingSummary.newRating}`
                : 'Updated'}
          </strong>
        </div>
      )}
      {waitingText && <p className="rh-go-waiting">{waitingText}</p>}
    </GameOverModal>
  );
}

function tournamentEliminationLabel(round: 1 | 2 | 3): string {
  return tournamentStageShortLabel(round);
}

function TournamentGameOverOverlay({
  state,
  myId,
  tournamentMatch,
  myDisplayName,
  opponentDisplayName,
  onViewBracket,
  onViewFinalResult,
  onReturnToTournament,
}: {
  state: GameState;
  myId: string;
  tournamentMatch: TournamentMatchContext;
  myDisplayName: string;
  opponentDisplayName: string;
  onViewBracket: () => void;
  onViewFinalResult: () => void;
  onReturnToTournament: () => void;
}) {
  const didWin = state.winnerId === myId;
  const isFinal = tournamentMatch.round === 3;
  const title = isFinal
    ? didWin
      ? 'Tournament Champion'
      : 'Runner-up'
    : didWin
      ? tournamentMatch.round === 1
        ? 'You advanced to the Semifinal'
        : 'You advanced to the Final'
      : `Eliminated in the ${tournamentEliminationLabel(tournamentMatch.round)}`;
  const subtitle = isFinal
    ? didWin
      ? 'You won the tournament. View the bracket or final standings.'
      : 'Strong run — view the bracket or return to the tournament hub.'
    : didWin
      ? `You beat ${opponentDisplayName}. View the bracket while the next round prepares.`
      : `Eliminated by ${opponentDisplayName}. View the bracket or return to the tournament hub.`;
  const myScore = state.players[myId]?.score ?? 0;
  const opponentId = state.playerIds.find((pid) => pid !== myId) ?? null;
  const opponentScore = opponentId ? (state.players[opponentId]?.score ?? 0) : 0;
  const margin = Math.abs(myScore - opponentScore);
  const roundLabel = tournamentEliminationLabel(tournamentMatch.round);

  return (
    <GameOverModal
      open
      ariaLabel="Tournament match complete"
      matchKind="multiplayer"
      primaryAccent={isFinal ? 'gold' : 'blue'}
      kicker={isFinal ? 'Tournament Final' : `Tournament ${roundLabel}`}
      title={title}
      subtitle={subtitle}
      tone={didWin ? 'gold' : 'red'}
      stats={[
        { label: 'Final Score', value: `${myScore}-${opponentScore}`, tone: didWin ? 'gold' : 'red' },
        { label: 'Margin', value: `${didWin ? '+' : '-'}${margin}`, tone: didWin ? 'gold' : 'red' },
        { label: isFinal ? 'Result' : 'Round', value: isFinal ? (didWin ? 'Champion' : 'Runner-Up') : roundLabel, tone: didWin ? 'gold' : 'red' },
      ]}
      scores={state.playerIds.map((pid) => ({
        label: pid === myId ? myDisplayName : opponentDisplayName,
        value: state.players[pid]?.score ?? 0,
        winner: pid === state.winnerId,
        showCrown: pid === state.winnerId,
      }))}
      primaryLabel={isFinal ? 'View Final Result' : 'View Bracket'}
      onPrimary={isFinal ? onViewFinalResult : onViewBracket}
      secondaryLabel={isFinal ? 'View Bracket' : 'Return to Tournament'}
      onSecondary={isFinal ? onViewBracket : onReturnToTournament}
      extraActionLabel={isFinal ? 'Return to Tournament' : undefined}
      onExtraAction={isFinal ? onReturnToTournament : undefined}
      onClose={onReturnToTournament}
    />
  );
}

function renderScoreToastMessage(message: string) {
  const pointsMatch = message.match(/\+\d+/);
  if (!pointsMatch || typeof pointsMatch.index !== 'number') return message;
  const start = pointsMatch.index;
  const end = start + pointsMatch[0].length;
  return (
    <>
      {message.slice(0, start)}
      <span
        style={{
          fontSize: '1.48rem',
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '0.01em',
          display: 'inline-block',
          margin: '0 2px',
        }}
      >
        {pointsMatch[0]}
      </span>
      {message.slice(end)}
    </>
  );
}

export function LiveMatchScreen({
  visible,
  state,
  you,
  opponentId,
  opponentName,
  myName,
  myScore,
  opponentScore,
  opponentTileCount,
  isMyTurn,
  isHandActive,
  hudScorePulse,
  hudRightLabel,
  hudRightScore,
  hudRightScorePulse,
  opponentPillRef,
  boneyardRef,
  boneyardCount,
  openEndsSum,
  boardRef,
  handAreaRef,
  trayCenterRef,
  confettiCanvasRef,
  boardForDisplay,
  boardLegalMoves,
  boardSelectedTile,
  lastPlayedTile,
  boardShowOpenEndGlow,
  onPositionClick,
  myHand,
  handSelectedTile,
  onHandTileSelect,
  legalMoves,
  handTileSize,
  handCompactStacked,
  drawPulseIndex,
  scoreToast,
  scoreTrackOpen,
  onScoreTrackOpenChange,
  winTarget = 60,
  roomReactions,
  onSendRoomChat,
  onSendRoomEmote,
  isMuted,
  onToggleMute,
  isFullscreen,
  onToggleFullscreen,
  opponentDisconnected,
  opponentDisconnectMessage,
  roomRecoveryState,
  roomRecoveryMessage,
  onRetryRoomRecovery,
  tournamentMatch,
  consumedTournamentGameOverMatchIds,
  tournamentMyLabel,
  tournamentOpponentLabel,
  onTournamentViewBracket,
  onTournamentViewFinalResult,
  onTournamentReturnToHub,
  canUseRematch,
  rematchRequested,
  rematchWaitingText,
  onRematch,
  onPostGame,
  players,
  multiplayerRatingSummary,
  onOpenMultiplayerAnalyzer,
  handReveal,
  handRevealAutoProgress,
  flyingTiles,
  showLeaveConfirm,
  onRequestLeaveConfirm,
  onLeaveConfirmDismiss,
  leaveModalIsTournament,
  onConfirmLeaveMatch,
  abandonedMatchNotice,
  onAbandonedPrimary,
  onAbandonedSecondary,
  onAbandonedDismiss,
  preGameDraw,
  onPregameTileTap,
}: LiveMatchScreenProps) {
  const showGameOverOverlay = Boolean(state?.gameOver);

  if (!visible || !state) {
    return (
      <>
        {showLeaveConfirm && (
          <LeaveGameModal
            onCancel={onLeaveConfirmDismiss}
            title={leaveModalIsTournament ? 'Forfeit Tournament Match?' : 'Leave Match?'}
            copy={
              leaveModalIsTournament
                ? 'Leaving will forfeit this tournament match. You will be eliminated from the bracket.'
                : 'Leaving will forfeit this match. Your opponent will be notified.'
            }
            confirmLabel={leaveModalIsTournament ? 'Forfeit Match' : 'Leave Match'}
            onLeave={onConfirmLeaveMatch}
          />
        )}
        {abandonedMatchNotice ? (
          <GameOverModal
            open
            ariaLabel="Match abandoned"
            matchKind="multiplayer"
            title={abandonedMatchNotice.title}
            subtitle={abandonedMatchNotice.detail}
            scores={[]}
            primaryLabel={abandonedMatchNotice.context === 'tournament' ? 'Back to Bracket' : 'Back to Multiplayer'}
            onPrimary={onAbandonedPrimary}
            secondaryLabel={abandonedMatchNotice.context === 'tournament' ? 'Tournament Lobby' : 'Home'}
            onSecondary={onAbandonedSecondary}
            onClose={onAbandonedDismiss}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <>
          <RotateOverlay />
          <div className="screen game-screen walnut-live theme-green bot-match-screen rh-match-live">
            {opponentDisconnected && opponentDisconnectMessage && roomRecoveryState === 'idle' && (
              <div
                style={{
                  position: 'fixed',
                  top: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1190,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(251,191,36,0.35)',
                  background: 'rgba(15,25,20,0.82)',
                  color: 'rgba(255,236,200,0.95)',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                }}
              >
                {opponentDisconnectMessage}
              </div>
            )}
            {roomRecoveryState !== 'idle' && (
              <div
                style={{
                  position: 'fixed',
                  top: 12,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 1200,
                  padding: '8px 14px',
                  borderRadius: 999,
                  border: '1px solid rgba(236,252,245,0.24)',
                  background: 'rgba(15,25,20,0.82)',
                  color: 'rgba(232,245,240,0.95)',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>
                  {roomRecoveryState === 'reconnecting'
                    ? 'Reconnecting…'
                    : roomRecoveryState === 'resyncing'
                      ? 'Syncing room…'
                      : 'Reconnect failed'}
                </span>
                {roomRecoveryMessage && roomRecoveryState !== 'reconnecting' && (
                  <span style={{ fontWeight: 500, opacity: 0.9 }}>{roomRecoveryMessage}</span>
                )}
                {roomRecoveryState === 'failed' && (
                  <button
                    type="button"
                    onClick={onRetryRoomRecovery}
                    style={{
                      border: '1px solid rgba(236,252,245,0.24)',
                      background: 'rgba(255,255,255,0.08)',
                      color: 'inherit',
                      borderRadius: 999,
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
            <ScoreTrackOverlay
              open={scoreTrackOpen}
              onClose={() => onScoreTrackOpenChange(false)}
              target={winTarget}
              players={[
                { label: opponentName, score: opponentScore, tone: 'opp' },
                { label: myName, score: myScore, tone: 'you' },
              ]}
            />
            <canvas
              ref={confettiCanvasRef}
              style={{
                position: 'fixed',
                inset: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 2100,
                display: showGameOverOverlay ? 'block' : 'none',
              }}
            />
            {showGameOverOverlay && tournamentMatch ? (
              shouldShowTournamentGameOverOverlay({
                gameOver: state.gameOver,
                matchId: tournamentMatch.matchId,
                consumedMatchIds: consumedTournamentGameOverMatchIds,
              }) ? (
                <TournamentGameOverOverlay
                  state={state}
                  myId={you}
                  tournamentMatch={tournamentMatch}
                  myDisplayName={tournamentMyLabel}
                  opponentDisplayName={tournamentOpponentLabel ?? 'Opponent'}
                  onViewBracket={onTournamentViewBracket}
                  onViewFinalResult={onTournamentViewFinalResult}
                  onReturnToTournament={onTournamentReturnToHub}
                />
              ) : null
            ) : showGameOverOverlay ? (
              <GameOverOverlay
                state={state}
                myId={you}
                onPrimary={canUseRematch ? onRematch : onPostGame}
                primaryLabel={canUseRematch ? (rematchRequested ? 'Rematch Requested' : 'Rematch') : 'New Game'}
                onExit={onPostGame}
                secondaryLabel={canUseRematch ? 'Home' : 'Back'}
                waitingText={canUseRematch ? rematchWaitingText : undefined}
                players={players}
                ratingSummary={multiplayerRatingSummary}
                extraActionLabel="Analyze Game"
                onExtraAction={onOpenMultiplayerAnalyzer}
              />
            ) : null}
            {handReveal && !state.gameOver && (
              <GameOverlayPortal>
                {(() => {
                  const youPoints = handReveal.pointsAwarded.you;
                  const opponentPoints = handReveal.pointsAwarded.opponent;
                  const winner =
                    youPoints > opponentPoints ? 'you' : opponentPoints > youPoints ? 'opponent' : 'none';
                  const pointsAwarded = Math.max(youPoints, opponentPoints, 0);
                  const yourCount = handReveal.yourRemainingTiles.length;
                  const oppCount = handReveal.opponentRemainingTiles.length;
                  const whoWentOutRaw =
                    handReveal.whoWentOut ?? handReveal.winnerId ?? handReveal.handWinnerId ?? null;
                  const youWentOut =
                    whoWentOutRaw === 'you' || whoWentOutRaw === you || (whoWentOutRaw == null && yourCount === 0);
                  const oppWentOut =
                    whoWentOutRaw === 'opponent' ||
                    (Boolean(opponentId) && whoWentOutRaw === opponentId) ||
                    (whoWentOutRaw == null && oppCount === 0);
                  const winnerSide = resolveWinnerSide(winner);

                  return (
                    <HandOverModal
                      variant="mp"
                      pointsAwarded={pointsAwarded}
                      winnerSide={winnerSide}
                      winnerLabel={winnerDisplayLabel(winnerSide, opponentName)}
                      loserLabel={loserDisplayLabel(winnerSide, opponentName)}
                      reasonCopy={buildHandOverReasonCopy({
                        youWentOut,
                        opponentWentOut: oppWentOut,
                        isBlocked: !youWentOut && !oppWentOut,
                        opponentName,
                        pointsAwarded,
                      })}
                      tileReveals={buildMultiplayerHandOverReveals(
                        handReveal,
                        winner,
                        youWentOut,
                        oppWentOut,
                        opponentName,
                      )}
                      progress={handRevealAutoProgress}
                    />
                  );
                })()}
              </GameOverlayPortal>
            )}
            <MatchLiveLayout
              hudLeft={
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    ref={opponentPillRef}
                    style={{ margin: 8 }}
                    className={`wl-player-pill wl-player-pill-btn score-card ${opponentId && hudScorePulse[opponentId] ? 'score-hit' : ''}`}
                    onClick={() => onScoreTrackOpenChange(true)}
                    aria-label="Open score track"
                  >
                    <div className="wl-pill-top">
                      <span className="wl-player-label">{opponentName}</span>
                    </div>
                    <AnimatedScore value={opponentScore} className="wl-player-score" />
                  </button>
                  <TileRack count={opponentTileCount} isActive={!isMyTurn} />
                </div>
              }
              hudCenter={
                <div
                  className="wl-center-status"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    display: (isHandActive || tournamentMatch || (state.handNumber === 0 && !!preGameDraw)) ? 'flex' : 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {state.handNumber === 0 && preGameDraw ? (
                    (() => {
                      let label = '';
                      let tone = 'your-turn';
                      const phase = preGameDraw.phase as string;
                      const { winner, currentRound } = preGameDraw;
                      if (phase === 'showing-tie') {
                        label = 'Tie — tap again';
                        tone = 'your-turn';
                      } else if (phase === 'showing-reveal' || phase === 'showing-result' || phase === 'resolved') {
                        if (winner === 'you') {
                          label = 'You go first';
                          tone = 'your-turn';
                        } else if (winner === 'bot') {
                          label = `${opponentName} goes first`;
                          tone = 'opp-turn';
                        } else {
                          label = 'Tie — tap again';
                          tone = 'your-turn';
                        }
                      } else if (currentRound.you) {
                        label = `Waiting for ${opponentName}…`;
                        tone = 'opp-turn';
                      } else {
                        label = 'Tap a tile to draw';
                        tone = 'your-turn';
                      }
                      return (
                        <span className={`wl-turn-label ${tone}`}>
                          {label}
                        </span>
                      );
                    })()
                  ) : tournamentMatch ? (
                    <TournamentMatchHud
                      round={tournamentMatch.round}
                      turnLabel={
                        isHandActive
                          ? isMyTurn
                            ? 'Your move'
                            : 'Opponent thinking'
                          : null
                      }
                      turnVariant={isMyTurn ? 'your-turn' : 'opp-turn'}
                    />
                  ) : isHandActive ? (
                    <span className={`wl-turn-label ${isMyTurn ? 'your-turn' : 'opp-turn'}`}>
                      {isMyTurn ? 'Your move' : 'Opponent thinking'}
                    </span>
                  ) : null}
                </div>
              }
              hudRight={
                <button
                  type="button"
                  style={{ margin: 8 }}
                  className={`wl-player-pill wl-player-pill-btn score-card is-you ${hudRightScorePulse ? 'score-hit' : ''}`}
                  onClick={() => onScoreTrackOpenChange(true)}
                  aria-label="Open score track"
                >
                  <div className="wl-pill-top">
                    <span className="wl-player-label">{hudRightLabel}</span>
                  </div>
                  <AnimatedScore value={hudRightScore} className="wl-player-score" />
                </button>
              }
              boardInner={
                <>
                  {scoreToast && (
                    <div
                      style={{
                        position: 'absolute',
                        top: 16,
                        left: '50%',
                        transform: scoreToast.visible
                          ? 'translate(-50%, 0px) scale(1)'
                          : 'translate(-50%, -14px) scale(0.95)',
                        opacity: scoreToast.visible ? 1 : 0,
                        transition: 'opacity 250ms ease, transform 250ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                        zIndex: 14,
                        background: 'rgba(255,255,255,0.06)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 999,
                        padding: '10px 22px',
                        color:
                          scoreToast.tone === 'you'
                            ? 'rgba(151, 241, 205, 0.98)'
                            : 'rgba(255, 180, 180, 0.95)',
                        fontSize: '1.24rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                        lineHeight: 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        boxShadow: scoreToast.tone === 'you'
                          ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(100,220,160,0.1)'
                          : 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px rgba(0,0,0,0.25), 0 0 0 1px rgba(220,100,100,0.1)',
                      }}
                    >
                      {renderScoreToastMessage(scoreToast.message)}
                    </div>
                  )}
                  {!state.gameOver && (
                    <div className="rh-board-meta-bar" data-ui="board-meta">
                      <BoardOpenEndsPill board={state.board} openEndsSum={openEndsSum} />
                      <BoneyardCountPill ref={boneyardRef} count={boneyardCount} />
                    </div>
                  )}
                  <div
                    className="wl-controls-tray control-pill"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      bottom: 12,
                      right: 12,
                      zIndex: 20,
                    }}
                  >
                    <button
                      type="button"
                      className="wl-control-btn"
                      title="Zoom out"
                      aria-label="Zoom out"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        boardRef.current?.zoomOut();
                      }}
                    >
                      <ZoomOutIcon />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      title="Zoom in"
                      aria-label="Zoom in"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        boardRef.current?.zoomIn();
                      }}
                    >
                      <ZoomInIcon />
                    </button>
                    <RoomReactions feed={roomReactions} onSendChat={onSendRoomChat} onSendEmote={onSendRoomEmote} />
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onToggleMute}
                      title={isMuted ? 'Unmute' : 'Mute'}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                    >
                      <VolumeIcon isMuted={isMuted} />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onToggleFullscreen}
                      title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                      aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                    >
                      <FullscreenIcon isFullscreen={isFullscreen} />
                    </button>
                    <button
                      type="button"
                      className="wl-control-btn"
                      onClick={onRequestLeaveConfirm}
                      title="Leave game"
                      aria-label="Leave game"
                    >
                      <HomeIcon />
                    </button>
                  </div>
                  <ErrorBoundary
                    context="board"
                    fallback={
                      <div
                        style={{
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          color: '#6b7a94',
                        }}
                      >
                        Board unavailable — please refresh
                      </div>
                    }
                  >
                  {state.handNumber === 0 && preGameDraw ? (
                    <PreGameTileDrawBoard
                      drawState={preGameDraw}
                      isPlayerPickEnabled={
                        !preGameDraw.currentRound?.you &&
                        (preGameDraw.phase as string) !== 'showing-tie' &&
                        (preGameDraw.phase as string) !== 'showing-reveal' &&
                        (preGameDraw.phase as string) !== 'showing-result' &&
                        preGameDraw.phase !== 'resolved'
                      }
                      onTileTap={onPregameTileTap || (() => {})}
                    />
                  ) : (
                    <Board
                      ref={boardRef}
                      showZoomTray={false}
                      board={boardForDisplay}
                      legalMoves={boardLegalMoves}
                      selectedTile={boardSelectedTile}
                      lastPlayedTile={lastPlayedTile}
                      onPositionClick={onPositionClick}
                      tileSize={84}
                      showOpenEndGlow={boardShowOpenEndGlow}
                    />
                  )}
                  </ErrorBoundary>
                </>
              }
              handDock={
                state.handNumber === 0 && preGameDraw ? (
                  <div className="hand-area wl-hand-area pre-game-draw-hand-dock" data-ui="tray" aria-hidden="true" />
                ) : (
                  <div ref={handAreaRef} className="hand-area wl-hand-area" data-ui="tray">
                    <div className="tray-rail">
                      <div className="tray-center" ref={trayCenterRef}>
                        <HandView
                          hand={myHand}
                          selectedTile={handSelectedTile}
                          onSelect={onHandTileSelect}
                          isMyTurn={isMyTurn && !state.handOver && !state.gameOver}
                          legalMoves={legalMoves}
                          tileSize={handTileSize}
                          compactStacked={handCompactStacked}
                          drawPulseIndex={drawPulseIndex}
                        />
                      </div>
                    </div>
                  </div>
                )
              }
            />

            {flyingTiles.length > 0 && (
              <GameOverlayPortal>
                {flyingTiles.map((ft) => (
                  <div
                    key={ft.id}
                    className="flying-tile-overlay"
                    style={
                      {
                        '--fly-from-x': `${ft.x}px`,
                        '--fly-from-y': `${ft.y}px`,
                        '--fly-to-x': `${ft.toX}px`,
                        '--fly-to-y': `${ft.toY}px`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </GameOverlayPortal>
            )}
          </div>
      </>

      {showLeaveConfirm && (
        <LeaveGameModal
          onCancel={onLeaveConfirmDismiss}
          title={leaveModalIsTournament ? 'Forfeit Tournament Match?' : 'Leave Match?'}
          copy={
            leaveModalIsTournament
              ? 'Leaving will forfeit this tournament match. You will be eliminated from the bracket.'
              : 'Leaving will forfeit this match. Your opponent will be notified.'
          }
          confirmLabel={leaveModalIsTournament ? 'Forfeit Match' : 'Leave Match'}
          onLeave={onConfirmLeaveMatch}
        />
      )}

      {abandonedMatchNotice ? (
        <GameOverModal
          open
          ariaLabel="Match abandoned"
          matchKind="multiplayer"
          title={abandonedMatchNotice.title}
          subtitle={abandonedMatchNotice.detail}
          scores={[]}
          primaryLabel={abandonedMatchNotice.context === 'tournament' ? 'Back to Bracket' : 'Back to Multiplayer'}
          onPrimary={onAbandonedPrimary}
          secondaryLabel={abandonedMatchNotice.context === 'tournament' ? 'Tournament Lobby' : 'Home'}
          onSecondary={onAbandonedSecondary}
          onClose={onAbandonedDismiss}
        />
      ) : null}
    </>
  );
}
