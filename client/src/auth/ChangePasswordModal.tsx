import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import './authModal.css';

const CHANGE_PASSWORD_SUBMIT_TIMEOUT_MS = 16000;

interface ChangePasswordModalProps {
  open: boolean;
  onUpdatePassword: (password: string) => Promise<{ error: string | null; message?: string | null }>;
  onClose: () => void;
}

export default function ChangePasswordModal({
  open,
  onUpdatePassword,
  onClose,
}: ChangePasswordModalProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirmPassword('');
    setSubmitting(false);
    setError(null);
    setSuccess(false);
  }, [open]);

  useEffect(() => {
    if (!open || !submitting) return;
    const timeoutId = window.setTimeout(() => {
      setSubmitting(false);
      setError('Request timed out. Check your connection and try again.');
    }, CHANGE_PASSWORD_SUBMIT_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open, submitting]);

  useEffect(() => {
    if (!open || !success) return;
    const timeoutId = window.setTimeout(() => {
      onClose();
    }, 1800);
    return () => window.clearTimeout(timeoutId);
  }, [open, success, onClose]);

  const canSubmit = useMemo(() => {
    if (submitting || success) return false;
    return password.length >= 6 && confirmPassword.length >= 6;
  }, [submitting, success, password, confirmPassword]);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!canSubmit) return;

      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }

      setSubmitting(true);
      setError(null);
      try {
        const result = await onUpdatePassword(password);
        if (result.error) {
          setError(result.error);
        } else {
          setSuccess(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to update password.');
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, confirmPassword, onUpdatePassword, password],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Set new password"
      className="auth-modal-overlay"
    >
      <div className="auth-modal-card">
        <div className="auth-modal-head">
          <div>
            <p className="auth-modal-eyebrow">Account security</p>
            <h2 className="auth-modal-title">Set a new password</h2>
          </div>
        </div>

        <p className="auth-modal-subtitle">
          {success
            ? 'Your password has been updated. You can continue playing.'
            : 'Choose a new password for your Racehorse account.'}
        </p>

        {success ? (
          <p className="auth-inline-success">Password updated successfully.</p>
        ) : (
          <form className="auth-modal-form" onSubmit={(event) => void handleSubmit(event)}>
            <div className="auth-modal-fields">
              <label className="auth-modal-field">
                <span className="auth-modal-field-label">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  autoComplete="new-password"
                  className="auth-modal-input"
                />
              </label>

              <label className="auth-modal-field">
                <span className="auth-modal-field-label">Confirm password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  className="auth-modal-input"
                />
              </label>
            </div>

            {error && <p className="auth-inline-error">{error}</p>}

            <button type="submit" className="auth-modal-submit" disabled={!canSubmit}>
              {submitting ? 'Saving...' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
