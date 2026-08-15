import React, { Suspense } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type {
  AppRoutesShellProps,
  AppRoutesMultiplayerProps,
  AppRoutesSocialProps,
} from '../appRouteTypes';

const MultiplayerModeController = React.lazy(() => import('../multiplayer/MultiplayerModeController'));

export function MultiplayerRoute({
  shell,
  social,
  multiplayer,
}: {
  shell: AppRoutesShellProps;
  social: AppRoutesSocialProps;
  multiplayer: AppRoutesMultiplayerProps;
}) {
  const { withAuthModals, appRootRef, appRootClassName, friendInvitePopup } = shell;
  const { toast } = social;
  const {
    error,
    actionError,
    state,
    setError,
    setActionError,
    multiplayerConnectionBundle,
    mpSubView,
    startGame,
    multiplayerModeViewProps,
  } = multiplayer;

  return withAuthModals(
    <div ref={appRootRef} className={appRootClassName}>
      {toast && <div className="toast">{toast}</div>}
      {friendInvitePopup}

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {actionError && state && !state.handOver && !state.gameOver && (
        <div className="error-banner">
          {actionError}
          <button onClick={() => setActionError('')}>×</button>
        </div>
      )}

      <Suspense fallback={<ScreenLoader label="Loading Multiplayer…" />}>
        <ErrorBoundary context="multiplayer">
        <MultiplayerModeController
          connection={multiplayerConnectionBundle}
          mpSubView={mpSubView}
          startGame={startGame}
          view={multiplayerModeViewProps}
        />
        </ErrorBoundary>
      </Suspense>
    </div>,
  );
}
