import type { CSSProperties, ReactNode } from 'react';

export type ClaudeRedesignScreen =
  | 'home'
  | 'single'
  | 'dailyPuzzle'
  | 'dailyFritz'
  | 'multiplayer'
  | 'multiplayerLobby'
  | 'social'
  | 'leaderboard';

export type ClaudeLeaderboardMode = 'fritz' | 'puzzle';

export const claudePreviewPath = '/claude-redesign';

export const claudeTokens = {
  bg0: '#01010a',
  bg1: '#04050d',
  bg2: '#080912',
  bg3: '#0d0f1c',
  blue: '#3d8eff',
  cyan: '#00f0c8',
  amber: '#ffb800',
  gold: '#f0c040',
  green: '#00e676',
  red: '#ff4040',
} as const;

export function hexToRgb(hex: string): string {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => `${char}${char}`)
        .join('')
    : normalized;
  const safe = full.padEnd(6, '0').slice(0, 6);
  return `${Number.parseInt(safe.slice(0, 2), 16)}, ${Number.parseInt(safe.slice(2, 4), 16)}, ${Number.parseInt(safe.slice(4, 6), 16)}`;
}

export interface PreviewNavItem {
  id: ClaudeRedesignScreen;
  label: string;
}

const previewNavItems: PreviewNavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'single', label: 'Single' },
  { id: 'dailyPuzzle', label: 'Daily Puzzle' },
  { id: 'dailyFritz', label: 'Daily Fritz' },
  { id: 'multiplayer', label: 'Multiplayer' },
  { id: 'social', label: 'Social' },
  { id: 'leaderboard', label: 'Leaderboard' },
];

interface PreviewFrameProps {
  active: ClaudeRedesignScreen;
  onNavigate: (screen: ClaudeRedesignScreen) => void;
  onExit: () => void;
  children: ReactNode;
}

export function PreviewFrame({ active, onNavigate, onExit, children }: PreviewFrameProps) {
  return (
    <div className="claude-preview">
      <div className="claude-preview__bg" aria-hidden="true" />
      <header className="claude-preview__topbar">
        <button className="claude-preview__brand" type="button" onClick={() => onNavigate('home')}>
          <span className="claude-preview__brand-dot" aria-hidden="true" />
          <span>RACEHORSE</span>
        </button>
        <nav className="claude-preview__nav" aria-label="Claude redesign preview screens">
          {previewNavItems.map((item) => (
            <button
              key={item.id}
              className={`claude-preview__nav-link${item.id === active ? ' is-active' : ''}`}
              type="button"
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <button className="claude-preview__exit" type="button" onClick={onExit}>
          Exit Preview
        </button>
      </header>
      <div className="claude-preview__banner">
        <span className="claude-preview__banner-pill">Experimental</span>
        <span>Claude redesign preview with local mock data only. Production gameplay and routes are unchanged.</span>
      </div>
      <main className="claude-preview__body">{children}</main>
    </div>
  );
}

interface SplitLayoutProps {
  accent: string;
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  decor?: string;
  leftFooter?: ReactNode;
  right: ReactNode;
}

export function SplitLayout({
  accent,
  eyebrow,
  title,
  description,
  decor,
  leftFooter,
  right,
}: SplitLayoutProps) {
  return (
    <section className="claude-shell">
      <div className="claude-shell__hero" style={heroStyle(accent)}>
        {decor ? <div className="claude-shell__decor">{decor}</div> : null}
        <div className="claude-shell__hero-content">
          <p className="claude-shell__eyebrow" style={{ color: accent }}>
            {eyebrow}
          </p>
          <h1 className="claude-shell__title">{title}</h1>
          {description ? <div className="claude-shell__description">{description}</div> : null}
          {leftFooter ? <div className="claude-shell__hero-footer">{leftFooter}</div> : null}
        </div>
      </div>
      <div className="claude-shell__panel">{right}</div>
    </section>
  );
}

function heroStyle(accent: string) {
  const rgb = hexToRgb(accent);
  return {
    ['--claude-accent' as const]: accent,
    ['--claude-accent-rgb' as const]: rgb,
  } as CSSProperties;
}

export function SectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <div className="claude-section-label" style={color ? { color } : undefined}>
      {children}
    </div>
  );
}

export function PrimaryButton({
  label,
  sublabel,
  accent,
  onClick,
}: {
  label: string;
  sublabel?: string;
  accent: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="claude-primary-button"
      type="button"
      onClick={onClick}
      style={{
        ['--claude-button-accent' as const]: accent,
        ['--claude-button-accent-rgb' as const]: hexToRgb(accent),
      } as CSSProperties}
    >
      <span>{label}</span>
      {sublabel ? <span className="claude-primary-button__sub">{sublabel}</span> : null}
    </button>
  );
}

export function SecondaryRow({
  label,
  sublabel,
  onClick,
}: {
  label: string;
  sublabel?: string;
  onClick?: () => void;
}) {
  return (
    <button className="claude-secondary-row" type="button" onClick={onClick}>
      <span>
        <span className="claude-secondary-row__label">{label}</span>
        {sublabel ? <span className="claude-secondary-row__sub">{sublabel}</span> : null}
      </span>
      <span className="claude-secondary-row__arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export function StatLine({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: string;
}) {
  return (
    <div className="claude-stat-line">
      <span>{label}</span>
      <span style={accent ? { color: accent } : undefined}>{value}</span>
    </div>
  );
}
