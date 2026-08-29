import React, { Suspense } from 'react';
import { ScreenLoader } from '../ui/ScreenLoader';
import { ErrorBoundary } from '../components/ErrorBoundary';
import type {
  AppRoutesShellProps,
  AppRoutesNavigationProps,
  AppRoutesAuthProps,
  AppRoutesSocialProps,
} from '../appRouteTypes';
import { isSpectatorModeEnabled } from '../config/spectatorModeFeature';

const RatingHistoryPage = React.lazy(() => import('../ranking/RatingHistoryPage'));
const StatsScreen = React.lazy(() => import('../stats/StatsScreen'));
const SettingsScreen = React.lazy(() => import('../screens/SettingsScreen'));
const FriendsScreenLobbyBridge = React.lazy(() => import('../multiplayer/FriendsScreenLobbyBridge'));
const ActivityFeedLobbyBridge = React.lazy(() => import('../multiplayer/ActivityFeedLobbyBridge'));
const LeaderboardScreen = React.lazy(() => import('../social/LeaderboardScreen'));
const PublicProfileScreenLobbyBridge = React.lazy(
  () => import('../multiplayer/PublicProfileScreenLobbyBridge'),
);

export const spectatorModeEnabled = isSpectatorModeEnabled();
export const LiveNowScreen = spectatorModeEnabled
  ? React.lazy(() => import('../live/LiveNowScreen'))
  : null;

export function LiveNowRoute({
  shell,
  navigation,
  social,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  social: AppRoutesSocialProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { socket, connect } = social;
  if (!LiveNowScreen) return withAuthModals(<div className={appRootClassName} />);
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="live-now">
      <Suspense fallback={<ScreenLoader label="Loading Live Now…" />}>
        <LiveNowScreen socket={socket} connect={connect} onBack={() => setAppMode('home')} />
      </Suspense>
      </ErrorBoundary>
    </div>,
  );
}

export function RatingHistoryRoute({
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
  const { authUser, authProfile } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="rating-history">
      <Suspense fallback={<ScreenLoader label="Loading Rating History…" />}>
        <RatingHistoryPage
          userId={authUser?.id ?? null}
          username={authProfile?.username ?? null}
          onBack={() => setAppMode('home')}
        />
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function FriendsRoute({
  shell,
  navigation,
  auth,
  social,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  social: AppRoutesSocialProps;
}) {
  const { withAuthModals, appRootClassName, friendInvitePopup } = shell;
  const { setAppMode } = navigation;
  const { authUser, authProfile } = auth;
  const { socket, joinedRoom, showToast, setProfileTarget, setProfileOriginMode } = social;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="friends">
      <Suspense fallback={<ScreenLoader label="Loading Friends…" />}>
        <FriendsScreenLobbyBridge
          open={true}
          user={authUser}
          socket={socket}
          joinedRoom={joinedRoom}
          currentUsername={authProfile?.username ?? ''}
          showToast={showToast}
          onClose={() => setAppMode('home')}
          onViewProfile={(username) => {
            setProfileTarget(username);
            setProfileOriginMode('friends');
            setAppMode('profile');
          }}
        />
      </Suspense>
      </ErrorBoundary>
      {friendInvitePopup}
    </div>
  );
}

export function StatsRoute({
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
  const { authUser, authProfile } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="stats">
      <Suspense fallback={<ScreenLoader label="Loading Stats…" />}>
        <StatsScreen
          open={true}
          user={authUser}
          profile={authProfile}
          onClose={() => setAppMode('home')}
        />
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function SettingsRoute({
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
  const {
    authUser,
    authProfile,
    handleOpenAuthModal,
    handleSignOut,
    handleSaveUsername,
    updatePassword,
    updateEmail,
  } = auth;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="settings">
        <Suspense fallback={<ScreenLoader label="Loading Settings…" />}>
          <SettingsScreen
            authUser={authUser}
            authProfile={authProfile}
            onNavigate={setAppMode}
            onOpenAuth={handleOpenAuthModal}
            onSignOut={handleSignOut}
            onSaveUsername={handleSaveUsername}
            onUpdatePassword={updatePassword}
            onUpdateEmail={updateEmail}
          />
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function FeedRoute({
  shell,
  navigation,
  auth,
  social,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  social: AppRoutesSocialProps;
}) {
  const { withAuthModals, appRootClassName, friendInvitePopup } = shell;
  const { setAppMode } = navigation;
  const { handleOpenAuthModal, handleSignOut, authUser } = auth;
  const {
    socket,
    connect,
    showToast,
    outboundChallenge,
    clearOutboundChallenge,
    setProfileTarget,
    setProfileOriginMode,
    toast,
  } = social;
  return withAuthModals(
    <div className={appRootClassName}>
      {toast && <div className="toast">{toast}</div>}
      <ErrorBoundary context="feed">
      <Suspense fallback={<ScreenLoader label="Loading Feed…" />}>
        <ActivityFeedLobbyBridge
          user={authUser}
          socket={socket}
          connect={connect}
          showToast={showToast}
          outboundChallenge={outboundChallenge}
          clearOutboundChallenge={clearOutboundChallenge}
          onViewProfile={(username) => {
            setProfileTarget(username);
            setProfileOriginMode('feed');
            setAppMode('profile');
          }}
          onClose={() => setAppMode('home')}
          onNavigateToFriends={() => setAppMode('friends')}
          onNavigate={setAppMode}
          onOpenAuth={handleOpenAuthModal}
          onSignOut={handleSignOut}
        />
      </Suspense>
      </ErrorBoundary>
      {friendInvitePopup}
    </div>
  );
}

export function LeaderboardRoute({
  shell,
  navigation,
  auth,
  social,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  social: AppRoutesSocialProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser } = auth;
  const { setProfileTarget, setProfileOriginMode } = social;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="leaderboard">
      <Suspense fallback={<ScreenLoader label="Loading Leaderboard…" />}>
        <LeaderboardScreen
          user={authUser}
          onViewProfile={(username) => {
            setProfileTarget(username);
            setProfileOriginMode('leaderboard');
            setAppMode('profile');
          }}
          onClose={() => setAppMode('feed')}
        />
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}

export function ProfileRoute({
  shell,
  navigation,
  auth,
  social,
}: {
  shell: AppRoutesShellProps;
  navigation: AppRoutesNavigationProps;
  auth: AppRoutesAuthProps;
  social: AppRoutesSocialProps;
}) {
  const { withAuthModals, appRootClassName } = shell;
  const { setAppMode } = navigation;
  const { authUser } = auth;
  const {
    showToast,
    profileTarget,
    setProfileTarget,
    profileOriginMode,
    setProfileOriginMode,
  } = social;
  return withAuthModals(
    <div className={appRootClassName}>
      <ErrorBoundary context="profile">
      <Suspense fallback={<ScreenLoader label="Loading Profile…" />}>
        <PublicProfileScreenLobbyBridge
          username={profileTarget ?? ''}
          user={authUser}
          showToast={showToast}
          onClose={() => {
            setProfileTarget(null);
            const nextMode = profileOriginMode ?? 'home';
            setProfileOriginMode(null);
            setAppMode(nextMode);
          }}
          onChallenge={() => setAppMode('multiplayer')}
        />
      </Suspense>
      </ErrorBoundary>
    </div>
  );
}
