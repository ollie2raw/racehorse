import type { CSSProperties } from 'react';
import type { AppMode } from '../../types';
import {
  APP_PRIMARY_TABS,
  APP_PRIMARY_TAB_COLORS,
} from './appPrimaryTabs';
import './AppBottomTabBar.css';

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
          <path
            d="M17 21V19C17 17.9391 16.5786 16.9217 15.8284 16.1716C15.0783 15.4214 14.0609 15 13 15H5C3.93913 15 2.92172 15.4214 2.17157 16.1716C1.42143 16.9217 1 17.9391 1 19V21"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M9 11C11.2091 11 13 9.20914 13 7C13 4.79086 11.2091 3 9 3C6.79086 3 5 4.79086 5 7C5 9.20914 6.79086 11 9 11Z"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M23 21V19C22.9993 18.1137 22.7044 17.2528 22.1614 16.5523C21.6184 15.8519 20.8581 15.3516 20 15.13"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M16 3.13C16.8604 3.35031 17.623 3.85071 18.1676 4.55232C18.7122 5.25392 19.0078 6.11683 19.0078 7.005C19.0078 7.89318 18.7122 8.75608 18.1676 9.45769C17.623 10.1593 16.8604 10.6597 16 10.88"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'Single Player':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 2L14.5 8.5L21.5 9.5L16.5 14.5L18 21.5L12 18L6 21.5L7.5 14.5L2.5 9.5L9.5 8.5L12 2Z"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'Tournament':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M8 21H16M12 17V21M7 4H17V8C17 10.7614 14.7614 13 12 13C9.23858 13 7 10.7614 7 8V4Z"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7 6H4C4 8.5 5.5 10 7.5 10.5M17 6H20C20 8.5 18.5 10 16.5 10.5"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'Social':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'Learn':
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 19.5C4 18.837 4.26339 18.2011 4.73223 17.7322C5.20107 17.2634 5.83696 17 6.5 17H20"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6.5 2H20V22H6.5C5.83696 22 5.20107 21.7366 4.73223 21.2678C4.26339 20.7989 4 20.163 4 19.5V4.5C4 3.83696 4.26339 3.20107 4.73223 2.73223C5.20107 2.26339 5.83696 2 6.5 2Z"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
  return (
    <nav
      className="rh-bottom-tab-bar"
      aria-label="Primary sections"
      style={
        {
          '--rh-tab-accent': activeColor ?? 'var(--tier-elite)',
        } as CSSProperties
      }
    >
      <div className="rh-bottom-tab-bar__inner">
        {APP_PRIMARY_TABS.map((tab) => {
          const isActive = currentMode
            ? tab.activeModes.includes(currentMode)
            : false;
          const accent =
            (isActive && activeColor) ||
            APP_PRIMARY_TAB_COLORS[tab.label] ||
            'var(--tier-elite)';
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
              <span
                className="rh-bottom-tab__label"
                style={{ color }}
              >
                {tab.shortLabel}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
