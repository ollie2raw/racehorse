import { useEffect, type ReactNode } from 'react';
import { Button } from './primitives';
import { GameOverlayPortal } from './GameOverlayPortal';
import './GameOverModal.css';

export type GameOverMatchKind = 'single-player' | 'multiplayer';

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
  /** Single-player / Fritz flows use brass; multiplayer uses electric blue. */
  matchKind?: GameOverMatchKind;
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
  matchKind = 'single-player',
}: GameOverModalProps) {
  const actionCount = Number(Boolean(extraActionLabel && onExtraAction)) + 1 + Number(Boolean(secondaryLabel && onSecondary));
  const themeClass = matchKind === 'multiplayer' ? 'rh-go--mp' : 'rh-go--sp';
  const primaryVariant = matchKind === 'multiplayer' ? 'primary' : 'tier-elite';
  const primaryMainClass =
    matchKind === 'multiplayer' ? 'rh-go-btn-full rh-go-btn-main rh-go-btn-main--mp' : 'rh-go-btn-full rh-go-btn-main rh-go-btn-main--sp';

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
    <GameOverlayPortal>
      <div
        className={`game-over-overlay rh-go ${themeClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
      <div className="game-over-card rh-go-card" onClick={(e) => e.stopPropagation()}>
        <div className="game-over-header">
          <div className="game-over-title-block">
            <span className="game-over-kicker">Match Complete</span>
            <h2 className="victory-title">{title}</h2>
          </div>
          {onClose && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close game over dialog"
              className="rh-go-close"
            >
              Close
            </Button>
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
              <span className="player-name-group">
                <span className="player-name">{row.label}</span>
                {row.showCrown && <span className="crown rh-go-crown" aria-hidden>👑</span>}
              </span>
              <span className="score">{row.value}</span>
            </div>
          ))}
        </div>

        {children ? <div className="rh-go-addon">{children}</div> : null}

        <div className={`rh-go-actions rh-go-actions--${actionCount}`}>
          {extraActionLabel && onExtraAction && (
            <Button type="button" variant="outline" size="lg" className="rh-go-btn-full" onClick={onExtraAction}>
              {extraActionLabel}
            </Button>
          )}
          <Button type="button" variant={primaryVariant} size="lg" className={primaryMainClass} onClick={onPrimary}>
            {primaryLabel}
          </Button>
          {secondaryLabel && onSecondary && (
            <Button type="button" variant="secondary" size="lg" className="rh-go-btn-full" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
    </GameOverlayPortal>
  );
}
