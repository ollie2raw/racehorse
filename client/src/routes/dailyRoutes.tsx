import React, { Suspense } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type {
  AppRoutesShellProps,
  AppRoutesNavigationProps,
  AppRoutesAuthProps,
  AppRoutesGhostProps,
  AppRoutesSocialProps,
} from '../appRouteTypes';

const DailyPuzzleScreen = React.lazy(() => import('../dailyPuzzle/DailyPuzzleScreen'));
const DailyFritzScreen = React.lazy(() => import('../dailyFritz/DailyFritzScreen'));
const DailyFritzLeaderboardRouteScreen = React.lazy(
  () => import('../dailyFritz/DailyFritzLeaderboardRoute'),
);

export function DailyRoute({
  shell,
  navigation,
  auth,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser, authProfile, setAuthModalOpen, setUsernameModalOpen } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <Suspense fallback={<ScreenLoader label="Loading Daily Puzzle…" />}>
        <ErrorBoundary context="daily-puzzle">
        <DailyPuzzleScreen
          key="daily-hub"
          user={authUser}
          profile={authProfile}
          onBack={() => setAppMode('home')}
          onNavigate={setAppMode}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenAccount={() => setUsernameModalOpen(true)}
        />
        </ErrorBoundary>
      </Suspense>
    </div>
  );
}

export function DailyPuzzleLeaderboardRoute({
  shell,
  navigation,
  auth,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser, authProfile, setAuthModalOpen, setUsernameModalOpen } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <Suspense fallback={<ScreenLoader label="Loading Daily Puzzle Leaderboard…" />}>
        <ErrorBoundary context="daily-puzzle-leaderboard">
        <DailyPuzzleScreen
          key="daily-leaderboard"
          user={authUser}
          profile={authProfile}
          initialView="leaderboard"
          onLeaderboardClose={() => setAppMode('daily')}
          onBack={() => setAppMode('home')}
          onNavigate={setAppMode}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenAccount={() => setUsernameModalOpen(true)}
        />
        </ErrorBoundary>
      </Suspense>
    </div>
  );
}

export function DailyFritzRoute({
  shell,
  navigation,
  auth,
  ghost,
  social,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  ghost: AppRoutesGhostProps;
  social: AppRoutesSocialProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser, authProfile, refreshAuthProfile, applyProfilePatch, setAuthModalOpen, setUsernameModalOpen } = auth;
  const { ghostProfile, setGhostProfile } = ghost;
  const { socket } = social;
  return withAuthModals(
    <div className={appRootClassName}>
      <Suspense fallback={<ScreenLoader label="Loading Daily Fritz…" />}>
        <ErrorBoundary context="daily-fritz">
        <DailyFritzScreen
          user={authUser}
          profile={authProfile}
          socket={socket}
          ghostProfile={ghostProfile}
          onGhostProfileChange={setGhostProfile}
          onProfileRefresh={refreshAuthProfile}
          onProfilePatch={applyProfilePatch}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenAccount={() => setUsernameModalOpen(true)}
          onBack={() => setAppMode('home')}
          onNavigate={setAppMode}
        />
        </ErrorBoundary>
      </Suspense>
    </div>
  );
}

export function DailyFritzLeaderboardRoute({
  shell,
  navigation,
  auth,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser, authProfile, setAuthModalOpen, setUsernameModalOpen } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <Suspense fallback={<ScreenLoader label="Loading Daily Fritz Leaderboard…" />}>
        <ErrorBoundary context="daily-fritz-leaderboard">
        <DailyFritzLeaderboardRouteScreen
          user={authUser}
          profile={authProfile}
          onClose={() => setAppMode('dailyFritz')}
          onNavigate={setAppMode}
          onOpenAuth={() => setAuthModalOpen(true)}
          onOpenAccount={() => setUsernameModalOpen(true)}
        />
        </ErrorBoundary>
      </Suspense>
    </div>
  );
}
