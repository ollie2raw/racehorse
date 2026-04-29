import type { ReactNode } from 'react';
import './leaderboardPage.css';

interface LeaderboardPageShellProps {
  label: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
  panelClassName?: string;
  children: ReactNode;
}

export default function LeaderboardPageShell({
  label,
  title,
  subtitle,
  onClose,
  closeLabel = 'Close',
  className,
  panelClassName,
  children,
}: LeaderboardPageShellProps) {
  return (
    <div className={`layout-screen screen leaderboard-page-screen${className ? ` ${className}` : ''}`}>
      <div className="layout-screen-bg" aria-hidden="true" />
      <div className="layout-screen-beam" aria-hidden="true" />
      <div className="layout-screen-vignette" aria-hidden="true" />
      <div className="layout-screen-inner leaderboard-page-inner">
        <div className="layout-screen-content leaderboard-page-content">
          <section className={`leaderboard-page-panel${panelClassName ? ` ${panelClassName}` : ''}`}>
            <div className="leaderboard-page-header">
              <div className="leaderboard-page-copy">
                <p className="leaderboard-page-label">{label}</p>
                <h1 className="leaderboard-page-title">{title}</h1>
                <p className="leaderboard-page-subtitle">{subtitle}</p>
              </div>
              <button type="button" className="leaderboard-page-close" onClick={onClose}>
                {closeLabel}
              </button>
            </div>
            <div className="leaderboard-page-body">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
