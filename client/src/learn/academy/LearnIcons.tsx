type IconProps = { className?: string };

export function LearnIconTile({ className = '' }: IconProps) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="20"
        height="20"
        rx="4"
        fill="rgba(255,255,255,0.06)"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <line x1="6" y1="16" x2="26" y2="16" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="11" r="2.25" fill="currentColor" />
      <circle cx="20" cy="21" r="2.25" fill="currentColor" />
    </svg>
  );
}

export function LearnIconRefresh({ className = '' }: IconProps) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M22 10a8 8 0 1 0 2.2 5.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M22 6v4h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function LearnIconDraw({ className = '' }: IconProps) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect
        x="7"
        y="9"
        width="18"
        height="16"
        rx="3"
        fill="rgba(52,211,153,0.1)"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect x="10" y="12" width="12" height="3" rx="1" fill="currentColor" opacity="0.35" />
      <rect x="10" y="17" width="9" height="3" rx="1" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

/** Stacked layers — boneyard / draw pile */
export function LearnIconStack({ className = '' }: IconProps) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect
        x="7"
        y="17"
        width="18"
        height="9"
        rx="2"
        fill="currentColor"
        opacity="0.22"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="8"
        y="12"
        width="18"
        height="9"
        rx="2"
        fill="currentColor"
        opacity="0.4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="9"
        y="7"
        width="18"
        height="9"
        rx="2"
        fill="currentColor"
        opacity="0.58"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function LearnIconHorse({ className = '' }: IconProps) {
  return (
    <svg className={className} width="24" height="18" viewBox="0 0 22 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2 12c2-1 3-4 5-5 2-2 4-1 5 1 1 2 3 2 5 0 2-2 3-4 2-1-2-3-2-4 1-1 2-4 1-5-1-2-1-3 1-4 2H2z"
      />
    </svg>
  );
}

export function LearnIconTrophy({ className = '' }: IconProps) {
  return (
    <svg className={className} width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M9 6h14v3a5 5 0 0 1-4 4.9V16H13v-2.1a5 5 0 0 1-4-4.9V6zm2 14h10v2H11v-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LearnIconLock({ className = '' }: IconProps) {
  return (
    <svg className={className} width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
      <rect x="8" y="12" width="12" height="10" rx="2" fill="rgba(255,255,255,0.06)" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 12V9a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function LearnIconScore({ className = '' }: IconProps) {
  return <LearnIconRefresh className={className} />;
}

export function LearnIconRace({ className = '' }: IconProps) {
  return <LearnIconTrophy className={className} />;
}
