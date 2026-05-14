import type { ReactNode } from 'react';
import './leaderboardPage.css';

export interface LeaderboardSummaryCard {
  label: string;
  value: string;
  sublabel?: string;
  tone?: 'accent' | 'neutral' | 'success' | 'danger';
  icon?: 'rank' | 'score' | 'margin' | 'result';
}

function renderSummaryIcon(icon: LeaderboardSummaryCard['icon']) {
  switch (icon) {
    case 'rank':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 18V11" />
          <path d="M12 18V7" />
          <path d="M19 18V4" />
          <path d="M3 20h18" />
        </svg>
      );
    case 'score':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M8 4h8v4a4 4 0 0 1-8 0Z" />
          <path d="M6 6H4a3 3 0 0 0 3 3" />
          <path d="M18 6h2a3 3 0 0 1-3 3" />
          <path d="M12 12v5" />
          <path d="M9 21h6" />
        </svg>
      );
    case 'margin':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="6" />
          <path d="M12 2v4" />
          <path d="M12 18v4" />
          <path d="M2 12h4" />
          <path d="M18 12h4" />
          <circle cx="12" cy="12" r="1.5" />
        </svg>
      );
    case 'result':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M5 21V4" />
          <path d="M6 5h10l-2 3 2 3H6" />
        </svg>
      );
    default:
      return null;
  }
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
  showLiveBadge?: boolean;
  children: ReactNode;
}

export default function LeaderboardPageShell({
  mode,
  label,
  title,
  subtitle,
  onClose,
  backLabel = 'Back to Home',
  className,
  summaryCards = [],
  resultsLabel,
  footerNote,
  showLiveBadge = true,
  children,
}: LeaderboardPageShellProps) {
  return (
    <div className={`leaderboard-screen leaderboard-screen--${mode}${className ? ` ${className}` : ''}`}>
      <header className="leaderboard-screen-topbar">
        <div className="leaderboard-screen-wordmark">RACEHORSE</div>
        {showLiveBadge ? <div className="leaderboard-screen-live" aria-hidden="true">Live</div> : <div aria-hidden="true" />}
        <button type="button" className="leaderboard-screen-backlink rh-back-button" onClick={onClose}>
          <span aria-hidden="true">←</span>
          <span>{backLabel}</span>
        </button>
      </header>

      <main className="leaderboard-screen-main">
        <section className="leaderboard-screen-hero">
          <div className="leaderboard-screen-titleblock">
            <div className="leaderboard-screen-accentbar" aria-hidden="true">
              <p className="leaderboard-screen-eyebrow">{label}</p>
            </div>
            <h1 className="leaderboard-screen-title">{title}</h1>
            <p className="leaderboard-screen-subtitle">{subtitle}</p>
          </div>
          <div className="leaderboard-screen-hero-graphic" aria-hidden="true">{title}</div>
        </section>
        <section className="leaderboard-screen-panel">
          {summaryCards.length > 0 ? (
            <section className="leaderboard-screen-stats" aria-label="Leaderboard summary">
              {summaryCards.map((card) => (
                <article
                  key={card.label}
                  className={`leaderboard-screen-statcard leaderboard-screen-statcard--${card.tone ?? 'neutral'}`}
                >
                  {card.icon ? (
                    <div className={`leaderboard-screen-staticon leaderboard-screen-staticon--${card.tone ?? 'neutral'}`} aria-hidden="true">
                      {renderSummaryIcon(card.icon)}
                    </div>
                  ) : null}
                  <div className="leaderboard-screen-statbody">
                    <p className="leaderboard-screen-statlabel">{card.label}</p>
                    <p className="leaderboard-screen-statvalue">{card.value}</p>
                    {card.sublabel ? <p className="leaderboard-screen-statsub">{card.sublabel}</p> : null}
                  </div>
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
        </section>
      </main>
    </div>
  );
}
