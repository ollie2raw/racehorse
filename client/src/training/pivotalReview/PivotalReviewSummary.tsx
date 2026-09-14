import { useMemo } from 'react';
import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import type { HandAnalysis } from '../../analyzer/analysisTypes';
import type { PostGameReviewAccent } from './PostGameReviewPrompt';
import { HandTimeline } from './HandTimeline';
import {
  computeTopRecurringMissReason,
  formatPivotalLessonLine,
  type PivotalReviewSession,
} from './pivotalReviewStorage';
import type { PivotalTurnCandidate } from './pivotalTurnSelector';
import '../../styles/dossierRecord.css';
import './pivotalReviewSummary.css';
import './postGameReviewPrompt.css';

export type PivotalReviewSummaryProps = {
  open: boolean;
  accent?: PostGameReviewAccent;
  session: PivotalReviewSession;
  candidates: PivotalTurnCandidate[];
  hands: HandAnalysis[];
  worstHandNumber: number | null;
  opponentLabel: string;
  onSaveAndClose: () => void;
  onSelectHand: (handNumber: number) => void;
};

export function PivotalReviewSummary({
  open,
  accent = 'gold',
  session,
  candidates,
  hands,
  worstHandNumber,
  opponentLabel,
  onSaveAndClose,
  onSelectHand,
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

  const accentClass = accent === 'blue' ? ' dfd--blue' : '';

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay prs-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Review summary"
      >
        <div className={`dfd${accentClass}`} onClick={(event) => event.stopPropagation()}>
          <div className="dfd__body prs-dossier-body">
            <header>
              <span className="dfd__eyebrow">Post-game review</span>
              <h2 className="dfd__headline">Today&apos;s {lessons.length} lessons</h2>
              <p className="dfd__sub">
                {session.accuracy.toFixed(1)}% accuracy · final {session.youScore}–{session.opponentScore}
              </p>
            </header>

            <div className="prs-scroll">
              <ol className="dfd__games prs-lessons" aria-label="Pivotal turn lessons">
                {lessons.map((lesson, index) => (
                  <li key={`${session.id}-lesson-${index}`} className="dfd__game prs-lesson">
                    <span className="dfd__game-no">L{index + 1}</span>
                    <span className="dfd__track dfd__track--win" />
                    <span className="prs-lesson-copy">{lesson}</span>
                  </li>
                ))}
              </ol>

              {recurringPattern ? (
                <div className="dfd__meta" aria-label="Recurring miss pattern">
                  <span className="dfd__meta-label">Your recurring pattern this week</span>
                  <p className="dfd__note" style={{ marginTop: 4 }}>
                    → &ldquo;{recurringPattern.label}&rdquo;{' '}
                    <span className="dfd__tag">({recurringPattern.count}×)</span>
                  </p>
                </div>
              ) : null}

              <HandTimeline
                hands={hands}
                worstHandNumber={worstHandNumber}
                opponentLabel={opponentLabel}
                onSelectHand={onSelectHand}
              />
            </div>

            <div className="dfd__actions">
              <button type="button" className="dfd__btn dfd__btn--primary" onClick={onSaveAndClose}>
                Save &amp; Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}
