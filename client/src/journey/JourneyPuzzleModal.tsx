import { useEffect, useState } from 'react';
import { Button, Modal } from '../components/primitives';
import type { JourneyPuzzle } from './journeyPuzzles';

type JourneyPuzzleModalProps = {
  open: boolean;
  puzzle: JourneyPuzzle | null;
  reviewMode: boolean;
  onClose: () => void;
  onComplete?: () => void;
};

export function JourneyPuzzleModal({
  open,
  puzzle,
  reviewMode,
  onClose,
  onComplete,
}: JourneyPuzzleModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [solved, setSolved] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setSolved(false);
    }
  }, [open, puzzle?.nodeId]);

  if (!puzzle) return null;

  const handleSelect = (choiceId: string) => {
    if (reviewMode || solved) return;
    setSelectedId(choiceId);
    if (choiceId === puzzle.correctChoiceId) {
      setSolved(true);
    }
  };

  const isCorrect = selectedId === puzzle.correctChoiceId;
  const showFeedback = reviewMode || selectedId != null;

  return (
    <Modal open={open} onClose={onClose} title={puzzle.title} maxWidth={580}>
      <div className="rh-journey-puzzle rh-journey-modal-panel">
        <p className="rh-journey-puzzle__eyebrow">{puzzle.eyebrow}</p>
        <p className="rh-journey-puzzle__scenario">{puzzle.scenario}</p>
        <p className="rh-journey-puzzle__prompt">{puzzle.prompt}</p>

        <div className="rh-journey-puzzle__choices" role="listbox" aria-label="Answer choices">
          {puzzle.choices.map((choice) => {
            const isSelected = selectedId === choice.id;
            const isAnswer = choice.id === puzzle.correctChoiceId;
            const showCorrect = reviewMode ? isAnswer : isSelected && isCorrect;
            const showWrong = !reviewMode && isSelected && !isCorrect;

            return (
              <button
                key={choice.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={reviewMode || solved}
                className={`rh-journey-puzzle__choice${
                  showCorrect ? ' rh-journey-puzzle__choice--correct' : ''
                }${showWrong ? ' rh-journey-puzzle__choice--wrong' : ''}${
                  isSelected ? ' rh-journey-puzzle__choice--selected' : ''
                }`}
                onClick={() => handleSelect(choice.id)}
              >
                {choice.label}
              </button>
            );
          })}
        </div>

        {showFeedback ? (
          <div
            className={`rh-journey-puzzle__feedback${
              reviewMode || isCorrect
                ? ' rh-journey-puzzle__feedback--correct'
                : ' rh-journey-puzzle__feedback--wrong'
            }`}
          >
            <p className="rh-journey-puzzle__feedback-label">
              {reviewMode || isCorrect ? 'Correct read' : 'Not quite'}
            </p>
            <p className="rh-journey-puzzle__feedback-body">{puzzle.explanation}</p>
          </div>
        ) : null}

        <div className="rh-journey-puzzle__reward">
          <span className="rh-journey-puzzle__reward-label">Reward</span>
          <span className="rh-journey-puzzle__reward-value">{puzzle.rewardLabel}</span>
        </div>

        <div className="rh-journey-puzzle__actions">
          {!reviewMode && solved && onComplete ? (
            <Button variant="tier-standard" type="button" onClick={onComplete}>
              Complete Puzzle
            </Button>
          ) : null}
          <Button variant="secondary" type="button" onClick={onClose}>
            {reviewMode ? 'Close' : 'Leave Challenge'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
