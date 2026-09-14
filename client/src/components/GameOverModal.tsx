import { useEffect, type ReactNode } from 'react';
import { GameOverlayPortal } from './GameOverlayPortal';
import '../styles/dossierRecord.css';
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
  /** Guided Match final victory: result left, lesson right. */
  layout?: 'default' | 'guided-split';
}

function statToneClass(tone: SummaryStat['tone']): string {
  if (tone === 'gold') return 'is-accent';
  if (tone === 'red') return 'is-loss';
  if (tone === 'blue') return 'is-accent';
  return '';
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
  primaryAccent,
  layout = 'default',
}: GameOverModalProps) {
  const isGuidedSplit = layout === 'guided-split';
  const resolvedPrimaryAccent = primaryAccent ?? (matchKind === 'multiplayer' ? 'blue' : 'gold');
  const accentClass = resolvedPrimaryAccent === 'blue' || matchKind === 'multiplayer' ? ' dfd--blue' : '';

  useEffect(() => {
    if (!open || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const header = (
    <header>
      <span className="dfd__eyebrow">{kicker ?? 'Match Complete'}</span>
      <h2 className="dfd__headline">{title}</h2>
      {subtitle ? <p className="dfd__sub">{subtitle}</p> : null}
    </header>
  );

  const statsBlock = stats?.length ? (
    <dl className="dfd__stats" aria-label="Match summary">
      {stats.map((stat, idx) => (
        <div key={idx} className="dfd__stat">
          <dt>{stat.label}</dt>
          <dd className={statToneClass(stat.tone)}>{stat.value}</dd>
        </div>
      ))}
    </dl>
  ) : null;

  const scoresBlock = (
    <div className="dfd__standings" aria-label="Final scores">
      {scores.map((row, idx) => (
        <div key={idx} className="dfd__standing">
          <span>
            {row.label}
            {row.showCrown || row.winner ? <span className="dfd__tag">Winner</span> : null}
          </span>
          <span className={`dfd__standing-score${row.winner ? ' is-win' : ''}`}>{row.value}</span>
        </div>
      ))}
    </div>
  );

  const actionsBlock = (
    <div className="dfd__actions">
      <button type="button" className="dfd__btn dfd__btn--primary" onClick={onPrimary}>
        {primaryLabel}
      </button>
      {(secondaryLabel && onSecondary) || (extraActionLabel && onExtraAction) ? (
        <div className="dfd__row">
          {extraActionLabel && onExtraAction ? (
            <button type="button" className="dfd__btn" onClick={onExtraAction}>
              {extraActionLabel}
            </button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <button type="button" className="dfd__btn" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  const cardClass = `dfd${accentClass}${isGuidedSplit ? ' dfd--wide' : ''}`;

  return (
    <GameOverlayPortal>
      <div
        className="game-over-overlay df-result-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
      >
        <div className={cardClass} onClick={(e) => e.stopPropagation()}>
          {isGuidedSplit ? (
            <div className="dfd__split">
              <div className="dfd__body">
                {onClose ? (
                  <button type="button" className="dfd__close" onClick={onClose} aria-label="Close game over dialog">
                    Close
                  </button>
                ) : null}
                {header}
                {statsBlock}
                {scoresBlock}
                {actionsBlock}
              </div>
              {children ? (
                <aside className="dfd__body" aria-label="Final lesson">
                  {children}
                </aside>
              ) : null}
            </div>
          ) : (
            <div className="dfd__body">
              {onClose ? (
                <button type="button" className="dfd__close" onClick={onClose} aria-label="Close game over dialog">
                  Close
                </button>
              ) : null}
              {header}
              {statsBlock}
              {scoresBlock}
              {children ? <div className="dfd__meta">{children}</div> : null}
              {actionsBlock}
            </div>
          )}
        </div>
      </div>
    </GameOverlayPortal>
  );
}
