import { useEffect, useRef, useState } from 'react';
import { Board, DominoTile } from '../components';
import { Button, Modal } from '../components/primitives';
import { useRushClock } from '../puzzleRush/useRushClock';
import type { JourneyPuzzle, JourneyPuzzleTile } from './journeyPuzzles';
import { puzzleToBoardState } from './puzzleBoardAdapter';
import './PuzzleSprintModal.css';

/** Delay between an answer landing and the sprint auto-advancing to the next puzzle. */
const ADVANCE_DELAY_MS = 900;

export type PuzzleSprintResult = {
  correct: number;
  total: number;
  timedOut: boolean;
};

export type PuzzleSprintModalProps = {
  open: boolean;
  /** Interactive-board puzzles (boardState + playerHand + correctTile) — the same shape InteractivePuzzleModal renders. */
  puzzles: JourneyPuzzle[];
  timeLimitSec: number;
  title?: string;
  /** Fires once, when every puzzle is answered or the clock runs out. */
  onComplete: (result: PuzzleSprintResult) => void;
  /** Fires if the player leaves before the sprint finishes. onComplete does not also fire. */
  onExit: () => void;
};

function tilesMatch(a: JourneyPuzzleTile, b: JourneyPuzzleTile): boolean {
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
}

function formatClock(secondsLeft: number): string {
  const whole = Math.max(0, Math.ceil(secondsLeft));
  const mm = Math.floor(whole / 60);
  const ss = whole % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}

export function PuzzleSprintModal({
  open,
  puzzles,
  timeLimitSec,
  title = 'Puzzle Sprint',
  onComplete,
  onExit,
}: PuzzleSprintModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [selectedTile, setSelectedTile] = useState<JourneyPuzzleTile | null>(null);
  const [result, setResult] = useState<'none' | 'correct' | 'wrong'>('none');

  const currentIndexRef = useRef(currentIndex);
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers (the advance timer); moving the write to an effect would defer it past paint
  currentIndexRef.current = currentIndex;
  const correctCountRef = useRef(correctCount);
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers (finish()); moving the write to an effect would defer it past paint
  correctCountRef.current = correctCount;
  const finishedRef = useRef(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = (timedOut: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    clock.stop();
    onComplete({ correct: correctCountRef.current, total: puzzles.length, timedOut });
  };

  const clock = useRushClock({
    baseSeconds: timeLimitSec,
    maxSeconds: timeLimitSec,
    onExpire: () => finish(true),
  });
  const clockRef = useRef(clock);
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value so the open-transition effect below can call clock.start() without depending on the whole (every-tick-changing) clock object
  clockRef.current = clock;

  // Reset internal progress and start the clock whenever the sprint transitions
  // to open — a side effect (starting a timer), so it belongs in an effect, not
  // the render-phase state-adjustment pattern InteractivePuzzleModal uses for
  // its (purely local, timer-free) puzzleKey reset.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setCurrentIndex(0);
      setCorrectCount(0);
      setSelectedTile(null);
      setResult('none');
      finishedRef.current = false;
      clockRef.current.start();
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
  }, []);

  if (!open || puzzles.length === 0) return null;

  const puzzle = puzzles[currentIndex];
  const correctTile = puzzle.correctTile;
  const playerHand = puzzle.playerHand ?? [];
  const boardState = puzzle.boardState;

  const handleTileClick = (tile: JourneyPuzzleTile) => {
    if (result !== 'none' || !correctTile) return;
    setSelectedTile(tile);
    const isCorrect = tilesMatch(tile, correctTile);
    setResult(isCorrect ? 'correct' : 'wrong');
    if (isCorrect) setCorrectCount((prev) => prev + 1);

    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      const nextIndex = currentIndexRef.current + 1;
      if (nextIndex >= puzzles.length) {
        finish(false);
        return;
      }
      setCurrentIndex(nextIndex);
      setSelectedTile(null);
      setResult('none');
    }, ADVANCE_DELAY_MS);
  };

  const handleExit = () => {
    finishedRef.current = true;
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    clock.stop();
    onExit();
  };

  const isSelected = (tile: JourneyPuzzleTile) =>
    selectedTile != null && tilesMatch(tile, selectedTile);

  return (
    <Modal open={open} onClose={handleExit} title={title} maxWidth={580}>
      <div className="rh-journey-modal-panel rh-puzzle-sprint">
        <div className="rh-puzzle-sprint__hud">
          <span className="rh-puzzle-sprint__progress">
            Puzzle {currentIndex + 1} of {puzzles.length}
          </span>
          <span className="rh-puzzle-sprint__clock" data-ui="puzzle-sprint-clock">
            {formatClock(clock.secondsLeft)}
          </span>
        </div>

        <p className="rh-puzzle-sprint__eyebrow">{puzzle.eyebrow}</p>
        <h3 className="rh-puzzle-sprint__title">{puzzle.title}</h3>
        {result === 'none' ? <p className="rh-puzzle-sprint__scenario">{puzzle.scenario}</p> : null}

        {boardState ? (
          <div className="rh-puzzle-sprint__board-frame">
            <Board
              board={puzzleToBoardState(boardState.placedTiles, boardState.ends)}
              legalMoves={[]}
              selectedTile={null}
              onPositionClick={() => {}}
              staticView
              staticFitMainline
              staticSpineAnchor={0.5}
              tileSize={46}
            />
          </div>
        ) : null}

        {result === 'none' ? <p className="rh-puzzle-sprint__prompt">Choose your play:</p> : null}

        <div className="rh-puzzle-sprint__hand">
          {playerHand.map((tile) => {
            const selected = isSelected(tile);
            const tileResult =
              selected && result === 'correct'
                ? 'rh-puzzle-sprint__tile-btn--correct'
                : selected && result === 'wrong'
                  ? 'rh-puzzle-sprint__tile-btn--wrong'
                  : '';

            return (
              <button
                key={`${tile.high}-${tile.low}`}
                type="button"
                aria-label={`Play ${tile.high}-${tile.low}`}
                className={['rh-puzzle-sprint__tile-btn', tileResult].filter(Boolean).join(' ')}
                onClick={() => handleTileClick(tile)}
                disabled={result !== 'none'}
              >
                <DominoTile tile={tile} size={48} selected={selected} flipped />
              </button>
            );
          })}
        </div>

        {result !== 'none' ? (
          <div
            className={`rh-puzzle-sprint__feedback${
              result === 'correct' ? ' rh-puzzle-sprint__feedback--correct' : ' rh-puzzle-sprint__feedback--wrong'
            }`}
          >
            {result === 'correct' ? 'Correct read' : 'Not the best line'}
          </div>
        ) : null}

        <div className="rh-puzzle-sprint__actions">
          <Button variant="secondary" type="button" onClick={handleExit}>
            Leave Sprint
          </Button>
        </div>
      </div>
    </Modal>
  );
}
