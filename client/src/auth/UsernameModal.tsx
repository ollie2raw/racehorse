import { useEffect, useState } from 'react';
import './authModal.css';

interface UsernameModalProps {
  open: boolean;
  currentUsername: string | null;
  /** True when the user manually opened this from their profile button (vs onboarding). */
  isProfileEdit?: boolean;
  onSave: (username: string) => Promise<{ error: string | null }>;
  onClose?: () => void;
  onSignOut?: () => void | Promise<void>;
  signingOut?: boolean;
}

export default function UsernameModal({
  open,
  currentUsername,
  isProfileEdit = false,
  onSave,
  onClose,
  onSignOut,
  signingOut = false,
}: UsernameModalProps) {
  const [username, setUsername] = useState(currentUsername ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername(currentUsername ?? '');
      setError(null);
      setSaving(false);
    }
  }, [open, currentUsername]);

  if (!open) return null;

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const result = await onSave(username);
      if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save username.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = username.trim().length > 0 && !saving && !signingOut;

  // Copy branches: profile edit vs first-time handle onboarding
  const title = isProfileEdit ? 'Your profile' : 'Choose your handle';
  const subtitle = isProfileEdit
    ? 'Manage your Racehorse handle and account settings.'
    : 'This name appears on leaderboards, friends lists, and match results.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="rh-modal-overlay"
      onClick={() => {
        if (!saving) onClose?.();
      }}
    >
      <div
        className="rh-modal-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Head row */}
        <div className="rh-modal-head">
          <p className="rh-modal-eyebrow">Profile</p>
          {/* Only show "Not now" during onboarding, not in profile-edit mode */}
          {onClose && !isProfileEdit && (
            <button
              type="button"
              className="rh-modal-ghost-btn"
              onClick={onClose}
              disabled={saving || signingOut}
            >
              Not now
            </button>
          )}
          {/* Show a close ✕ button in profile-edit mode */}
          {onClose && isProfileEdit && (
            <button
              type="button"
              className="rh-modal-close"
              onClick={onClose}
              disabled={saving || signingOut}
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>

        <h3 className="rh-modal-title">{title}</h3>
        <p className="rh-modal-subtitle">{subtitle}</p>

        {/* Username field */}
        <label className="rh-modal-field">
          <span className="rh-modal-field-label">Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void submit(); }}
            placeholder="racehorse_ace"
            disabled={saving || signingOut}
            autoComplete="username"
            className="rh-modal-input"
          />
        </label>

        {error && <p className="auth-inline-error">{error}</p>}

        {/* Save button */}
        <button
          type="button"
          className="rh-modal-submit"
          onClick={() => void submit()}
          disabled={!canSave}
        >
          {saving ? 'Saving…' : 'Save username'}
        </button>

        {/* Sign out row */}
        {onSignOut && (
          <div className="rh-modal-signout-row">
            <button
              type="button"
              className="rh-modal-signout-btn"
              onClick={() => { void onSignOut(); }}
              disabled={saving || signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
