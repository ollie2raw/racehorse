import type { AppMode } from '../types';
import { LEGAL_DOCUMENTS } from './legalContent.mjs';
import { LegalPage } from './LegalPage';
import type { LegalMode } from './legalModes';

/** Lazy-loaded entry: picks the document for the route. */
export default function LegalScreen({
  page,
  onNavigate,
  onOpenAuth,
  onSignOut,
}: {
  page: LegalMode;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}) {
  return (
    <LegalPage
      document={LEGAL_DOCUMENTS[page]}
      onNavigate={onNavigate}
      onOpenAuth={onOpenAuth}
      onSignOut={onSignOut}
    />
  );
}
