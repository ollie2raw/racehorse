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

function deriveCoachHeadline(text: string, firstSentence: string): string {
  const normalized = text.toLowerCase();

  if (normalized.includes('good openings') || normalized.includes('opening was')) {
    return normalized.includes('draw') ? 'DRAW FOR POWER' : 'OPENING CHOICE';
  }
  if (normalized.includes('scoring choices') || normalized.includes('score the same')) {
    return 'SCORING CHOICES';
  }
  if (
    (normalized.includes('draw') && normalized.includes('still fine')) ||
    normalized.includes('increase our options') ||
    normalized.includes('future chain opportunities')
  ) {
    return 'BUILD OPTIONS';
  }
  if (normalized.includes('go out')) {
    return 'GO OUT';
  }
  if (normalized.includes('only one move')) {
    return 'ONLY MOVE';
  }
  if (normalized.includes('double') && normalized.includes('keep the turn')) {
    return 'USE THE DOUBLE';
  }
  if (normalized.includes('no scoring move')) {
    return 'NO SCORE HERE';
  }

  const compactSentence = firstSentence.replace(/[.!?]+$/, '').trim();
  const compactWordCount = compactSentence.split(/\s+/).filter(Boolean).length;
  if (compactSentence.length <= 34 && compactWordCount <= 5) {
    return compactSentence.toUpperCase();
  }

  return 'YOUR MOVE';
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
    const firstSentence = firstSentenceMatch[1].trim();
    title = deriveCoachHeadline(remainingText, firstSentence);
    const restOfFirst = firstSentenceMatch[3].trim();
    if (title === firstSentence.replace(/[.!?]+$/, '').trim().toUpperCase()) {
      if (restOfFirst) {
        body.push(restOfFirst);
      }
    } else {
      body.push(firstParagraph);
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
    <div className="rh-coach">
      <div className="rh-coach__avatar">
        <div className="rh-coach__avatar-mark">O</div>
        <div className="rh-coach__avatar-meta">
          <div className="rh-coach__avatar-sub">COACH</div>
          <div className="rh-coach__avatar-name">OLIVER · MASTER</div>
        </div>
      </div>

      <div className="rh-progress">
        <div className="rh-progress__head">
          <span>LESSON PROGRESS</span>
          <strong>{stepIndex + 1} / {totalSteps}</strong>
        </div>
        <div className="rh-progress__rail">
          <div
            className="rh-progress__fill"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>
        <div className="rh-tickrail">
          {Array.from({ length: 60 }).map((_, i) => (
            <div
              key={i}
              className={`rh-tickrail__tick ${
                i < stepIndex ? 'is-played' : i === stepIndex ? 'is-current' : ''
              }`}
            />
          ))}
        </div>
      </div>

      <div className="rh-coach__content">
        <div className="claude-mode-hero__eyebrow">YOUR MOVE</div>
        {isOffAuthoredLine ? (
          <>
            <h2 className="rh-coach__heading">OFFLINE FALLBACK</h2>
            <div className="rh-coach__body">
              You went off the authored line, so this hand will continue live from here.
            </div>
          </>
        ) : (
          <>
            <h2 className="rh-coach__heading">{title || 'COACHING'}</h2>
            <div className="rh-coach__body">
              {body.length > 0 ? (
                <div style={{ display: 'grid', gap: '12px' }}>
                  {body.map((p, i) => (
                    <p key={i} style={{ margin: 0 }}>{p}</p>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0 }}>{coachingText || 'No coaching note for this turn.'}</p>
              )}
              {chips.length > 0 && (
                <div className="claude-mode-chip-row" style={{ marginTop: '14px' }}>
                  {chips.map((chip) => (
                    <span key={chip} className="claude-mode-chip">{chip}</span>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {!isOffAuthoredLine && callout && (
        <div className="rh-coach__rec">
          <div className="rh-coach__rec-head">
            <div className="claude-mode-section-label">RECOMMENDED</div>
            <div className="rh-stat__value" style={{ color: '#22d3ee', fontSize: '11px', letterSpacing: '0.04em' }}>+5 CONFIDENCE</div>
          </div>
          <div className="rh-coach__rec-tile">
             <div className="rh-preview__note-text" style={{ fontSize: '14px', fontWeight: 600, color: '#fff', letterSpacing: '0.02em' }}>
              {callout}
            </div>
          </div>
          <button
            type="button"
            className="claude-mode-primary"
            style={{ padding: '10px 16px', minHeight: 0, alignSelf: 'flex-start', background: '#22d3ee', color: '#000', boxShadow: '0 8px 22px rgba(34, 211, 238, 0.28)' }}
            disabled={!canBestMove}
            onClick={onBestMove}
          >
            <span className="claude-mode-primary__title" style={{ fontSize: '13px' }}>SHOW BEST MOVE</span>
          </button>
        </div>
      )}
    </div>
  );
}
