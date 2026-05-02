import { useMemo, useState } from 'react';
import { Board, DominoTile, RotateOverlay } from '../components';
import { applyPlayMove, getLegalMoves, type BotMatchState } from '../bot/botEngine';
import type { Move, Tile } from '../types';
import { getPuzzleForSeed } from './getDailyPuzzle';

interface DailyPuzzleScreenProps {
  onBack: () => void;
}

type PuzzleResult = 'solved' | 'failed' | null;

interface DailyPuzzleProgress {
  attempts: number;
  bestMoves: number | null;
  lastResult: PuzzleResult;
}

function tileEquals(a: Tile, b: Tile): boolean {
  return a.high === b.high && a.low === b.low;
}

function storageKey(seed: string): string {
  return `dailyPuzzle:${seed}`;
}

function readProgress(seed: string): DailyPuzzleProgress {
  if (typeof window === 'undefined') {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(seed));
    if (!raw) return { attempts: 0, bestMoves: null, lastResult: null };
    const parsed = JSON.parse(raw) as DailyPuzzleProgress;
    return {
      attempts: Number.isFinite(parsed.attempts) ? parsed.attempts : 0,
      bestMoves: parsed.bestMoves ?? null,
      lastResult: parsed.lastResult ?? null,
    };
  } catch {
    return { attempts: 0, bestMoves: null, lastResult: null };
  }
}

function writeProgress(seed: string, progress: DailyPuzzleProgress) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(seed), JSON.stringify(progress));
}

function createMatchState(puzzleDateSeed: string): {
  puzzle: ReturnType<typeof getPuzzleForSeed>;
  state: BotMatchState;
  progress: DailyPuzzleProgress;
} {
  const puzzle = getPuzzleForSeed(puzzleDateSeed);
  const progress = readProgress(puzzle.dateSeed!);
  const nextProgress: DailyPuzzleProgress = {
    ...progress,
    attempts: progress.attempts + 1,
  };
  writeProgress(puzzle.dateSeed!, nextProgress);

  const state: BotMatchState = {
    players: {
      you: { hand: [...puzzle.playerHand], score: 0 },
      bot: { hand: [], score: 0 },
    },
    board: {
      ...puzzle.initialBoard,
      mainLine: [...puzzle.initialBoard.mainLine],
      hubDoubles: [...puzzle.initialBoard.hubDoubles],
    },
    boneyard: [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',
    consecutivePasses: 0,
    handNumber: 1,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 999,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
  };

  return { puzzle, state, progress: nextProgress };
}

export default function DailyPuzzleScreen({ onBack }: DailyPuzzleScreenProps) {
  const today = useMemo(() => new Date(), []);
  const todaySeed = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const initial = useMemo(() => createMatchState(todaySeed), [todaySeed]);

  const [puzzle] = useState(initial.puzzle);
  const [match, setMatch] = useState<BotMatchState>(initial.state);
  const [attempts, setAttempts] = useState(initial.progress.attempts);
  const [bestMoves, setBestMoves] = useState<number | null>(initial.progress.bestMoves);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [movesUsed, setMovesUsed] = useState(0);
  const [result, setResult] = useState<PuzzleResult>(null);
  const [statusMessage, setStatusMessage] = useState(puzzle.description);

  const legalMoves = useMemo(
    () => getLegalMoves(match, 'you').filter((m) => m.type === 'play'),
    [match],
  );
  const maxMoves = puzzle.objective.maxMoves ?? 99;

  const resetPuzzle = () => {
    const next = createMatchState(todaySeed);
    setMatch(next.state);
    setSelectedTile(null);
    setMovesUsed(0);
    setResult(null);
    setStatusMessage(next.puzzle.description);
    setAttempts(next.progress.attempts);
    setBestMoves(next.progress.bestMoves);
  };

  const finishResult = (nextResult: PuzzleResult, finalMoves: number) => {
    setResult(nextResult);
    if (nextResult === 'solved') {
      const current = readProgress(puzzle.dateSeed!);
      const improvedBest =
        current.bestMoves === null ? finalMoves : Math.min(current.bestMoves, finalMoves);
      const nextProgress: DailyPuzzleProgress = {
        ...current,
        bestMoves: improvedBest,
        lastResult: 'solved',
      };
      writeProgress(puzzle.dateSeed!, nextProgress);
      setBestMoves(improvedBest);
    } else {
      const current = readProgress(puzzle.dateSeed!);
      writeProgress(puzzle.dateSeed!, { ...current, lastResult: 'failed' });
    }
  };

  const onPositionClick = (position: Move['position']) => {
    if (!selectedTile || result) return;
    const move = legalMoves.find(
      (m) => m.position === position && m.tile && tileEquals(m.tile, selectedTile),
    );
    if (!move) return;

    const next = applyPlayMove(match, 'you', move);
    const nextMoves = movesUsed + 1;
    setMovesUsed(nextMoves);
    setSelectedTile(null);
    setMatch(next.state);

    if (next.state.players.you.hand.length === 0) {
      finishResult('solved', nextMoves);
      return;
    }

    // Keep puzzle play using normal turn rules: if turn passes to the opponent,
    // the attempt ends (single-player challenge with no opponent simulation).
    if (next.state.currentPlayer !== 'you') {
      setStatusMessage('Turn ended (move was not scoring/double).');
      finishResult('failed', nextMoves);
      return;
    }

    if (getLegalMoves(next.state, 'you').filter((m) => m.type === 'play').length === 0) {
      setStatusMessage('No legal follow-up move available.');
      finishResult('failed', nextMoves);
      return;
    }

    if (nextMoves >= maxMoves) {
      finishResult('failed', nextMoves);
      return;
    }

    setStatusMessage(puzzle.description);
  };

  return (
    <>
      <RotateOverlay />
      <div className="screen game-screen walnut-live theme-green">
      <div className="wl-top-rail" data-ui="hud">
        <div className="wl-player-pill is-active">
          <div className="wl-pill-top">
            <span className="wl-player-label">Daily Puzzle</span>
          </div>
          <span className="wl-player-score">{movesUsed}</span>
        </div>
        <div className="wl-center-status">
          
          <span className="wl-room-code">
            Attempt {attempts} · Best {bestMoves ?? '--'} · Max {maxMoves}
          </span>
        </div>
        <div className="wl-player-pill is-you">
          <span className="wl-player-label">Date</span>
          <span className="wl-player-score" style={{ fontSize: '1rem' }}>
            {puzzle.dateSeed}
          </span>
        </div>
      </div>

      <div className="wl-stage-shell">
        <div className="board-area wl-board-area" data-ui="board">
          <Board
            board={match.board}
            legalMoves={legalMoves}
            selectedTile={selectedTile}
            onPositionClick={(position) => onPositionClick(position)}
            tileSize={72}
          />
          <div
            style={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 4,
              pointerEvents: 'none',
              color: 'rgba(230,241,236,0.78)',
              fontSize: '0.92rem',
              letterSpacing: '0.02em',
              textAlign: 'center',
              width: 'min(92vw, 820px)',
              textShadow: '0 2px 10px rgba(0,0,0,0.35)',
            }}
          >
            {statusMessage}
          </div>
        </div>
      </div>

      <div className="hand-area wl-hand-area" data-ui="tray">
        <div className="tray-rail">
          <div className="tray-center">
            <div
              className={`hand-container ${match.players.you.hand.length > 7 ? 'is-scrollable' : ''}`}
            >
              {match.players.you.hand.map((tile, idx) => {
                const playable = legalMoves.some((m) => m.tile && tileEquals(m.tile, tile));
                const selected = selectedTile ? tileEquals(selectedTile, tile) : false;
                return (
                  <DominoTile
                    key={`daily-${idx}-${tile.low}-${tile.high}`}
                    tile={tile}
                    size={92}
                    selected={selected}
                    highlight={playable}
                    disabled={Boolean(result) || !playable}
                    onClick={() => {
                      if (result || !playable) return;
                      setSelectedTile(tile);
                    }}
                  />
                );
              })}
            </div>
          </div>
          <div className="tray-right" data-ui="actions">
            <div className="tray-controls">
              <button className="btn text compact" onClick={resetPuzzle}>
                Play Again
              </button>
              <button className="btn text compact" onClick={onBack}>
                Back to Home
              </button>
            </div>
          </div>
        </div>
      </div>

      {result && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1800,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(5,8,14,0.58)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              width: 'min(460px, calc(100vw - 24px))',
              borderRadius: '18px',
              border: '1px solid rgba(236, 252, 245, 0.2)',
              background: 'linear-gradient(170deg, rgba(18, 26, 39, 0.9), rgba(9, 15, 26, 0.96))',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
              padding: '20px',
              color: 'rgba(235,245,242,0.96)',
              display: 'grid',
              gap: '10px',
            }}
          >
            <h3 style={{ margin: 0 }}>{result === 'solved' ? 'Solved' : 'Failed'}</h3>
            <p style={{ margin: 0 }}>
              {result === 'solved'
                ? `Solved in ${movesUsed} moves.`
                : `Move limit reached (${movesUsed}/${maxMoves}).`}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="mode-inline-btn" onClick={onBack}>
                Back to Home
              </button>
              <button className="mode-inline-btn" onClick={resetPuzzle}>
                Play Again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
