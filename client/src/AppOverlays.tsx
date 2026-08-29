import React, { Suspense } from 'react';
import { FriendInvitePopupBridge } from './multiplayer/FriendInvitePopupBridge';
import type { FriendInviteState } from './multiplayer/runtime/friendInviteRuntime';

const AuthModal = React.lazy(() => import('./auth/AuthModal'));
const UsernameModal = React.lazy(() => import('./auth/UsernameModal'));
const ChangePasswordModal = React.lazy(() => import('./auth/ChangePasswordModal'));

export type AuthModalsLayerProps = {
  authModalOpen: boolean;
  supabaseEnabled: boolean;
  supabaseConfigError: string | null;
  onAuthModalClose: () => void;
  onSignIn: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; message?: string | null }>;
  onSignUp: (
    email: string,
    password: string,
    username?: string,
  ) => Promise<{ error: string | null; message?: string | null; pendingVerification?: boolean }>;
  onResetPassword: (email: string) => Promise<{ error: string | null; message?: string | null }>;
  passwordRecoveryPending: boolean;
  onUpdatePassword: (password: string) => Promise<{ error: string | null; message?: string | null }>;
  onPasswordRecoveryClose: () => void;
  usernameModalOpen: boolean;
  currentUsername: string | null;
  onUsernameSave: (username: string) => Promise<{ error: string | null }>;
  onUsernameClose: () => void;
  onUsernameSignOut: () => void | Promise<void>;
  signingOut: boolean;
};

export function AuthModalsLayer({
  authModalOpen,
  supabaseEnabled,
  supabaseConfigError,
  onAuthModalClose,
  onSignIn,
  onSignUp,
  onResetPassword,
  passwordRecoveryPending,
  onUpdatePassword,
  onPasswordRecoveryClose,
  usernameModalOpen,
  currentUsername,
  onUsernameSave,
  onUsernameClose,
  onUsernameSignOut,
  signingOut,
}: AuthModalsLayerProps) {
  return (
    <Suspense fallback={null}>
      <AuthModal
        open={authModalOpen}
        supabaseEnabled={supabaseEnabled}
        supabaseConfigError={supabaseConfigError}
        onClose={onAuthModalClose}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
        onResetPassword={onResetPassword}
      />
      <ChangePasswordModal
        open={passwordRecoveryPending}
        onUpdatePassword={onUpdatePassword}
        onClose={onPasswordRecoveryClose}
      />
      <UsernameModal
        open={usernameModalOpen}
        currentUsername={currentUsername}
        onSave={onUsernameSave}
        onClose={onUsernameClose}
        onSignOut={onUsernameSignOut}
        signingOut={signingOut}
      />
    </Suspense>
  );
}

export function MultiplayerShellErrorFallback() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-obsidian)',
        color: 'rgba(255, 255, 255, 0.95)',
        fontFamily: 'var(--font-display, sans-serif)',
        gap: '16px',
      }}
    >
      <div style={{ fontSize: '32px' }}>⚠</div>
      <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Match unavailable</h2>
      <p style={{ color: 'rgba(255, 255, 255, 0.35)', fontSize: '14px', margin: 0 }}>
        Something went wrong during your match.
      </p>
      <button
        onClick={() => { window.location.href = '/'; }}
        style={{
          background: 'var(--tier-elite)',
          color: 'var(--bg-obsidian)',
          border: 'none',
          borderRadius: '6px',
          padding: '10px 24px',
          fontSize: '14px',
          fontWeight: 700,
          cursor: 'pointer',
          marginTop: '8px',
        }}
      >
        Return to home
      </button>
    </div>
  );
}

export function FriendInvitePopupOverlay({
  invite,
  joining,
}: {
  invite: FriendInviteState | null;
  joining: boolean;
}) {
  if (!invite) return null;
  return <FriendInvitePopupBridge invite={invite} joining={joining} />;
}
