import { useEffect, type ReactNode } from 'react';

interface ScoreRow {
  label: ReactNode;
  value: number | string;
  winner?: boolean;
  showCrown?: boolean;
}

interface GameOverModalProps {
  open: boolean;
  ariaLabel: string;
  title: string;
  subtitle?: string;
  scores: ScoreRow[];
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  extraActionLabel?: string;
  onExtraAction?: () => void;
  onClose?: () => void;
  children?: ReactNode;
}

export default function GameOverModal({
  open,
  ariaLabel,
  title,
  subtitle,
  scores,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  extraActionLabel,
  onExtraAction,
  onClose,
  children,
}: GameOverModalProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="game-over-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div className="game-over-card" onClick={(e) => e.stopPropagation()}>
        <div className="game-over-header">
          <div className="game-over-title-block">
            <span className="game-over-kicker">Match Complete</span>
            <h2 className="victory-title">{title}</h2>
          </div>
          {onClose && (
            <button className="mode-inline-btn game-over-close" onClick={onClose} aria-label="Close game over dialog">
              Close
            </button>
          )}
        </div>

        {subtitle && (
          <p className="game-over-meta">{subtitle}</p>
        )}

        <div className="final-scores">
          {scores.map((row, idx) => (
            <div
              key={idx}
              className={`final-score ${row.winner ? 'winner' : ''}`}
            >
              <span className="player-name">{row.label}</span>
              <span className="score">
                {row.value}
              </span>
              {row.showCrown && <span className="crown">👑</span>}
            </div>
          ))}
        </div>

        {children}

        <div className="game-over-actions">
          {extraActionLabel && onExtraAction && (
            <button className="mode-option game-over-action-card game-over-action-card-secondary" onClick={onExtraAction}>
              <span className="mode-option-title">{extraActionLabel}</span>
              <span className="mode-option-meta">Review the key turns</span>
            </button>
          )}
          <button className="mode-option mode-option-primary game-over-action-card game-over-action-card-primary" onClick={onPrimary}>
            <span className="mode-option-title">{primaryLabel}</span>
            <span className="mode-option-meta">Run it back right away</span>
          </button>
          {secondaryLabel && onSecondary && (
            <button className="mode-option game-over-action-card game-over-action-card-muted" onClick={onSecondary}>
              <span className="mode-option-title">{secondaryLabel}</span>
              <span className="mode-option-meta">Return to the menu</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
