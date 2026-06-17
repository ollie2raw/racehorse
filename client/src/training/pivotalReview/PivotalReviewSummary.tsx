import { useMemo } from 'react';
import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { PostGameReviewAccent } from './PostGameReviewPrompt';
import {
  computeTopRecurringMissReason,
  formatPivotalLessonLine,
  type PivotalReviewSession,
} from './pivotalReviewStorage';
import type { PivotalTurnCandidate } from './pivotalTurnSelector';
import './pivotalReviewSummary.css';

export type PivotalReviewSummaryProps = {
  open: boolean;
  accent?: PostGameReviewAccent;
  session: PivotalReviewSession;
  candidates: PivotalTurnCandidate[];
  onSaveAndClose: () => void;
  onFullGameReview?: () => void;
};

export function PivotalReviewSummary({
  open,
  accent = 'gold',
  session,
  candidates,
  onSaveAndClose,
  onFullGameReview,
}: PivotalReviewSummaryProps) {
  const lessons = useMemo(() => {
    const candidateByMove = new Map(candidates.map((candidate) => [candidate.moveNumber, candidate]));
    return session.reflections.map((reflection) => {
      const candidate = candidateByMove.get(reflection.moveNumber);
      return formatPivotalLessonLine(
        reflection,
        candidate?.move.rating,
        candidate?.move.action,
      );
    });
  }, [candidates, session.reflections]);

  const recurringPattern = useMemo(
    () => computeTopRecurringMissReason(session),
    [session],
  );

  if (!open) return null;

  const cardAccentClass = accent === 'blue' ? ' prs-card--blue' : '';

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay prs-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Review summary"
      >
        <div
          className={`game-over-card df-result-card prs-card${cardAccentClass}`}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="prs-panel">
            <header>
              <p className="df-result-eyebrow">Post-Game Review</p>
              <h2 className="prs-title">Today&apos;s {lessons.length} lessons</h2>
              <p className="prs-subtitle">
                {session.accuracy.toFixed(1)}% accuracy · final {session.youScore}–{session.opponentScore}
              </p>
            </header>

            <ol className="prs-lessons" aria-label="Pivotal turn lessons">
              {lessons.map((lesson, index) => (
                <li key={`${session.id}-lesson-${index}`} className="prs-lesson">
                  <span className="prs-lesson-index">Lesson {index + 1}</span>
                  <p className="prs-lesson-copy">{lesson}</p>
                </li>
              ))}
            </ol>

            {recurringPattern ? (
              <div className="prs-pattern" aria-label="Recurring miss pattern">
                <span className="prs-pattern-label">Your recurring pattern this week</span>
                <p className="prs-pattern-value">
                  → &ldquo;{recurringPattern.label}&rdquo;{' '}
                  <span className="prs-pattern-count">({recurringPattern.count} times)</span>
                </p>
              </div>
            ) : null}

            <div className="prs-actions">
              <button type="button" className="df-result-primary" onClick={onSaveAndClose}>
                Save &amp; Close
              </button>
              {onFullGameReview ? (
                <button type="button" className="prs-full-review-link" onClick={onFullGameReview}>
                  Review Full Game
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
