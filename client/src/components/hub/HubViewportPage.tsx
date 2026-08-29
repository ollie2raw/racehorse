import type { ReactNode } from 'react';
import type { AppMode } from '../../types';
import { GlobalNav } from '../GlobalNav';
import '../../social/hub/socialHubTokens.css';
import './hubDesignTokens.css';
import './hubViewportPage.css';

interface HubViewportPageProps {
  children: ReactNode;
  currentMode?: AppMode;
  activeColor?: string;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
  className?: string;
}

/** Viewport-contained hub shell — scroll inside panels, not the page. */
export default function HubViewportPage({
  children,
  currentMode = 'feed',
  activeColor = 'var(--tier-elite)',
  onNavigate,
  onOpenAuth,
  onSignOut,
  className,
}: HubViewportPageProps) {
  return (
    <div
      className={`rh-hub-screen rh-hub-page rh-hub-viewport-contained${className ? ` ${className}` : ''}`}
    >
      <div className="rh-hub-shell">
        <GlobalNav
          currentMode={currentMode}
          activeColor={activeColor}
          solidDarkChrome
          onNavigate={onNavigate}
          onOpenAuth={onOpenAuth}
          onSignOut={onSignOut}
        />
        <div className="rh-hub-body">{children}</div>
      </div>
    </div>
  );
}
