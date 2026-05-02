import { useEffect } from 'react';
import { ScoreBoard } from './ScoreBoard';

interface TrackPlayer {
  label: string;
  score: number;
  tone: 'you' | 'opp';
}

interface ScoreTrackOverlayProps {
  open: boolean;
  onClose: () => void;
  players: [TrackPlayer, TrackPlayer];
  target?: number;
}

export function ScoreTrackOverlay({ open, onClose, players, target = 60 }: ScoreTrackOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="score-track-overlay" role="dialog" aria-modal="true" aria-label="Score track">
      <button className="score-track-backdrop" onClick={onClose} aria-label="Close score track" />
      <div className="score-track-card">
        <div className="score-track-header">
          <h3>Score Track</h3>
          <button className="score-track-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
        <ScoreBoard players={players} target={target} />
      </div>
    </div>
  );
}

