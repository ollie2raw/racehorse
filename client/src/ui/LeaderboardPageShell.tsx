import type { ReactNode } from 'react';
import LayoutScreen from './LayoutScreen';
import './leaderboardPage.css';

interface LeaderboardPageShellProps {
  label: string;
  title: string;
  subtitle: string;
  onClose: () => void;
  backLabel?: string;
  className?: string;
  contentClassName?: string;
  panelClassName?: string;
  children: ReactNode;
}

export default function LeaderboardPageShell({
  label,
  title,
  subtitle,
  onClose,
  backLabel = 'Back',
  className,
  contentClassName,
  panelClassName,
  children,
}: LeaderboardPageShellProps) {
  return (
    <LayoutScreen
      className={`screen leaderboard-page-screen mode-subpage-screen${className ? ` ${className}` : ''}`}
      title={
        <>
          <span className="leaderboard-screen-label">{label}</span>
          <span className="leaderboard-screen-title-text">{title}</span>
        </>
      }
      subtitle={subtitle}
      contentClassName={`multiplayer-menu-card screen-shell leaderboard-screen-content${contentClassName ? ` ${contentClassName}` : ''}`}
    >
      <section className={`mode-entry-panel leaderboard-screen-panel${panelClassName ? ` ${panelClassName}` : ''}`}>
        <div className="leaderboard-screen-toolbar">
          <button type="button" className="mode-option mode-option-secondary leaderboard-screen-back" onClick={onClose}>
            <span className="mode-option-title">{backLabel}</span>
            <span className="mode-option-meta">Return to the previous daily screen</span>
          </button>
        </div>
        <div className="leaderboard-screen-body">{children}</div>
      </section>
    </LayoutScreen>
  );
}
