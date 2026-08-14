import type { RefObject } from 'react';
import { Board, BoneyardCountPill, RotateOverlay } from '../components';
import { MatchLiveLayout } from '../match/board';
import type { BotMatchState } from '../bot/botEngine';
import type { Move, Tile } from '../types';
import type { DailyPuzzleLeaderboardEntry } from './api';
import type { PlayStatus } from './dailyPuzzleScreenTypes';
import type { PuzzleValidationResult } from './types';
import {
  formatPuzzleElapsed,
  getDisplayName,
  tileKey,
} from './dailyPuzzleScreenHelpers';
import { DailyPuzzleSoloHandDock } from './DailyPuzzleSoloHandDock';

export type DailyPuzzleLegacyInPlayCompletionSummary = {
  completionMessage: { text: string; color: string };
  modalLeaderboard: DailyPuzzleLeaderboardEntry[];
};

export type DailyPuzzleLegacyInPlayViewModel = {
  status: PlayStatus;
  isArchiveMode: boolean;
  formattedPuzzleDate: string;
  runtimeState: BotMatchState;
  legalMoves: Move[];
  selectedTile: Tile | null;
  lastPlayedTile: Tile | null;
  handTileSize: number;
  handCompactStacked: boolean;
  playableTileKeys: Set<string>;
  solvableWarning: boolean;
  validation: PuzzleValidationResult | null;
  completedScore: number;
  completionSummary: DailyPuzzleLegacyInPlayCompletionSummary;
  bestPossibleScore: number;
  movesUsed: number;
  streakDays: number;
  currentUserId: string | null;
};

export type DailyPuzzleLegacyInPlayActions = {
  onPositionClick: (position: Move['position']) => void;
  onSelectTile: (tile: Tile) => void;
  onResetAttempt: () => void;
  onBack: () => void;
};

export type DailyPuzzleLegacyInPlayViewProps = {
  confettiCanvasRef: RefObject<HTMLCanvasElement | null>;
  viewModel: DailyPuzzleLegacyInPlayViewModel;
  actions: DailyPuzzleLegacyInPlayActions;
};

export function DailyPuzzleLegacyInPlayView({
  confettiCanvasRef,
  viewModel,
  actions,
}: DailyPuzzleLegacyInPlayViewProps) {
  const {
    status,
    isArchiveMode,
    formattedPuzzleDate,
    runtimeState,
    legalMoves,
    selectedTile,
    lastPlayedTile,
    handTileSize,
    handCompactStacked,
    playableTileKeys,
    solvableWarning,
    validation,
    completedScore,
    completionSummary,
    bestPossibleScore,
    movesUsed,
    streakDays,
    currentUserId,
  } = viewModel;

  return (
    <>
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green daily-puzzle-screen rh-match-live rh-match-solo-hud daily-puzzle-root">
        <canvas
          ref={confettiCanvasRef}
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 2100,
            display: status === 'SOLVED' ? 'block' : 'none',
          }}
        />
        <MatchLiveLayout
          hudLeft={
            <div className="wl-player-pill wl-player-pill-btn score-card is-you">
              <div className="wl-player-card-content">
                <div className="wl-player-card-text">
                  <span className="wl-player-label">{isArchiveMode ? 'Puzzle Archive' : 'Daily Puzzle'}</span>
                </div>
                <span className="wl-player-score">{runtimeState.players.you.score}</span>
              </div>
            </div>
          }
          hudCenter={
            <div className="wl-center-status" data-ui="turn-status">
              <span className="wl-turn-label your-turn">{isArchiveMode ? 'ARCHIVE PUZZLE' : 'DAILY PUZZLE'}</span>
              <span className="wl-room-code">{formattedPuzzleDate}</span>
            </div>
          }
          hudRight={
            <div className="rh-match-solo-actions">
              <button type="button" className="rh-match-solo-action-btn" onClick={actions.onResetAttempt}>
                Play Again
              </button>
              <button type="button" className="rh-match-solo-action-btn rh-back-button" onClick={actions.onBack}>
                ← Back to Home
              </button>
            </div>
          }
          boardInner={
            <>
              {!runtimeState.gameOver ? (
                <div className="rh-board-meta-bar rh-board-meta-bar--count-only" data-ui="board-meta">
                  <BoneyardCountPill count={runtimeState.boneyard.length} />
                </div>
              ) : null}
              <Board
                board={runtimeState.board}
                legalMoves={legalMoves}
                selectedTile={selectedTile}
                lastPlayedTile={lastPlayedTile}
                onPositionClick={actions.onPositionClick}
                tileSize={84}
              />
              {solvableWarning && (
                <div className="daily-puzzle-warning-banner">
                  Puzzle warning: {validation?.reason} (best score {validation?.bestScore}). You can
                  still play this puzzle.
                </div>
              )}
              {import.meta.env.DEV && solvableWarning && (
                <div className="daily-puzzle-dev-warning">
                  Dev: puzzle invalid · solvable={String(validation?.solvable)} · bestScore=
                  {validation?.bestScore} · hasScoringMove={String(validation?.hasScoringMove)} ·
                  explored={validation?.exploredStates}
                </div>
              )}
            </>
          }
          handDock={
            <DailyPuzzleSoloHandDock
              hand={runtimeState.players.you.hand}
              handTileSize={handTileSize}
              handCompactStacked={handCompactStacked}
              selectedTile={selectedTile}
              inProgress={status === 'IN_PROGRESS'}
              isTilePlayable={(tile) => playableTileKeys.has(tileKey(tile))}
              onSelectTile={actions.onSelectTile}
              handRowKeyPrefix="daily-hand-row"
              tileKeyPrefix="daily-curated"
            />
          }
        />

        {status !== 'IN_PROGRESS' && (
          <div className="rh-modal-overlay" role="dialog" aria-modal="true" style={{ ['--rh-accent-rgb' as string]: '240, 192, 64' }}>
            <div className="rh-result">
              <header className="rh-result__head">
                <div className="claude-mode-hero__eyebrow" style={{ color: 'var(--tier-elite)' }}>PUZZLE COMPLETE</div>
                <div className="rh-result__score">
                  <span>{completedScore}</span>
                  <span className="rh-result__score-suffix">PTS</span>
                </div>
                <div className="rh-result__feedback" style={{ color: completionSummary.completionMessage.color }}>
                  {completionSummary.completionMessage.text}
                </div>
              </header>

              <div className="rh-result__summary">
                <div>
                  <span className="rh-result__summary-label">Best Possible</span>
                  <span className="rh-result__summary-value">{bestPossibleScore}</span>
                </div>
                <div>
                  <span className="rh-result__summary-label">Moves Used</span>
                  <span className="rh-result__summary-value">{movesUsed}</span>
                </div>
                <div>
                  <span className="rh-result__summary-label">Current Streak</span>
                  <span className="rh-result__summary-value" style={{ color: 'var(--tier-elite)' }}>{streakDays} DAYS</span>
                </div>
              </div>

              <div className="rh-result__board">
                <div className="rh-result__board-head">
                  <div className="claude-mode-section-label">GLOBAL LEADERBOARD</div>
                  <div className="claude-mode-topbar__brand" style={{ fontSize: '10px', opacity: 0.4 }}>TODAY</div>
                </div>

                <div className="rh-result__lb">
                  <div className="rh-result__lb-head">
                    <span>#</span>
                    <span>PLAYER</span>
                    <span style={{ textAlign: 'right' }}>SCORE</span>
                    <span style={{ textAlign: 'right' }}>MOVES</span>
                    <span style={{ textAlign: 'right' }}>TIME</span>
                  </div>
                  {completionSummary.modalLeaderboard.map((row, idx) => {
                    const isYou = Boolean(currentUserId) && row.userId === currentUserId;
                    const initials = getDisplayName(row.username).replace(/^@/, '').slice(0, 2).toUpperCase() || 'P';
                    return (
                      <div key={idx} className={`rh-result__lb-row ${isYou ? 'is-you' : ''}`}>
                        <span className={`rh-result__lb-rank ${idx < 3 ? 'is-top-3' : ''}`}>{idx + 1}</span>
                        <span className="rh-result__lb-name">
                          <div className="rh-result__avatar">{initials}</div>
                          <span>@{getDisplayName(row.username)}</span>
                          {isYou && <span className="rh-result-you-pill">YOU</span>}
                        </span>
                        <span className="rh-result__lb-num">{row.bestScore}</span>
                        <span className="rh-result__lb-num">{row.bestMovesUsed}</span>
                        <span className="rh-result__lb-num">{formatPuzzleElapsed(row.bestSeconds)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <footer className="rh-result__actions">
                <button type="button" className="rh-btn-leave" onClick={actions.onResetAttempt}>Play Again</button>
                <button
                  type="button"
                  className="rh-btn-cancel rh-back-button"
                  onClick={actions.onBack}
                >
                  ← Back to Home
                </button>
              </footer>
            </div>
          </div>
        )}
      </div>
    </>
  );
}