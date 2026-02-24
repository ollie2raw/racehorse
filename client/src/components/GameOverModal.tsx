import { useEffect, type ReactNode } from 'react';

interface ScoreRow {
  label: string;
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
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1900,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(6, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(520px, calc(100vw - 24px))',
          borderRadius: '16px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '18px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: '2rem', lineHeight: 1.1 }}>{title}</h2>
          {onClose && (
            <button className="mode-inline-btn" onClick={onClose} aria-label="Close game over dialog">
              Close
            </button>
          )}
        </div>

        {subtitle && (
          <p
            style={{
              margin: 0,
              fontSize: '0.82rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'rgba(223,238,245,0.72)',
            }}
          >
            {subtitle}
          </p>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          {scores.map((row) => (
            <div
              key={row.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 12,
                border: row.winner ? '1px solid rgba(80,220,170,0.55)' : '1px solid rgba(255,255,255,0.1)',
                background: row.winner ? 'rgba(14, 26, 42, 0.45)' : 'rgba(8, 14, 24, 0.35)',
                boxShadow: row.winner
                  ? 'inset 0 0 0 1px rgba(80,220,170,0.18), 0 10px 24px rgba(12,22,36,0.35)'
                  : 'none',
              }}
            >
              <span style={{ minWidth: 0 }}>{row.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: '1.2rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {row.value}
              </span>
              {row.showCrown && <span className="crown">👑</span>}
            </div>
          ))}
        </div>

        {children}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'nowrap',
            gap: 12,
            width: '100%',
          }}
        >
          {extraActionLabel && onExtraAction && (
            <button className="mode-inline-btn" onClick={onExtraAction}>
              {extraActionLabel}
            </button>
          )}
          <button className="btn primary victory-cta" onClick={onPrimary} style={{ minWidth: 0 }}>
            {primaryLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button className="mode-inline-btn" onClick={onSecondary}>
              {secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
