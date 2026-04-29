import type { ReactNode } from 'react';
import './leaderboardPage.css';

export interface LeaderboardSummaryCard {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'accent' | 'neutral' | 'success' | 'danger';
}

interface LeaderboardPageShellProps {
  mode: 'fritz' | 'puzzle';
  label: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  backLabel?: string;
  className?: string;
  summaryCards?: LeaderboardSummaryCard[];
  resultsLabel?: string;
  footerNote?: string;
  children: ReactNode;
}

export default function LeaderboardPageShell({
  mode,
  label,
  title,
  subtitle,
  onClose,
  backLabel = 'Back',
  className,
  summaryCards = [],
  resultsLabel,
  footerNote,
  children,
}: LeaderboardPageShellProps) {
  return (
    <div className={`leaderboard-screen leaderboard-screen--${mode}${className ? ` ${className}` : ''}`}>
      <div className="leaderboard-screen-bg" aria-hidden="true" />
      <div className="leaderboard-screen-vignette" aria-hidden="true" />
      <header className="leaderboard-screen-topbar">
        <div className="leaderboard-screen-wordmark">RACEHORSE</div>
        <button type="button" className="leaderboard-screen-backlink" onClick={onClose}>
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M10.5 3.5 6 8l4.5 4.5" />
          </svg>
          <span>{backLabel}</span>
        </button>
      </header>

      <main className="leaderboard-screen-main">
        <section className="leaderboard-screen-titleblock">
          <div className="leaderboard-screen-accentbar" aria-hidden="true" />
          <p className="leaderboard-screen-eyebrow">{label}</p>
          <h1 className="leaderboard-screen-title">{title}</h1>
          <p className="leaderboard-screen-subtitle">{subtitle}</p>
        </section>

        {summaryCards.length > 0 ? (
          <section className="leaderboard-screen-stats" aria-label="Leaderboard summary">
            {summaryCards.map((card) => (
              <article
                key={card.label}
                className={`leaderboard-screen-statcard leaderboard-screen-statcard--${card.tone ?? 'neutral'}`}
              >
                <p className="leaderboard-screen-statlabel">{card.label}</p>
                <p className="leaderboard-screen-statvalue">{card.value}</p>
                {card.sublabel ? <p className="leaderboard-screen-statsub">{card.sublabel}</p> : null}
              </article>
            ))}
          </section>
        ) : null}

        {resultsLabel ? (
          <div className="leaderboard-screen-divider" aria-hidden="true">
            <span className="leaderboard-screen-dividerline" />
            <span className="leaderboard-screen-dividertext">{resultsLabel}</span>
            <span className="leaderboard-screen-dividerline" />
          </div>
        ) : null}

        <section className="leaderboard-screen-listframe">{children}</section>

        {footerNote ? <p className="leaderboard-screen-footnote">{footerNote}</p> : null}
      </main>
    </div>
  );
}
