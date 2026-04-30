import type { CSSProperties, ReactNode } from 'react';
import './claudeMode.css';

export function claudeRgb(hex: string): string {
  const normalized = hex.replace('#', '');
  const safe = normalized.padEnd(6, '0').slice(0, 6);
  return `${Number.parseInt(safe.slice(0, 2), 16)}, ${Number.parseInt(safe.slice(2, 4), 16)}, ${Number.parseInt(safe.slice(4, 6), 16)}`;
}

function accentVars(accent: string): CSSProperties {
  return {
    ['--claude-accent' as const]: accent,
    ['--claude-accent-rgb' as const]: claudeRgb(accent),
  } as CSSProperties;
}

export function ClaudeModeScreen({
  accent,
  eyebrow,
  title,
  description,
  decor,
  heroFooter,
  panel,
  panelClassName,
  heroClassName,
  backLabel,
  onBack,
}: {
  accent: string;
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  decor?: string;
  heroFooter?: ReactNode;
  panel: ReactNode;
  panelClassName?: string;
  heroClassName?: string;
  backLabel?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="claude-mode-page">
      <header className="claude-mode-topbar">
        <div className="claude-mode-topbar__brand">RACEHORSE</div>
        {onBack ? (
          <button type="button" className="claude-mode-topbar__back" onClick={onBack}>
            <span aria-hidden="true">←</span>
            <span>{backLabel ?? 'Back'}</span>
          </button>
        ) : null}
      </header>
      <section className="claude-mode-screen">
        <div className={`claude-mode-hero${heroClassName ? ` ${heroClassName}` : ''}`} style={accentVars(accent)}>
          {decor ? <div className="claude-mode-hero__decor">{decor}</div> : null}
          <div className="claude-mode-hero__content">
            <p className="claude-mode-hero__eyebrow">{eyebrow}</p>
            <h1 className="claude-mode-hero__title">{title}</h1>
            {description ? <div className="claude-mode-hero__description">{description}</div> : null}
            {heroFooter ? <div className="claude-mode-hero__footer">{heroFooter}</div> : null}
          </div>
        </div>
        <div className={`claude-mode-panel${panelClassName ? ` ${panelClassName}` : ''}`}>{panel}</div>
      </section>
    </div>
  );
}

export function ClaudeSectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div className="claude-mode-section-label" style={color ? { color } : undefined}>
      {children}
    </div>
  );
}

export function ClaudePrimaryAction({
  accent,
  title,
  meta,
  onClick,
  disabled,
  className,
}: {
  accent: string;
  title: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`claude-mode-primary${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
      style={{
        ['--claude-button-accent' as const]: accent,
        ['--claude-button-accent-rgb' as const]: claudeRgb(accent),
      } as CSSProperties}
    >
      <span className="claude-mode-primary__title">{title}</span>
      {meta ? <span className="claude-mode-primary__meta">{meta}</span> : null}
    </button>
  );
}

export function ClaudeSecondaryAction({
  title,
  meta,
  onClick,
  disabled,
  className,
}: {
  title: ReactNode;
  meta?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`claude-mode-secondary${className ? ` ${className}` : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="claude-mode-secondary__title">{title}</span>
      {meta ? <span className="claude-mode-secondary__meta">{meta}</span> : null}
    </button>
  );
}

export function ClaudeStatLine({
  label,
  value,
  accent,
}: {
  label: ReactNode;
  value: ReactNode;
  accent?: string;
}) {
  return (
    <div className="claude-mode-stat-line">
      <span>{label}</span>
      <span style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  );
}
