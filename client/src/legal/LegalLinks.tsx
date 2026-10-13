import type { MouseEvent, ReactNode } from 'react';
import { LEGAL_HREF, LEGAL_LINKS, type LegalMode } from './legalModes';
import './legalLinks.css';

/**
 * A plain left click on an in-app link should stay in the app: in the iOS
 * shell a document navigation would reload the WebView (and lose any live
 * socket), on the web it would refetch the prerendered page. Modified clicks
 * (new tab, new window) fall through to the real href.
 */
export function inAppLinkClick(
  event: MouseEvent<HTMLAnchorElement>,
  mode: LegalMode,
  onNavigate?: (mode: LegalMode) => void,
) {
  if (!onNavigate) return;
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onNavigate(mode);
}

/** One in-app link to a legal page. Same-origin path, never an absolute URL. */
export function LegalLink({
  mode,
  onNavigate,
  className,
  children,
}: {
  mode: LegalMode;
  onNavigate?: (mode: LegalMode) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a href={LEGAL_HREF[mode]} className={className} onClick={(event) => inAppLinkClick(event, mode, onNavigate)}>
      {children}
    </a>
  );
}

/**
 * Privacy · Terms · Support. Deliberately quiet: a footer row for non-game
 * surfaces (Home, Settings, the legal pages themselves), never a match screen.
 */
export function LegalLinks({
  onNavigate,
  current,
  className,
}: {
  onNavigate?: (mode: LegalMode) => void;
  /** The page being shown, marked rather than linked to itself. */
  current?: LegalMode;
  className?: string;
}) {
  return (
    <nav className={['rh-legal-links', className].filter(Boolean).join(' ')} aria-label="Legal and support">
      <ul>
        {LEGAL_LINKS.map((link) => (
          <li key={link.mode}>
            <a
              href={link.href}
              aria-current={current === link.mode ? 'page' : undefined}
              onClick={(event) => inAppLinkClick(event, link.mode, onNavigate)}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
