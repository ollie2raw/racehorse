import { useState } from 'react';
import { Board, DominoTile } from '../components';
import { Button, Modal } from '../components/primitives';
import type { JourneyPuzzle, JourneyPuzzleTile } from './journeyPuzzles';
import { puzzleToBoardState } from './puzzleBoardAdapter';

type InteractivePuzzleModalProps = {
  open: boolean;
  puzzle: JourneyPuzzle;
  reviewMode?: boolean;
  onClose: () => void;
  onComplete?: () => void;
};

function tilesMatch(a: JourneyPuzzleTile, b: JourneyPuzzleTile): boolean {
  return (
    (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high)
  );
}

export function InteractivePuzzleModal({
  open,
  puzzle,
  reviewMode = false,
  onClose,
  onComplete,
}: InteractivePuzzleModalProps) {
  const [selectedTile, setSelectedTile] = useState<JourneyPuzzleTile | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [result, setResult] = useState<'none' | 'correct' | 'wrong'>('none');
  const [revealed, setRevealed] = useState(false);

  const puzzleKey = open ? puzzle.nodeId : '';
  const [trackedPuzzleKey, setTrackedPuzzleKey] = useState(puzzleKey);
  if (puzzleKey !== trackedPuzzleKey) {
    setTrackedPuzzleKey(puzzleKey);
    setSelectedTile(null);
    setAttempts(0);
    setResult('none');
    setRevealed(false);
  }

  const displayReviewMode = open && reviewMode;
  const displayRevealed = displayReviewMode || revealed;
  const displayResult = displayReviewMode ? 'correct' : result;
  const correctTile = puzzle.correctTile;
  const playerHand = puzzle.playerHand ?? [];
  const boardState = puzzle.boardState;

  const handleTileClick = (tile: JourneyPuzzleTile) => {
    if (displayReviewMode || displayResult === 'correct' || !correctTile) return;

    setSelectedTile(tile);

    if (tilesMatch(tile, correctTile)) {
      setResult('correct');
      return;
    }

    setResult('wrong');
    setAttempts((prev) => prev + 1);
  };

  const handleReveal = () => {
    setRevealed(true);
    setResult('correct');
    if (correctTile) {
      setSelectedTile(correctTile);
    }
  };

  const isSelected = (tile: JourneyPuzzleTile) =>
    selectedTile != null && tilesMatch(tile, selectedTile);

  const isCorrectTile = (tile: JourneyPuzzleTile) =>
    correctTile != null && tilesMatch(tile, correctTile);

  const showFeedback = displayReviewMode || displayResult !== 'none' || displayRevealed;
  const showContinue = !displayReviewMode && displayResult === 'correct' && onComplete != null;
  const showRevealButton = !displayReviewMode && displayResult === 'wrong' && attempts >= 2 && !displayRevealed;

  const isSolved = displayReviewMode || displayResult === 'correct';

  return (
    <Modal open={open} onClose={onClose} title={puzzle.title} maxWidth={580}>
      <div
        className={`rh-journey-modal-panel ipm-root${isSolved ? ' ipm-root--solved' : ''}`}
      >
        <p className="ipm-eyebrow">{puzzle.eyebrow}</p>
        {!showFeedback ? <p className="ipm-scenario">{puzzle.scenario}</p> : null}

        {boardState ? (
          <div className="ipm-board-frame">
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
            <div className="ipm-ends">
              <span className="ipm-end ipm-end--left">{boardState.ends[0]}</span>
              <span className="ipm-end-label">open ends</span>
              <span className="ipm-end ipm-end--right">{boardState.ends[1]}</span>
            </div>
          </div>
        ) : null}

        {!isSolved ? <p className="ipm-prompt">Choose your play:</p> : null}

        <div className="ipm-hand">
          {playerHand.map((tile) => {
            const selected = isSelected(tile);
            const showRevealRing = displayRevealed && isCorrectTile(tile);
            const tileResult =
              selected && displayResult === 'correct'
                ? 'correct'
                : selected && displayResult === 'wrong'
                  ? 'wrong'
                  : '';

            return (
              <button
                key={`${tile.high}-${tile.low}`}
                type="button"
                className={[
                  'ipm-tile-btn',
                  selected ? 'ipm-tile-btn--selected' : '',
                  tileResult,
                  showRevealRing ? 'ipm-tile-btn--reveal' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => handleTileClick(tile)}
                disabled={displayReviewMode || displayResult === 'correct'}
              >
                <DominoTile tile={tile} size={48} selected={selected} flipped />
                <span className="ipm-tile-label">
                  {tile.high}–{tile.low}
                </span>
              </button>
            );
          })}
        </div>

        {showFeedback ? (
          <div
            className={`ipm-feedback${
              displayReviewMode || displayResult === 'correct'
                ? ' ipm-feedback--correct'
                : ' ipm-feedback--wrong'
            }`}
          >
            {displayReviewMode || displayResult === 'correct' ? (
              <>
                <p className="ipm-feedback-label">Correct read</p>
                <p className="ipm-feedback-body">{puzzle.explanation}</p>
              </>
            ) : (
              <>
                <p className="ipm-feedback-label">Not the best line — try again</p>
                {showRevealButton ? (
                  <Button variant="secondary" type="button" onClick={handleReveal}>
                    Reveal Answer
                  </Button>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {!showFeedback ? (
          <div className="ipm-reward">
            <span className="ipm-reward-label">Reward</span>
            <span className="ipm-reward-value">{puzzle.rewardLabel}</span>
          </div>
        ) : null}

        <div className="ipm-actions">
          {showContinue ? (
            <Button variant="tier-standard" type="button" onClick={onComplete}>
              Continue
            </Button>
          ) : null}
          <Button variant="secondary" type="button" onClick={onClose}>
            {displayReviewMode ? 'Close' : showContinue ? 'Leave' : 'Leave Challenge'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
