import type { User } from '@supabase/supabase-js';
import { Button, GlassCard } from '../components/primitives';
import HubViewportPage from '../components/hub/HubViewportPage';
import type { AppMode } from '../types';
import './settingsScreen.css';

export interface SettingsScreenProps {
  authUser: User | null;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
}

/**
 * Account and preferences, in one place.
 *
 * The route is prerendered (non-indexable) and directly linkable, so it has to
 * render coherently with no session — hence the signed-out branch rather than
 * a redirect, which would race the async session restore and bounce a
 * signed-in user on a slow connection.
 */
export function SettingsScreen({
  authUser,
  onNavigate,
  onOpenAuth,
  onSignOut,
}: SettingsScreenProps) {
  return (
    <HubViewportPage
      currentMode="settings"
      activeColor="var(--tier-standard)"
      onNavigate={onNavigate}
      onOpenAuth={onOpenAuth}
      onSignOut={onSignOut}
    >
      <div className="rh-settings">
        <header className="rh-settings-head">
          <p className="rh-settings-eyebrow">Account</p>
          <h1 className="rh-settings-title">Settings</h1>
        </header>

        {authUser ? (
          <GlassCard className="rh-settings-section">
            <h2 className="rh-settings-section-title">Session</h2>
            <p className="rh-settings-section-note">
              Signed in as {authUser.email ?? 'your account'}.
            </p>
            <Button variant="outline" onClick={() => onSignOut?.()}>
              Sign out
            </Button>
          </GlassCard>
        ) : (
          <GlassCard className="rh-settings-section">
            <h2 className="rh-settings-section-title">Not signed in</h2>
            <p className="rh-settings-section-note">
              Sign in to manage your handle, your sign-in details, and your game preferences.
            </p>
            <Button variant="primary" onClick={() => onOpenAuth?.()}>
              Sign in
            </Button>
          </GlassCard>
        )}
      </div>
    </HubViewportPage>
  );
}

export default SettingsScreen;
