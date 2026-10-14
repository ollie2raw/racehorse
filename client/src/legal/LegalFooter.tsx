import { LegalLinks } from './LegalLinks';
import type { LegalMode } from './legalModes';

/** Shared quiet footer for Home and the legal/support reading pages. */
export function LegalFooter({ current, onNavigate, className }: {
  current?: LegalMode;
  onNavigate?: (mode: LegalMode) => void;
  className?: string;
}) {
  return (
    <footer className={['rh-site-footer', className].filter(Boolean).join(' ')}>
      <span className="rh-site-footer__copyright">© 2026 Racehorse Dominoes</span>
      <LegalLinks current={current} onNavigate={onNavigate} />
    </footer>
  );
}
