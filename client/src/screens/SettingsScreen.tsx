import { useId, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Button } from '../components/primitives';
import { GlobalNav } from '../components/GlobalNav';
import { resolvePasswordChange } from '../auth/passwordChange';
import { useMutePreference } from '../utils/useMutePreference';
import type { UserProfile } from '../auth/useAuth';
import type { AppMode } from '../types';
import './settingsScreen.css';

/** What every account mutation on this page returns. */
export type SettingsMutationResult = { error: string | null; message?: string | null };

export interface SettingsScreenProps {
  authUser: User | null;
  authProfile?: UserProfile | null;
  onNavigate?: (mode: AppMode) => void;
  onOpenAuth?: () => void;
  onSignOut?: () => void;
  onSaveUsername?: (username: string) => Promise<SettingsMutationResult>;
  onUpdatePassword?: (password: string) => Promise<SettingsMutationResult>;
  onUpdateEmail?: (email: string) => Promise<SettingsMutationResult>;
  /** Resolves only on failure — a success unmounts this screen. */
  onDeleteAccount?: (confirmation: string) => Promise<SettingsMutationResult>;
}

type Status = { error: string | null; message: string | null };

const IDLE: Status = { error: null, message: null };

/** One section's pending flag and its error/confirmation line. */
function useSettingsAction() {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(IDLE);

  async function run(
    action: (() => Promise<SettingsMutationResult>) | undefined,
    onSuccess?: () => void,
  ) {
    if (!action || pending) return;
    setPending(true);
    setStatus(IDLE);
    try {
      const result = await action();
      if (result.error) setStatus({ error: result.error, message: null });
      else {
        setStatus({ error: null, message: result.message ?? 'Saved.' });
        onSuccess?.();
      }
    } catch (err) {
      setStatus({
        error: err instanceof Error ? err.message : 'Something went wrong. Try again.',
        message: null,
      });
    } finally {
      setPending(false);
    }
  }

  return { pending, status, setStatus, run };
}

/**
 * One settings panel, in the same shape the how-to-play article uses for its
 * rules sections: an accent-tinted card, an uppercase eyebrow above the
 * heading, and a dot tying the heading to the panel's accent.
 */
function SettingsSection({
  eyebrow,
  title,
  accent = 'green',
  children,
}: {
  eyebrow: string;
  title: string;
  accent?: 'green' | 'gold' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <section className={`rh-settings-section rh-settings-section--${accent}`}>
      <p className="rh-settings-section-eyebrow">{eyebrow}</p>
      <h2 className="rh-settings-section-title">{title}</h2>
      {children}
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.error) return <p className="rh-settings-error" role="alert">{status.error}</p>;
  if (status.message) return <p className="rh-settings-success" role="status">{status.message}</p>;
  return null;
}

function UsernameSection({
  currentUsername,
  onSaveUsername,
}: {
  currentUsername: string;
  onSaveUsername?: (username: string) => Promise<SettingsMutationResult>;
}) {
  const id = useId();
  const [username, setUsername] = useState(currentUsername);
  const { pending, status, run } = useSettingsAction();

  return (
    <SettingsSection eyebrow="Identity" title="Handle" accent="green">
      <p className="rh-settings-section-note">
        This name appears on leaderboards, friends lists, and match results.
      </p>
      <label className="rh-settings-field" htmlFor={id}>
        <span className="rh-settings-field-label">Username</span>
        <input
          id={id}
          type="text"
          className="rh-settings-input"
          value={username}
          autoComplete="username"
          disabled={pending}
          onChange={(event) => setUsername(event.target.value)}
        />
      </label>
      <StatusLine status={status} />
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => void run(() => onSaveUsername!(username))}
      >
        {pending ? 'Saving…' : 'Save username'}
      </Button>
    </SettingsSection>
  );
}

function PasswordSection({
  onUpdatePassword,
}: {
  onUpdatePassword?: (password: string) => Promise<SettingsMutationResult>;
}) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { pending, status, setStatus, run } = useSettingsAction();

  function submit() {
    const resolved = resolvePasswordChange(password, confirmPassword);
    if ('error' in resolved) {
      setStatus({ error: resolved.error, message: null });
      return;
    }
    void run(() => onUpdatePassword!(resolved.password), () => {
      setPassword('');
      setConfirmPassword('');
    });
  }

  return (
    <SettingsSection eyebrow="Sign-in" title="Password" accent="green">
      <p className="rh-settings-section-note">
        Change it here while you are signed in. The emailed reset link is for when you cannot.
      </p>
      <label className="rh-settings-field" htmlFor={`${id}-new`}>
        <span className="rh-settings-field-label">New password</span>
        <input
          id={`${id}-new`}
          type="password"
          className="rh-settings-input"
          value={password}
          autoComplete="new-password"
          disabled={pending}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label className="rh-settings-field" htmlFor={`${id}-confirm`}>
        <span className="rh-settings-field-label">Confirm new password</span>
        <input
          id={`${id}-confirm`}
          type="password"
          className="rh-settings-input"
          value={confirmPassword}
          autoComplete="new-password"
          disabled={pending}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
      </label>
      <StatusLine status={status} />
      <Button variant="primary" disabled={pending} onClick={submit}>
        {pending ? 'Saving…' : 'Update password'}
      </Button>
    </SettingsSection>
  );
}

function EmailSection({
  currentEmail,
  onUpdateEmail,
}: {
  currentEmail: string | null;
  onUpdateEmail?: (email: string) => Promise<SettingsMutationResult>;
  /** Resolves only on failure — a success unmounts this screen. */
  onDeleteAccount?: (confirmation: string) => Promise<SettingsMutationResult>;
}) {
  const id = useId();
  const [email, setEmail] = useState('');
  const { pending, status, run } = useSettingsAction();

  return (
    <SettingsSection eyebrow="Sign-in" title="Email" accent="gold">
      <p className="rh-settings-section-note">
        Signed in as <span className="rh-settings-current-email">{currentEmail ?? 'no address on record'}</span>.
      </p>
      <label className="rh-settings-field" htmlFor={id}>
        <span className="rh-settings-field-label">New email</span>
        <input
          id={id}
          type="email"
          className="rh-settings-input"
          value={email}
          autoComplete="email"
          disabled={pending}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <StatusLine status={status} />
      <Button
        variant="primary"
        disabled={pending}
        onClick={() => void run(() => onUpdateEmail!(email), () => setEmail(''))}
      >
        {pending ? 'Sending…' : 'Change email'}
      </Button>
    </SettingsSection>
  );
}

function DangerZoneSection({
  username,
  onDeleteAccount,
}: {
  username: string;
  onDeleteAccount?: (confirmation: string) => Promise<SettingsMutationResult>;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const { pending, status, run } = useSettingsAction();

  const matches =
    username.trim().length > 0 &&
    confirmation.trim().toLowerCase() === username.trim().toLowerCase();

  return (
    <SettingsSection eyebrow="Irreversible" title="Delete account" accent="danger">
      <p className="rh-settings-section-note">
        This erases your profile, your handle, your friends, and your rating history. It cannot be
        undone, and the handle becomes available for someone else to take.
      </p>

      {confirming ? (
        <>
          <label className="rh-settings-field" htmlFor={id}>
            <span className="rh-settings-field-label">
              Type your username ({username}) to confirm
            </span>
            <input
              id={id}
              type="text"
              className="rh-settings-input"
              value={confirmation}
              autoComplete="off"
              disabled={pending}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          <StatusLine status={status} />
          <div className="rh-settings-actions">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                setConfirmation('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="rh-settings-danger-button"
              disabled={!matches || pending}
              onClick={() => void run(() => onDeleteAccount!(confirmation.trim()))}
            >
              {pending ? 'Deleting…' : 'Delete my account'}
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="outline"
          className="rh-settings-danger-button"
          onClick={() => setConfirming(true)}
        >
          Delete account
        </Button>
      )}
    </SettingsSection>
  );
}

function PreferencesSection() {
  const [isMuted, setIsMuted] = useMutePreference();
  const soundOn = !isMuted;

  return (
    <SettingsSection eyebrow="Game" title="Preferences" accent="gold">
      <div className="rh-settings-toggle-row">
        <span className="rh-settings-toggle-copy">
          <span className="rh-settings-toggle-label">Sound</span>
          <span className="rh-settings-section-note">
            Tile placement, scoring, and end-of-hand audio, in every mode.
          </span>
        </span>
        <Button
          variant={soundOn ? 'tier-standard' : 'outline'}
          size="sm"
          role="switch"
          aria-checked={soundOn}
          aria-label="Sound"
          className="rh-settings-toggle"
          onClick={() => setIsMuted((prev) => !prev)}
        >
          {soundOn ? 'On' : 'Off'}
        </Button>
      </div>
    </SettingsSection>
  );
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
  authProfile,
  onNavigate,
  onOpenAuth,
  onSignOut,
  onSaveUsername,
  onUpdatePassword,
  onUpdateEmail,
  onDeleteAccount,
}: SettingsScreenProps) {
  return (
    /*
     * Not HubViewportPage. That shell is deliberately viewport-contained —
     * "long content should scroll inside its panel" — which is right for a hub
     * of fixed panels and wrong for this, a stack of forms taller than any
     * viewport. On production it clipped everything below the fold with no way
     * to reach it. This is the how-to-play pattern instead: one scrollport
     * under a pinned nav.
     */
    <div className="rh-settings-page">
      <GlobalNav
        currentMode="settings"
        activeColor="var(--tier-standard)"
        solidDarkChrome
        onNavigate={onNavigate}
        onOpenAuth={onOpenAuth}
        onSignOut={onSignOut}
      />
      <div className="rh-settings-scroll">
      <div className="rh-settings">
        <header className="rh-settings-head">
          <p className="rh-settings-eyebrow">Account</p>
          <h1 className="rh-settings-title">Settings</h1>
        </header>

        {authUser ? (
          <>
            <UsernameSection
              currentUsername={authProfile?.username ?? ''}
              onSaveUsername={onSaveUsername}
            />
            <EmailSection currentEmail={authUser.email ?? null} onUpdateEmail={onUpdateEmail} />
            <PasswordSection onUpdatePassword={onUpdatePassword} />

            <PreferencesSection />

            <SettingsSection eyebrow="Device" title="Session" accent="green">
              <Button variant="outline" onClick={() => onSignOut?.()}>
                Sign out
              </Button>
            </SettingsSection>

            <DangerZoneSection
              username={authProfile?.username ?? ''}
              onDeleteAccount={onDeleteAccount}
            />
          </>
        ) : (
          <SettingsSection eyebrow="Account" title="Not signed in" accent="green">
            <p className="rh-settings-section-note">
              Sign in to manage your handle, your sign-in details, and your game preferences.
            </p>
            <Button variant="primary" onClick={() => onOpenAuth?.()}>
              Sign in
            </Button>
          </SettingsSection>
        )}

        {/* Sound is stored on the device, not the account, so it is offered
            whether or not anyone is signed in. */}
        {!authUser && <PreferencesSection />}
      </div>
      </div>
    </div>
  );
}

export default SettingsScreen;
