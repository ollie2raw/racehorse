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

function splitCoachingCopy(text: string): { title: string; body: string[]; callout: string | null } {
  let callout: string | null = null;
  let remainingText = text.trim();

  const playMatch = remainingText.match(/(Play:?\s*.*|Start with\s*\d-\d.*)$/im);
  if (playMatch) {
    callout = playMatch[1].trim();
    remainingText = remainingText.substring(0, playMatch.index).trim();
  }

  if (!remainingText) return { title: '', body: [], callout };

  const paragraphs = remainingText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  if (paragraphs.length === 0) {
    return { title: '', body: [], callout };
  }

  const firstParagraph = paragraphs[0];
  const firstSentenceMatch = firstParagraph.match(/^(.+?[.!?])(\s+|$)(.*)$/s);

  let title = firstParagraph;
  const body: string[] = [];

  if (firstSentenceMatch) {
    title = firstSentenceMatch[1].trim();
    const restOfFirst = firstSentenceMatch[3].trim();
    if (restOfFirst) {
      body.push(restOfFirst);
    }
  }

  for (let i = 1; i < paragraphs.length; i++) {
    body.push(paragraphs[i]);
  }

  return { title, body, callout };
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
  const { title, body, callout } = splitCoachingCopy(coachingText);
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
      </div>

      <div className="lesson-coach-scroll-area">
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
            {body.length > 0 ? (
              <div className="lesson-coach-body-paragraphs">
                {body.map((p, i) => (
                  <p key={i} className="lesson-coach-copy">{p}</p>
                ))}
              </div>
            ) : null}
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

      {!isOffAuthoredLine && callout && (
        <div className="lesson-coach-callout">
          <span className="lesson-coach-callout-label">BEST MOVE</span>
          <span className="lesson-coach-callout-text">{callout}</span>
        </div>
      )}

      {!isOffAuthoredLine && (
        <div className="lesson-coach-actions">
          <button
            onClick={onBestMove}
            disabled={!canBestMove}
            className="lesson-coach-bestmove-btn"
          >
            Show Best Move →
          </button>
        </div>
      )}
    </div>
  );
}
