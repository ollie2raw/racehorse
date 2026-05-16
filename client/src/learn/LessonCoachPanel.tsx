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
  /** Whether the recommendation details are currently visible */
  showRecommendation?: boolean;
  /** Toggle recommendation visibility */
  onToggleRecommendation?: () => void;
}

function splitCoachingCopy(text: string): { title: string; body: string[]; callout: string | null } {
  const callout: string | null = null;
  const remainingText = text.trim();

  if (!remainingText) return { title: '', body: [], callout };

  const paragraphs = remainingText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  if (paragraphs.length === 0) {
    return { title: '', body: [], callout };
  }

  const firstParagraph = paragraphs[0];
  let title = firstParagraph;
  const body: string[] = [];
  body.push(firstParagraph);

  for (let i = 1; i < paragraphs.length; i++) {
    body.push(paragraphs[i]);
  }

  return { title, body, callout };
}

function getCoachCopyDensity(body: string[], callout: string | null): 'short' | 'medium' | 'long' {
  const combined = [...body, callout ?? ''].join(' ').trim();
  const charCount = combined.length;
  const paragraphCount = body.length + (callout ? 1 : 0);

  if (charCount <= 140 && paragraphCount <= 2) return 'short';
  if (charCount >= 280 || paragraphCount >= 4) return 'long';
  return 'medium';
}

export default function LessonCoachPanel({
  stepIndex,
  totalSteps,
  coachingText,
  onBestMove,
  canBestMove,
  isOffAuthoredLine = false,
  showRecommendation = true,
  onToggleRecommendation,
}: LessonCoachPanelProps) {
  const { body, callout } = splitCoachingCopy(coachingText);
  const copyDensityClass = `is-${getCoachCopyDensity(
    body.length > 0 ? body : [coachingText || 'No coaching note for this turn.'],
    callout,
  )}`;
  const progressPct = totalSteps > 0 ? ((stepIndex + 1) / totalSteps) * 100 : 0;
  const progressLabel = `${stepIndex + 1} / ${totalSteps}`;

  return (
    <section className="learn-coach-panel pvf-opponent-card" aria-label="Your coach">
      <div className="learn-coach-panel__opponent-bg" aria-hidden="true" />
      <div className="pvf-card-overlay learn-coach-panel__opponent-overlay" aria-hidden="true" />
      <div className="pvf-card-content learn-coach-panel__card-content">
        <div className="learn-coach-panel__middle">
        {isOffAuthoredLine ? (
          <div className={`learn-coach-panel__copy ${copyDensityClass}`}>
            <p>You went off the authored line, so this hand will continue live from here.</p>
          </div>
        ) : !showRecommendation ? (
          <div className={`learn-coach-panel__copy ${copyDensityClass}`}>
            <p>Reveal the coach panel below when you want the lesson explanation and suggested move.</p>
          </div>
        ) : (
          <div className={`learn-coach-panel__copy ${copyDensityClass}`}>
            {body.length > 0 ? (
              body.map((p, i) => <p key={i}>{p}</p>)
            ) : (
              <p>{coachingText || 'No coaching note for this turn.'}</p>
            )}
            {callout ? <p className="learn-coach-panel__callout-inline">{callout}</p> : null}
          </div>
        )}
        </div>

        {!isOffAuthoredLine ? (
          <div className="learn-coach-panel__bottom">
            <div className="rh-progress learn-coach-panel__progress">
              <div className="rh-progress__head">
                <span>LESSON PROGRESS</span>
                <strong>{progressLabel}</strong>
              </div>
              <div className="rh-progress__rail">
                <div className="rh-progress__fill" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            <button
              type="button"
              className="pvf-start-btn learn-coach-panel__bestmove"
              disabled={!canBestMove}
              onClick={onBestMove}
              style={{
                background:
                  'linear-gradient(180deg, var(--tier-elite) 0%, color-mix(in srgb, var(--tier-elite) 80%, #000) 100%)',
                boxShadow:
                  '0 0 32px color-mix(in srgb, var(--tier-elite) 20%, transparent), inset 0 1px 0 rgba(255,255,255,0.4)',
              }}
            >
              <span>Show Best Move</span>
              <span className="pvf-start-arrow" aria-hidden="true">
                ›
              </span>
            </button>

            <button
              type="button"
              className="learn-coach-panel__toggle"
              onClick={onToggleRecommendation}
            >
              {showRecommendation ? 'HIDE RECOMMENDATION' : 'SHOW RECOMMENDATION'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
