/**
 * learn/AuthoringCoachPanel.tsx
 *
 * Replaces the normal CoachPanel during Guided Authoring mode.
 * Shown only when it is the player's turn.
 *
 * Provides:
 *   - A textarea for the admin to type their coaching note
 *   - A "Save Note" button that persists the note without advancing the game
 *   - A "Saved ✓" flash confirmation
 *   - Step index badge so the author knows where they are
 */

import React, { useEffect, useRef, useState } from 'react';
import '../learning/coach.css';

interface AuthoringCoachPanelProps {
  /** 0-based index of the current player move being authored */
  stepIndex: number;
  /** Current textarea value (lifted to parent) */
  noteText: string;
  /** Called on every keystroke */
  onNoteChange: (text: string) => void;
  /**
   * Called when "Save Note" is clicked.
   * Parent should persist the note to the authoring session without
   * recording a chosenMove — the move will be recorded when the player
   * actually plays a tile.
   */
  onSaveNote: () => void;
}

export default function AuthoringCoachPanel({
  stepIndex,
  noteText,
  onNoteChange,
  onSaveNote,
}: AuthoringCoachPanelProps) {
  const [saved, setSaved] = useState(false);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Clear saved flash when note text changes after save
  useEffect(() => {
    if (saved) setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteText]);

  // Reset saved indicator when step advances
  useEffect(() => {
    setSaved(false);
  }, [stepIndex]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleSave = () => {
    onSaveNote();
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl + Enter to save
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="coach-panel authoring-coach-panel" style={{ minHeight: 140 }}>
      <div className="coach-panel-header">
        <span className="coach-icon" aria-hidden="true">✏️</span>
        <span className="coach-label">Authoring</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.72rem',
            fontVariantNumeric: 'tabular-nums',
            color: 'rgba(200,230,210,0.55)',
            letterSpacing: '0.04em',
          }}
        >
            Move {stepIndex + 1}
          </span>
        </div>

      <textarea
        ref={textareaRef}
        value={noteText}
        onChange={(e) => onNoteChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type your coaching note for this move…"
        rows={4}
        style={{
          width: '100%',
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 8,
          color: 'rgba(232,245,240,0.92)',
          fontSize: '0.82rem',
          lineHeight: 1.5,
          padding: '7px 9px',
          resize: 'vertical',
          outline: 'none',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1,
            padding: '6px 0',
            borderRadius: 8,
            border: 'none',
            background: saved ? 'rgba(80,200,120,0.25)' : 'rgba(80,160,200,0.22)',
            color: saved ? 'rgba(120,240,160,0.95)' : 'rgba(160,210,255,0.9)',
            fontSize: '0.8rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.15s, color 0.15s',
            letterSpacing: '0.03em',
          }}
        >
          {saved ? 'Saved ✓' : 'Save Note'}
        </button>
        <span
          style={{
            fontSize: '0.68rem',
            color: 'rgba(180,200,190,0.38)',
            whiteSpace: 'nowrap',
          }}
        >
          ⌘↵
        </span>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: '0.7rem',
          color: 'rgba(180,200,190,0.42)',
          lineHeight: 1.4,
        }}
      >
        Coaching text is attached when you play the next tile.
      </p>
    </div>
  );
}
