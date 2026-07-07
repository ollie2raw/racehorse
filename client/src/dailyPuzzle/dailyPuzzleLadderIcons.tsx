export const LadderIconSameBoard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" fill="currentColor" opacity={0.92} />
  </svg>
);

export const LadderIconOrdered = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M7 7h10M7 12h10M7 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <circle cx="5" cy="7" r="1.5" fill="currentColor" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" />
    <circle cx="5" cy="17" r="1.5" fill="currentColor" />
  </svg>
);

export const LadderIconLeaderboard = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path d="M8 21V11M12 21V7M16 21V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <path d="M6 11h4M10 7h4M14 14h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity={0.5} />
  </svg>
);

export const DplIconCalendar = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="4" y="5" width="16" height="16" rx="2" />
    <path d="M8 3v4M16 3v4M4 11h16" strokeLinecap="round" />
  </svg>
);

export const DplIconFlame = ({ color = 'var(--tier-standard)' }: { color?: string }) => (
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

export const DplIconLock = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" strokeLinecap="round" />
  </svg>
);

export const DplIconTrophy = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M8 21h8M12 17v4M8 4h8v4a4 4 0 0 1-8 0V4z" strokeLinejoin="round" />
    <path d="M16 6h2a2 2 0 0 1 0 4h-2M8 6H6a2 2 0 0 0 0 4h2" strokeLinecap="round" />
  </svg>
);

export const DplIconLayers = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M12 2l8 4.5v7L12 18l-8-4.5v-7L12 2z" />
    <path d="M12 11l8-4.5M12 11v7M12 11L4 6.5" />
  </svg>
);