/* Same marks as Play vs Fritz left-panel badges (compact header icons). */

export const DfPvfIconRobotNav = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <rect x="4" y="7.5" width="16" height="11.5" rx="2.5" stroke={color} strokeWidth="1.7" />
    <circle cx="9" cy="12.5" r="1.6" fill={color} />
    <circle cx="15" cy="12.5" r="1.6" fill={color} />
    <path d="M9.5 16h5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    <path d="M12 7.5V5" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="12" cy="4.2" r="1.2" fill={color} />
  </svg>
);

export const DfPvfIconCrown = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"
      fill={color}
    />
  </svg>
);

export const DfIconCalendar = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M4 11h16" strokeLinecap="round" />
  </svg>
);

export const DfIconSwords = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M4 20L9 15M15 9L20 4" strokeLinecap="round" />
    <path d="M14 4l6 6M4 14l6 6" strokeLinecap="round" />
  </svg>
);

export const DfIconFlame = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      d="M12 22c4-2.5 6-6 6-10 0-3-1.5-5-3-6.5C13 4.5 12 2 12 2s-1 2.5-3 3.5C7.5 7 6 9 6 12c0 4 2 7.5 6 10z"
      stroke={color}
      strokeWidth="1.6"
      fill={color}
      fillOpacity="0.2"
    />
  </svg>
);

export const DfIconGlobe = ({ color = 'var(--tier-elite)' }: { color?: string }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.6" />
    <path d="M3 12h18M12 3c2.5 2.8 4 6.2 4 9s-1.5 6.2-4 9M12 3c-2.5 2.8-4 6.2-4 9s1.5 6.2 4 9" stroke={color} strokeWidth="1.4" />
  </svg>
);

export const DfIconTrophy = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M8 21h8M12 17v4M8 4h8v4a4 4 0 0 1-8 0V4z" strokeLinejoin="round" />
    <path d="M16 6h2a2 2 0 0 1 0 4h-2M8 6H6a2 2 0 0 0 0 4h2" strokeLinecap="round" />
  </svg>
);

export const DfIconStar = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 2.8l2.8 5.66 6.25.91-4.53 4.42 1.07 6.21L12 17.1l-5.59 2.9 1.07-6.21L2.95 9.37l6.25-.91L12 2.8z" />
  </svg>
);

export const DfIconLock = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M7 11V8a5 5 0 0 1 10 0v3" strokeLinecap="round" />
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
