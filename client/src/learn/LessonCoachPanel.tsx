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

export default function LessonCoachPanel({
  stepIndex,
  totalSteps,
  coachingText,
  onBestMove,
  canBestMove,
  isOffAuthoredLine = false,
}: LessonCoachPanelProps) {
  return (
    <div className="coach-panel" style={{ minHeight: 120 }}>
      <div className="coach-panel-header">
        <span className="coach-icon" aria-hidden="true">🎓</span>
        <span className="coach-label">Master Fritz</span>
        {!isOffAuthoredLine && totalSteps > 0 && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.72rem',
              fontVariantNumeric: 'tabular-nums',
              color: 'rgba(200,230,210,0.55)',
              letterSpacing: '0.04em',
            }}
          >
            Turn {stepIndex + 1}{totalSteps > 0 ? ` / ${totalSteps}` : ''}
          </span>
        )}
      </div>

      {isOffAuthoredLine ? (
        <div style={{ margin: '4px 0 8px' }}>
          <p
            style={{
              margin: 0,
              fontSize: '0.82rem',
              color: 'rgba(255,200,100,0.95)',
              fontWeight: 600,
              lineHeight: 1.4,
            }}
          >
            Offline fallback active
          </p>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: '0.76rem',
              color: 'rgba(255,255,255,0.65)',
              lineHeight: 1.4,
            }}
          >
            You went off the authored line, so this hand will continue live from here.
          </p>
        </div>
      ) : coachingText ? (
        <p
          style={{
            margin: 0,
            fontSize: '0.82rem',
            color: 'rgba(232,245,240,0.9)',
            lineHeight: 1.55,
          }}
        >
          {coachingText}
        </p>
      ) : (
        <p
          style={{
            margin: 0,
            fontSize: '0.78rem',
            color: 'rgba(180,200,190,0.42)',
            fontStyle: 'italic',
          }}
        >
          No coaching note for this turn.
        </p>
      )}

      <button
        onClick={onBestMove}
        disabled={!canBestMove}
        style={{
          marginTop: 10,
          width: '100%',
          padding: '7px 0',
          borderRadius: 8,
          border: 'none',
          background: canBestMove
            ? 'rgba(80,200,160,0.22)'
            : 'rgba(80,120,100,0.12)',
          color: canBestMove
            ? 'rgba(140,240,200,0.95)'
            : 'rgba(140,180,160,0.35)',
          fontSize: '0.82rem',
          fontWeight: 600,
          cursor: canBestMove ? 'pointer' : 'not-allowed',
          letterSpacing: '0.03em',
          transition: 'background 0.15s, color 0.15s',
        }}
      >
        Best Move →
      </button>
    </div>
  );
}
