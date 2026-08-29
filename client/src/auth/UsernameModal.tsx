import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { isTemporaryUsername } from './useAuth';
import './authModal.css';

/**
 * First-run handle onboarding, and only that. Editing an existing handle moved
 * to the Settings page, which is where the rest of account management lives —
 * the profile-edit mode this used to carry had no way in once the header
 * button became a menu.
 */
interface UsernameModalProps {
  open: boolean;
  currentUsername: string | null;
  onSave: (username: string) => Promise<{ error: string | null }>;
  onClose?: () => void;
  onSignOut?: () => void | Promise<void>;
  signingOut?: boolean;
}

export default function UsernameModal({
  open,
  currentUsername,
  onSave,
  onClose,
  onSignOut,
  signingOut = false,
}: UsernameModalProps) {
  const [username, setUsername] = useState(currentUsername ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overlayPointerDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (open) {
      setUsername(currentUsername ?? '');
      setError(null);
      setSaving(false);
    }
  }, [open, currentUsername]);

  if (!open) return null;

  const normalizedUsername = username.trim().toLowerCase();
  const needsPermanentHandle = isTemporaryUsername(normalizedUsername);

  const submit = async () => {
    setError(null);
    if (needsPermanentHandle) {
      setError('Pick a permanent handle — replace the auto-generated name above.');
      return;
    }
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

  const canSave =
    normalizedUsername.length > 0 &&
    !needsPermanentHandle &&
    !saving &&
    !signingOut;

  const handleOverlayPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    overlayPointerDownOnBackdrop.current = e.target === e.currentTarget;
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && overlayPointerDownOnBackdrop.current && !saving) {
      onClose?.();
    }
    overlayPointerDownOnBackdrop.current = false;
  };

  const title = 'Choose your handle';
  const subtitle = 'This name appears on leaderboards, friends lists, and match results.';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="auth-modal-overlay"
      onPointerDown={handleOverlayPointerDown}
      onClick={handleOverlayClick}
    >
      <div className="auth-modal-card">
        {/* Head row */}
        <div className="auth-modal-head">
          <p className="auth-modal-label">Profile</p>
          {onClose && (
            <button
              type="button"
              className="auth-modal-ghost-btn"
              onClick={onClose}
              disabled={saving || signingOut}
            >
              Not now
            </button>
          )}
        </div>

        <h3 className="auth-modal-title">{title}</h3>
        <p className="auth-modal-subtitle">{subtitle}</p>

        {/* Username field */}
        <label className="auth-modal-field">
          <span className="auth-modal-field-label">Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canSave) void submit(); }}
            placeholder="racehorse_ace"
            disabled={saving || signingOut}
            autoComplete="username"
            className="auth-modal-input"
          />
        </label>

        {isTemporaryUsername(normalizedUsername) && (
          <p className="auth-modal-subtitle">
            Replace the auto-generated name with a permanent handle to continue.
          </p>
        )}

        {error && <p className="auth-inline-error">{error}</p>}

        {/* Save button */}
        <button
          type="button"
          className="auth-modal-submit"
          onClick={() => void submit()}
          disabled={!canSave}
        >
          {saving ? 'Saving…' : 'Save username'}
        </button>

        {/* Sign out row */}
        {onSignOut && (
          <div className="auth-modal-signout-row">
            <button
              type="button"
              className="auth-modal-signout-btn"
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
