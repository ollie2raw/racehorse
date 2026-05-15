/** Shared bust silhouette for duel avatars (Quick Match + Private lobby). */
export function IconUserBust({ gradientId }: { gradientId: string }) {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.7" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M32 13c5 0 9 4.2 9 9.6 0 4.6-2.7 8.4-6.5 9.4 9.5 1.4 18 8.2 18 18.6V64H9.5V50.6c0-10.4 8.5-17.2 18-18.6-3.8-1-6.5-4.8-6.5-9.4 0-5.4 4-9.6 9-9.6z"
      />
    </svg>
  );
}

export function IconPlus() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

/** Win-streak chip (duel cards on Quick + Private hubs). */
export function IconFlame({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2s4 4 4 8-2 6-4 6-4-2-4-6c0 0-2 2-2 5a6 6 0 0 0 12 0c0-5-6-9-6-13z" />
    </svg>
  );
}
