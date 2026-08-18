import type { CSSProperties } from 'react';
import type { AppMode } from '../../types';
import { APP_PRIMARY_TABS, APP_PRIMARY_TAB_COLORS } from './appPrimaryTabs';
import './AppBottomTabBar.css';

/** Must match rh-mobile-chrome.css max-width breakpoint (768px). */
export const PHONE_TAB_MAX_WIDTH_PX = 768;

interface AppBottomTabBarProps {
  currentMode?: AppMode;
  activeColor?: string;
  onNavigate?: (mode: AppMode) => void;
}

function TabIcon({ label, color }: { label: string; color: string }) {
  const stroke = color;
  switch (label) {
    case 'Multiplayer':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="9" cy="7" r="4" stroke={stroke} strokeWidth="1.8" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'Single Player':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 2l2.5 6.5L21.5 9.5 16.5 14.5 18 21.5 12 18 6 21.5 7.5 14.5 2.5 9.5 9.5 8.5 12 2z" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case 'Tournament':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'Social':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case 'Learn':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" stroke={stroke} strokeWidth="1.8" />
        </svg>
      );
    default:
      return null;
  }
}

export function AppBottomTabBar({
  currentMode,
  activeColor,
  onNavigate,
}: AppBottomTabBarProps) {
  /* Always mount — phone/desktop visibility is CSS-only (rh-mobile-chrome.css).
     Avoids Safari/layout races where matchMedia gated rendering hid mobile chrome. */
  return (
    <nav
      className="rh-bottom-tab-bar"
      aria-label="Primary sections"
    >
      <div className="rh-bottom-tab-bar__inner">
        {APP_PRIMARY_TABS.map((tab) => {
          const isActive = currentMode ? tab.activeModes.includes(currentMode) : false;
          const accent =
            (isActive && activeColor) || APP_PRIMARY_TAB_COLORS[tab.label] || 'var(--tier-elite)';
          const color = isActive ? accent : 'rgba(255, 255, 255, 0.45)';

          return (
            <button
              key={tab.label}
              type="button"
              className={`rh-bottom-tab${isActive ? ' is-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate?.(tab.mode)}
              style={{ '--rh-tab-color': accent } as CSSProperties}
            >
              <span className="rh-bottom-tab__icon">
                <TabIcon label={tab.label} color={color} />
              </span>
              <span className="rh-bottom-tab__label" style={{ color }}>
                {tab.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
