import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  acceptRecoveryConfirmation,
  declineRecoveryConfirmation,
  getRecoveryConfirmation,
  subscribeRecoveryConfirmation,
} from './recoveryHash';
import './authModal.css';

/**
 * Shown when a password-recovery link is opened in a browser that did not request that reset. A recovery link signs
 * the browser in as whichever account it was issued for, and anyone can request one for their own account and send
 * it to someone else, so the account is named and the person must agree before anything changes.
 */
export default function RecoveryConfirmModal() {
  const pending = useSyncExternalStore(subscribeRecoveryConfirmation, getRecoveryConfirmation, getRecoveryConfirmation);
  const [busy, setBusy] = useState(false);

  const onContinue = useCallback(async () => {
    setBusy(true);
    try {
      await acceptRecoveryConfirmation();
    } finally {
      setBusy(false);
    }
  }, []);

  if (!pending) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label="Confirm password reset account" className="auth-modal-overlay">
      <div className="auth-modal-card">
        <div className="auth-modal-head">
          <div>
            <h2 className="auth-modal-title">Reset password for this account?</h2>
          </div>
        </div>
        <p className="auth-modal-subtitle">
          This link will sign you in as <strong>{pending.email}</strong> so you can set a new password. You did not
          request a reset from this browser. If that is not your email address, cancel: someone else may have sent you
          this link.
        </p>
        <button type="button" className="auth-modal-submit" disabled={busy} onClick={() => void onContinue()}>
          {busy ? 'Signing in...' : `Continue as ${pending.email}`}
        </button>
        <button type="button" className="auth-modal-ghost-btn" disabled={busy} onClick={declineRecoveryConfirmation}>
          Cancel
        </button>
      </div>
    </div>
  );
}
