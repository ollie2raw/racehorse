/**
 * learn/LessonDebugPanel.tsx
 *
 * Admin-only component. Reads both storage objects (authoring session +
 * frozen lesson) and renders a structured diff so the admin can verify
 * which game is frozen before promoting.
 */

import { useState } from 'react';
import { readLessonDebug, type LessonDebugSummary } from './guidedAuthoring';

const mono: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.68rem',
  color: 'rgba(200,230,215,0.75)',
  wordBreak: 'break-all',
};

const label: React.CSSProperties = {
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  color: 'rgba(180,210,200,0.5)',
  marginBottom: 2,
};

const row: React.CSSProperties = {
  marginBottom: 6,
};

function StepCard({ step, idx }: { step: LessonDebugSummary['firstSteps'][0]; idx: number }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 6,
      padding: '6px 8px',
      marginBottom: 6,
    }}>
      <div style={{ ...mono, color: 'rgba(255,220,100,0.7)', marginBottom: 3 }}>
        Step {step.stepIndex} {idx === 0 ? '(first player turn)' : ''}
      </div>
      <div style={row}>
        <div style={label}>hand</div>
        <div style={mono}>{step.playerHand.join(' · ') || '—'}</div>
      </div>
      <div style={row}>
        <div style={label}>chosenMove</div>
        <div style={{ ...mono, color: step.chosenMove ? 'rgba(140,240,200,0.85)' : 'rgba(255,120,80,0.7)' }}>
          {step.chosenMove ?? 'null (draft)'}
        </div>
      </div>
      <div style={row}>
        <div style={label}>note preview</div>
        <div style={{ ...mono, color: 'rgba(220,235,230,0.8)', fontStyle: 'italic' }}>
          {step.coachingTextPreview ? `"${step.coachingTextPreview}…"` : '(empty)'}
        </div>
      </div>
    </div>
  );
}

function SessionBlock({
  summary,
  title,
  accent,
}: {
  summary: LessonDebugSummary;
  title: string;
  accent: string;
}) {
  const ms = summary.matchStateSummary;
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: `1px solid ${accent}`,
      borderRadius: 8,
      padding: '8px 10px',
      marginBottom: 10,
    }}>
      <div style={{
        fontSize: '0.72rem',
        fontWeight: 700,
        color: accent,
        marginBottom: 4,
        letterSpacing: '0.04em',
      }}>
        {title}
      </div>

      <div style={{ ...mono, marginBottom: 4 }}>
        key: {summary.storageKey}
      </div>

      {!summary.present ? (
        <div style={{ ...mono, color: 'rgba(255,120,80,0.75)' }}>⚠ not found in localStorage</div>
      ) : (
        <>
          <div style={row}>
            <span style={label}>lessonId </span>
            <span style={mono}>{summary.lessonId}</span>
            {'  '}
            <span style={label}>fixedGameId </span>
            <span style={mono}>{summary.fixedGameId}</span>
          </div>
          <div style={{ ...mono, marginBottom: 6, color: 'rgba(200,230,210,0.6)' }}>
            {summary.stepCount} step{summary.stepCount !== 1 ? 's' : ''} total
          </div>

          {ms && (
            <div style={{
              background: 'rgba(0,0,0,0.18)',
              borderRadius: 5,
              padding: '5px 7px',
              marginBottom: 8,
            }}>
              <div style={label}>match snapshot (first step or session)</div>
              <div style={row}>
                <span style={label}>player hand </span>
                <span style={mono}>{ms.playerHand.join(' · ') || '—'}</span>
              </div>
              <div style={row}>
                <span style={label}>bot hand </span>
                <span style={mono}>{ms.botHand.join(' · ') || '—'}</span>
              </div>
              <div style={mono}>
                board: {ms.boardEmpty ? 'empty (opening)' : 'has tiles'}
                {'  '}hand #{ms.handNumber}
                {'  '}score {ms.playerScore}–{ms.botScore}
              </div>
            </div>
          )}

          {summary.firstSteps.map((s, i) => (
            <StepCard key={s.stepIndex} step={s} idx={i} />
          ))}
        </>
      )}
    </div>
  );
}

interface LessonDebugPanelProps {
  /** Called when admin wants to replace frozen lesson with current authoring session */
  onPromote: () => void;
}

export default function LessonDebugPanel({ onPromote }: LessonDebugPanelProps) {
  const [data, setData] = useState(() => readLessonDebug());
  const [promoteFlash, setPromoteFlash] = useState('');

  const refresh = () => setData(readLessonDebug());

  const handlePromote = () => {
    onPromote();
    setData(readLessonDebug());
    setPromoteFlash('✓ Promoted!');
    setTimeout(() => setPromoteFlash(''), 2500);
  };

  // Quick diff: does frozen match authoring?
  const firstHandMatch =
    data.authoring.present &&
    data.frozen.present &&
    JSON.stringify(data.authoring.firstSteps[0]?.playerHand) ===
      JSON.stringify(data.frozen.firstSteps[0]?.playerHand);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 8,
      }}>
        <span style={{
          fontSize: '0.7rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'rgba(180,200,190,0.5)',
        }}>
          Lesson Inspector
        </span>
        <button
          onClick={refresh}
          style={{
            fontSize: '0.65rem',
            padding: '2px 7px',
            borderRadius: 4,
            border: '1px solid rgba(180,200,190,0.2)',
            background: 'transparent',
            color: 'rgba(180,200,190,0.5)',
            cursor: 'pointer',
          }}
        >
          ↺ Refresh
        </button>
        {data.authoring.present && data.frozen.present && (
          <span style={{
            fontSize: '0.65rem',
            color: firstHandMatch ? 'rgba(100,240,160,0.8)' : 'rgba(255,120,80,0.85)',
            fontWeight: 600,
          }}>
            {firstHandMatch ? '✓ hands match' : '✗ hands DIFFER — frozen is wrong game'}
          </span>
        )}
      </div>

      <SessionBlock
        summary={data.authoring}
        title="LIVE AUTHORING SESSION"
        accent="rgba(255,220,100,0.6)"
      />
      <SessionBlock
        summary={data.frozen}
        title="FROZEN LESSON (loaded by guided mode)"
        accent="rgba(100,200,255,0.5)"
      />

      {/* Promote button */}
      <button
        onClick={handlePromote}
        disabled={!data.authoring.present}
        style={{
          width: '100%',
          padding: '7px 0',
          borderRadius: 8,
          border: promoteFlash
            ? '1.5px solid rgba(100,240,160,0.5)'
            : '1.5px solid rgba(255,140,60,0.4)',
          background: promoteFlash
            ? 'rgba(60,200,120,0.18)'
            : 'rgba(255,140,60,0.12)',
          color: promoteFlash
            ? 'rgba(120,255,170,0.95)'
            : 'rgba(255,180,80,0.9)',
          fontSize: '0.78rem',
          fontWeight: 700,
          cursor: data.authoring.present ? 'pointer' : 'not-allowed',
          letterSpacing: '0.03em',
        }}
      >
        {promoteFlash || '🔁 Replace Frozen Lesson with Current Authoring Session'}
      </button>
      <p style={{
        margin: '4px 0 0',
        fontSize: '0.65rem',
        color: 'rgba(180,200,190,0.38)',
        textAlign: 'center',
      }}>
        Copies live authoring → frozen · no re-authoring needed
      </p>
    </div>
  );
}
