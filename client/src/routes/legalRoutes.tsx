import React, { Suspense } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type {
  AppRoutesShellProps,
  AppRoutesNavigationProps,
  AppRoutesAuthProps,
} from '../appRouteTypes';
import type { LegalMode } from '../legal/legalModes';

const LegalScreen = React.lazy(() => import('../legal/LegalScreen'));

/** /privacy, /terms, /support — public, signed-out safe, no domain state. */
export function LegalRoute({
  page,
  shell,
  navigation,
  auth,
}: {
  page: LegalMode;
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="legal">
        <Suspense fallback={<ScreenLoader label="Loading…" />}>
          <LegalScreen
            page={page}
            onNavigate={navigation.setAppMode}
            onOpenAuth={auth.handleOpenAuthModal}
            onSignOut={auth.handleSignOut}
          />
        </Suspense>
      </ErrorBoundary>
    </div>,
  );
}
