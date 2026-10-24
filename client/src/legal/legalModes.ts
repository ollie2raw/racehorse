import type { AppMode } from '../types';

export type LegalMode = Extract<AppMode, 'privacy' | 'terms' | 'support'>;

export const LEGAL_MODES: readonly LegalMode[] = ['privacy', 'terms', 'support'];

/** The real route for each page — same-origin paths, never absolute URLs. */
export const LEGAL_HREF: Record<LegalMode, string> = {
  privacy: '/privacy',
  terms: '/terms',
  support: '/support',
};

/** The link row, in reading order. `href` is kept for a11y and new-tab opens. */
export const LEGAL_LINKS: readonly { mode: LegalMode; label: string; href: string }[] = [
  { mode: 'privacy', label: 'Privacy', href: LEGAL_HREF.privacy },
  { mode: 'terms', label: 'Terms', href: LEGAL_HREF.terms },
  { mode: 'support', label: 'Support', href: LEGAL_HREF.support },
];

export function isLegalMode(mode: AppMode): mode is LegalMode {
  return (LEGAL_MODES as readonly AppMode[]).includes(mode);
}
