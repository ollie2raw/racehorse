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

interface SummaryStat {
  label: ReactNode;
  value: ReactNode;
  tone?: 'default' | 'gold' | 'blue' | 'red';
}

interface GameOverModalProps {
  open: boolean;
  ariaLabel: string;
  title: string;
  subtitle?: string;
  kicker?: string;
  scores: ScoreRow[];
  stats?: SummaryStat[];
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
  tone?: 'default' | 'gold' | 'blue' | 'red';
  primaryAccent?: 'gold' | 'blue';
}

export default function GameOverModal({
  open,
  ariaLabel,
  title,
  subtitle,
  kicker,
  scores,
  stats,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  extraActionLabel,
  onExtraAction,
  onClose,
  children,
  matchKind = 'single-player',
  tone = 'default',
  primaryAccent,
}: GameOverModalProps) {
  const actionCount = Number(Boolean(extraActionLabel && onExtraAction)) + 1 + Number(Boolean(secondaryLabel && onSecondary));
  const resolvedPrimaryAccent = primaryAccent ?? (matchKind === 'multiplayer' ? 'blue' : 'gold');
  const themeClass = matchKind === 'multiplayer' ? 'rh-go--mp' : 'rh-go--sp';
  const primaryVariant = resolvedPrimaryAccent === 'blue' ? 'primary' : 'tier-elite';
  const primaryMainClass =
    resolvedPrimaryAccent === 'blue'
      ? 'rh-go-btn-full rh-go-btn-main rh-go-btn-main--blue'
      : 'rh-go-btn-full rh-go-btn-main rh-go-btn-main--gold';
  const toneClass =
    tone === 'gold' ? 'rh-go--tone-gold' : tone === 'blue' ? 'rh-go--tone-blue' : tone === 'red' ? 'rh-go--tone-red' : '';

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
        className={`game-over-overlay rh-go ${themeClass} ${toneClass}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
      <div className="game-over-card rh-go-card" onClick={(e) => e.stopPropagation()}>
        <div className="game-over-header">
          <div className="game-over-title-block">
            <span className="game-over-kicker">{kicker ?? 'Match Complete'}</span>
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

        {stats?.length ? (
          <div className="rh-go-stats" aria-label="Match summary">
            {stats.map((stat, idx) => (
              <div
                key={idx}
                className={`rh-go-stat rh-go-stat--${stat.tone ?? 'default'}`}
              >
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </div>
            ))}
          </div>
        ) : null}

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
