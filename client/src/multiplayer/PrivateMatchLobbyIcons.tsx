export function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function IconCopy() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function IconTarget() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShield() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconEye() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconDominoSm({ format }: { format: 7 | 14 }) {
  if (format === 7) {
    return (
      <svg width="18" height="20" viewBox="0 0 24 32" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="4" y="2" width="16" height="28" rx="2" />
        <line x1="4" y1="16" x2="20" y2="16" />
        <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="15" cy="9" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="22" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg width="22" height="20" viewBox="0 0 30 32" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <rect x="1" y="1" width="12" height="30" rx="2" />
      <line x1="1" y1="16" x2="13" y2="16" />
      <circle cx="7" cy="9" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="7" cy="23" r="1.4" fill="currentColor" stroke="none" />
      <rect x="17" y="1" width="12" height="30" rx="2" />
      <line x1="17" y1="16" x2="29" y2="16" />
      <circle cx="20" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="26" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20" cy="21" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="26" cy="25" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconSliders() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="17" x2="20" y2="17" />
      <circle cx="9" cy="7" r="2.2" fill="var(--bg-obsidian)" />
      <circle cx="15" cy="17" r="2.2" fill="var(--bg-obsidian)" />
    </svg>
  );
}

export function IconUsers() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="10" r="2.4" />
      <path d="M3 19c0-3 3-5 6-5s6 2 6 5" />
      <path d="M15 19c0-2 2-3.5 4-3.5s2 0 2 0" />
    </svg>
  );
}

export function IconBolt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  );
}

export function IconController() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 8h10a4 4 0 0 1 4 4v3a3 3 0 0 1-5.2 2L14 15h-4l-1.8 2A3 3 0 0 1 3 15v-3a4 4 0 0 1 4-4z" />
      <line x1="8" y1="11" x2="8" y2="13" />
      <line x1="7" y1="12" x2="9" y2="12" />
      <circle cx="16" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function IconKey() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 11l9-9M16 6l3 3" strokeLinecap="round" />
    </svg>
  );
}