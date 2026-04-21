/**
 * learn/LessonCoachPanel.tsx
 *
 * Coach panel shown during Guided Lesson playback (player-facing).
 * Reads the authored coaching note for the current player turn and
 * provides a "Best Move →" button that auto-plays the authored move.
 */

interface LessonCoachPanelProps {
  /** 0-based index of the current player turn */
  stepIndex: number;
  /** Total authored steps in the lesson */
  totalSteps: number;
  /** Coaching note for the current step (may be empty string) */
  coachingText: string;
  /** Called when the player clicks "Best Move →" */
  onBestMove: () => void;
  /** Whether auto-play is available (false when no authored move exists or board is over) */
  canBestMove: boolean;
  /** Whether the player has deviated from the authored line */
  isOffAuthoredLine?: boolean;
}

function splitCoachingCopy(text: string): { title: string; body: string } {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return { title: '', body: '' };
  const firstSentenceMatch = normalized.match(/^(.+?[.!?])(\s+|$)(.*)$/);
  if (!firstSentenceMatch) {
    return { title: normalized, body: '' };
  }
  const title = firstSentenceMatch[1].trim();
  const body = firstSentenceMatch[3].trim();
  return { title, body };
}

function deriveCoachChips(text: string): string[] {
  const normalized = text.toLowerCase();
  const chips: string[] = [];
  const scoreMatch = normalized.match(/score(?:s|ing)?\s+(\d+)/);
  if (scoreMatch) chips.push(`Scores ${scoreMatch[1]}`);
  if (normalized.includes('keep my turn') || normalized.includes('keep our turn') || normalized.includes('turn continues')) {
    chips.push('Keeps turn');
  }
  if (normalized.includes('draw')) chips.push('Sets up draw');
  if (normalized.includes('go out')) chips.push('Threatens go out');
  if (normalized.includes('double')) chips.push('Double pressure');
  if (normalized.includes('tight') || normalized.includes('limit')) chips.push('Board control');
  return Array.from(new Set(chips)).slice(0, 4);
}

export default function LessonCoachPanel({
  stepIndex,
  totalSteps,
  coachingText,
  onBestMove,
  canBestMove,
  isOffAuthoredLine = false,
}: LessonCoachPanelProps) {
  const { title, body } = splitCoachingCopy(coachingText);
  const chips = deriveCoachChips(coachingText);
  return (
    <div className="coach-panel lesson-coach-panel">
      <div className="coach-panel-header lesson-coach-panel-header">
        <div className="lesson-coach-meta">
          <span className="coach-label lesson-coach-label">Coach Oliver</span>
          {!isOffAuthoredLine && totalSteps > 0 && (
            <span className="lesson-coach-turn-chip">
              Turn {stepIndex + 1}{totalSteps > 0 ? ` / ${totalSteps}` : ''}
            </span>
          )}
        </div>
        <button
          onClick={onBestMove}
          disabled={!canBestMove}
          className="lesson-coach-bestmove-btn"
        >
          Show Best Move →
        </button>
      </div>

      {isOffAuthoredLine ? (
        <div className="lesson-coach-copy-wrap">
          <p className="lesson-coach-offline-title">Offline fallback active</p>
          <p className="lesson-coach-offline-copy">
            You went off the authored line, so this hand will continue live from here.
          </p>
        </div>
      ) : coachingText ? (
        <div className="lesson-coach-copy-wrap">
          <p className="lesson-coach-title">{title || coachingText}</p>
          {body ? <p className="lesson-coach-copy">{body}</p> : null}
          {chips.length > 0 ? (
            <div className="lesson-coach-chips">
              {chips.map((chip) => (
                <span key={chip} className="lesson-coach-chip">{chip}</span>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="lesson-coach-empty">No coaching note for this turn.</p>
      )}
    </div>
  );
}
