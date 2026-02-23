import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Board, DominoTile } from '../components';
import type { Move, PlacedTile, Tile, BoardState } from '../types';
import {
  applyPlayMove,
  getDisplayOpenEnds,
  getLegalMoves,
  type BotMatchState,
} from '../bot/botEngine';
import { submitPuzzleResult, type DailyPuzzle } from './puzzleApi';

interface DailyPuzzlePlayProps {
  puzzle: DailyPuzzle;
  user: User | null;
  onBack: () => void;
  onSubmitted: () => void;
}

type PuzzleStatus = 'playing' | 'solved' | 'failed' | 'gave_up';

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function boardFromPlacedTiles(tiles: PlacedTile[]): BoardState | null {
  if (tiles.length === 0) return null;
  const first = tiles[0];
  const last = tiles[tiles.length - 1];

  const firstLeft =
    first.orientation === 'horizontal-flipped' || first.orientation === 'vertical-flipped'
      ? first.tile.high
      : first.tile.low;
  const lastRight =
    last.orientation === 'horizontal-flipped' || last.orientation === 'vertical-flipped'
      ? last.tile.low
      : last.tile.high;

  return {
    mainLine: tiles,
    leftEnd: firstLeft,
    rightEnd: lastRight,
    leftEndIsDouble: first.tile.low === first.tile.high,
    rightEndIsDouble: last.tile.low === last.tile.high,
    hubDoubles: tiles
      .map((pt, idx) => ({ pt, idx }))
      .filter(({ pt }) => pt.tile.low === pt.tile.high)
      .map(({ pt, idx }) => ({
        hubId: idx,
        laneType: 'mainline' as const,
        laneRef: 'mainline',
        tileIndex: idx,
        mainlineIndex: idx,
        hubValue: pt.tile.high,
        leftSideFilled: false,
        rightSideFilled: false,
        isCrossed: false,
        branches: [],
      })),
  };
}

function initialPuzzleState(puzzle: DailyPuzzle): BotMatchState {
  const configBoard = puzzle.config.startingBoard;
  const board = Array.isArray(configBoard)
    ? boardFromPlacedTiles(configBoard as PlacedTile[])
    : (configBoard as BoardState | null);

  return {
    players: {
      you: { hand: [...puzzle.config.startingHand], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board,
    boneyard: [],
    deadTiles: [],
    handOpen: Boolean(board),
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: puzzle.config.startingHand.length >= 14 ? 14 : 7,
  };
}

function objectiveText(puzzle: DailyPuzzle): string {
  const obj = puzzle.config.objective;
  if (obj.type === 'finish_in_moves') {
    return `Play all tiles in ${obj.maxMoves} moves or fewer.`;
  }
  return 'Play all tiles to complete the puzzle hand.';
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function DailyPuzzlePlay({
  puzzle,
  user,
  onBack,
  onSubmitted,
}: DailyPuzzlePlayProps) {
  const [match, setMatch] = useState<BotMatchState>(() => initialPuzzleState(puzzle));
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [status, setStatus] = useState<PuzzleStatus>('playing');
  const [message, setMessage] = useState<string>(objectiveText(puzzle));
  const [moves, setMoves] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const startedAtRef = useRef<number>(Date.now());
  const submittedRef = useRef(false);

  const legalMoves = useMemo(
    () => getLegalMoves(match, 'you').filter((m) => m.type === 'play'),
    [match],
  );
  const playableTileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const move of legalMoves) {
      if (!move.tile) continue;
      ids.add(`${move.tile.low}-${move.tile.high}`);
    }
    return ids;
  }, [legalMoves]);

  useEffect(() => {
    if (status !== 'playing') return;
    const timer = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 120);
    return () => clearInterval(timer);
  }, [status]);

  const submitResult = async (solved: boolean, finalMoves: number, finalMs: number) => {
    if (!user || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitState('submitting');
    const res = await submitPuzzleResult(puzzle.id, user, {
      solved,
      moves: finalMoves,
      milliseconds: finalMs,
      attemptHash: `${puzzle.id}:${user.id}:${finalMoves}:${finalMs}:${solved ? 1 : 0}`,
    });
    if (res.error) {
      setSubmitState('error');
      setSubmitError(res.error);
      return;
    }
    setSubmitState('done');
    setSubmitError(null);
    onSubmitted();
  };

  const finalizeIfNeeded = async (nextState: BotMatchState, nextMoves: number) => {
    const finalMs = Date.now() - startedAtRef.current;

    if (nextState.players.you.hand.length === 0) {
      const obj = puzzle.config.objective;
      const solved = obj.type === 'finish_in_moves' ? nextMoves <= obj.maxMoves : true;
      setStatus(solved ? 'solved' : 'failed');
      setMessage(
        solved
          ? `Solved in ${nextMoves} moves (${formatDuration(finalMs)}).`
          : `Hand cleared, but move limit exceeded (${nextMoves} moves).`,
      );
      await submitResult(solved, nextMoves, finalMs);
      return true;
    }

    if (nextState.currentPlayer !== 'you') {
      setStatus('failed');
      setMessage('Turn ended before you could clear the hand.');
      await submitResult(false, nextMoves, finalMs);
      return true;
    }

    const nextLegal = getLegalMoves(nextState, 'you').filter((m) => m.type === 'play');
    if (nextLegal.length === 0) {
      setStatus('failed');
      setMessage('No legal move available. Try again.');
      await submitResult(false, nextMoves, finalMs);
      return true;
    }

    return false;
  };

  const onPositionClick = async (position: Move['position']) => {
    if (!selectedTile || status !== 'playing') return;
    const move = legalMoves.find(
      (m) => m.position === position && m.tile && tileEquals(m.tile, selectedTile),
    );
    if (!move) return;

    const result = applyPlayMove(match, 'you', move);
    const nextMoves = moves + 1;
    setMoves(nextMoves);
    setMatch(result.state);
    setSelectedTile(null);

    const finished = await finalizeIfNeeded(result.state, nextMoves);
    if (!finished) {
      setMessage(objectiveText(puzzle));
    }
  };

  const giveUp = async () => {
    if (status !== 'playing') return;
    const finalMs = Date.now() - startedAtRef.current;
    setStatus('gave_up');
    setMessage('You gave up this attempt.');
    await submitResult(false, moves, finalMs);
  };

  const restart = () => {
    setMatch(initialPuzzleState(puzzle));
    setSelectedTile(null);
    setStatus('playing');
    setMessage(objectiveText(puzzle));
    setMoves(0);
    setElapsedMs(0);
    setSubmitState('idle');
    setSubmitError(null);
    startedAtRef.current = Date.now();
    submittedRef.current = false;
  };

  return (
    <div className="screen game-screen walnut-live daily-puzzle-play-screen">
      <div className="wl-top-rail" data-ui="hud">
        <div className="wl-player-pill is-active">
          <div className="wl-pill-top">
            <span className="wl-player-label">Daily Puzzle</span>
          </div>
          <span className="wl-player-score">{moves}</span>
        </div>
        <div className="wl-center-status">
          <span className="wl-turn-label your-turn">Your move</span>
          <span className="wl-room-code">{objectiveText(puzzle)}</span>
        </div>
        <div className="wl-player-pill is-you">
          <span className="wl-player-label">Time</span>
          <span className="wl-player-score">{formatDuration(elapsedMs)}</span>
        </div>
      </div>

      <div className="wl-stage-shell">
        <div className="board-area wl-board-area" data-ui="board">
          <Board
            board={match.board}
            legalMoves={legalMoves}
            selectedTile={selectedTile}
            onPositionClick={(position) => {
              void onPositionClick(position);
            }}
            tileSize={72}
          />
        </div>
      </div>

      <div className="hand-area wl-hand-area" data-ui="tray">
        <div className="tray-rail">
          <div className="tray-center">
            <div
              className={`hand-container ${match.players.you.hand.length > 9 ? 'is-scrollable' : ''}`}
            >
              {match.players.you.hand.map((tile, idx) => {
                const keyId = `${tile.low}-${tile.high}`;
                const playable = playableTileIds.has(keyId);
                return (
                  <DominoTile
                    key={`puzzle-hand-${idx}-${keyId}`}
                    tile={tile}
                    size={90}
                    selected={Boolean(selectedTile && tileEquals(selectedTile, tile))}
                    highlight={playable}
                    disabled={status !== 'playing' || !playable}
                    onClick={() => {
                      if (status !== 'playing' || !playable) return;
                      setSelectedTile(tile);
                    }}
                  />
                );
              })}
            </div>
          </div>
          <div className="tray-right" data-ui="actions">
            <div className="tray-controls">
              <button
                className="btn text compact"
                onClick={() => {
                  void giveUp();
                }}
                disabled={status !== 'playing'}
              >
                Give Up
              </button>
              <button className="btn text compact" onClick={restart}>
                Retry
              </button>
              <button className="btn text compact" onClick={onBack}>
                Back
              </button>
            </div>
          </div>
        </div>
      </div>

      {(status !== 'playing' ||
        submitState === 'submitting' ||
        submitState === 'error' ||
        submitState === 'done') && (
        <div className="daily-puzzle-status-panel">
          <h3>
            {status === 'solved'
              ? 'Solved'
              : status === 'failed'
                ? 'Attempt Ended'
                : status === 'gave_up'
                  ? 'Gave Up'
                  : 'In Progress'}
          </h3>
          <p>{message}</p>
          <p>
            Moves: {moves} · Time: {formatDuration(elapsedMs)}
          </p>
          {!user && <p>Sign in to submit results.</p>}
          {submitState === 'submitting' && <p>Submitting result...</p>}
          {submitState === 'done' && user && <p>Result submitted.</p>}
          {submitState === 'error' && (
            <p className="auth-inline-error">{submitError ?? 'Submission failed.'}</p>
          )}
          <p className="daily-open-ends-note">
            Open ends: {getDisplayOpenEnds(match).join(', ') || 'none'}
          </p>
        </div>
      )}
    </div>
  );
}
