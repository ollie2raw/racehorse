import { useEffect, useMemo, useState } from 'react';
import './authModal.css';

const AUTH_MODAL_SUBMIT_TIMEOUT_MS = 16000;

interface AuthModalProps {
  open: boolean;
  supabaseEnabled: boolean;
  supabaseConfigError: string | null;
  onClose: () => void;
  onSignIn: (email: string, password: string) => Promise<{ error: string | null; message?: string | null }>;
  onSignUp: (
    email: string,
    password: string,
    username?: string,
  ) => Promise<{ error: string | null; message?: string | null; pendingVerification?: boolean }>;
  onResetPassword: (email: string) => Promise<{ error: string | null }>;
}

export default function AuthModal({
  open,
  supabaseEnabled,
  supabaseConfigError,
  onClose,
  onSignIn,
  onSignUp,
  onResetPassword,
}: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'verify'>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const resetFormState = () => {
    setSubmitting(false);
    setError(null);
    setNotice(null);
    setResetSent(false);
  };

  useEffect(() => {
    resetFormState();
  }, [open, mode]);

  useEffect(() => {
    if (!open || !submitting) return;
    const timeoutId = window.setTimeout(() => {
      setSubmitting(false);
      setError('Request timed out. Check your connection and try again.');
    }, AUTH_MODAL_SUBMIT_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [open, submitting]);

  const canSubmit = useMemo(() => {
    if (!supabaseEnabled) return false;
    if (submitting) return false;
    if (mode === 'signup' && username.trim().length === 0) return false;
    return email.trim().length > 0 && password.length >= 6;
  }, [supabaseEnabled, submitting, mode, username, email, password]);

  if (!open) return null;

  const handleClose = () => {
    resetFormState();
    setMode('signin');
    onClose();
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);

    try {
      const result =
        mode === 'signin'
          ? await onSignIn(email.trim(), password)
          : await onSignUp(email.trim(), password, username.trim() || undefined);

      if (result.error) {
        setError(result.error);
        return;
      }

      if ('pendingVerification' in result && result.pendingVerification) {
        setNotice(
          result.message ??
            `Check your email — we sent a confirmation link to ${email.trim()}. Click it to activate your account.`,
        );
        setMode('verify');
        return;
      }

      if (result.message) {
        setNotice(result.message);
      }

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Sign in" onClick={handleClose} className="auth-modal-overlay">
      <div onClick={(e) => e.stopPropagation()} className="auth-modal-card">
        <div className="auth-modal-head">
          <p className="auth-modal-label">Account</p>
          <button className="auth-modal-close" onClick={handleClose} aria-label="Close authentication modal">
            ×
          </button>
        </div>

        <h3 className="auth-modal-title">{mode === 'signin' ? 'Sign in' : 'Create account'}</h3>
        <p className="auth-modal-subtitle">
          {mode === 'verify'
            ? 'Finish account setup from your inbox.'
            : mode === 'signin'
              ? 'Track your rating, friends, streaks, and leaderboard results.'
              : 'Create a free account to track your stats and compete on the leaderboard.'}
        </p>

        {!supabaseEnabled && (
          <p className="auth-inline-error">{supabaseConfigError ?? 'Supabase not configured.'}</p>
        )}

        {mode === 'verify' ? (
          <div className="auth-modal-verify">
            <p className="auth-modal-verify-message">
              {notice ??
                `Check your email — we sent a confirmation link to ${email.trim()}. Click it to activate your account.`}
            </p>
            <button
              className="auth-modal-submit"
              onClick={async () => {
                if (submitting) return;
                setSubmitting(true);
                setError(null);
                setNotice(null);
                try {
                  const result = await onSignUp(email.trim(), password, username.trim() || undefined);
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  setNotice(
                    result.message ??
                      `Check your email — we sent a confirmation link to ${email.trim()}. Click it to activate your account.`,
                  );
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Unable to resend confirmation email.');
                } finally {
                  setSubmitting(false);
                }
              }}
              disabled={submitting || !supabaseEnabled}
            >
              {submitting ? 'Please wait...' : 'Resend Email'}
            </button>

            <button
              type="button"
              className="auth-modal-toggle auth-modal-back-link"
              onClick={() => {
                setMode('signin');
                setError(null);
                setNotice(null);
              }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <div className="auth-modal-fields">
            {mode === 'signup' && (
              <label className="auth-modal-field">
                <span className="auth-modal-field-label">Username</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_username"
                  autoComplete="username"
                  className="auth-modal-input"
                />
              </label>
            )}

            <label className="auth-modal-field">
              <span className="auth-modal-field-label">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className="auth-modal-input"
              />
            </label>

            <label className="auth-modal-field">
              <span className="auth-modal-field-label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="auth-modal-input"
              />
            </label>
            {mode === 'signin' && (
              <button
                type="button"
                className="auth-modal-forgot"
                disabled={submitting || resetSent}
                onClick={async () => {
                  if (!email.trim()) {
                    setError('Enter your email above first.');
                    return;
                  }
                  setSubmitting(true);
                  setError(null);
                  const result = await onResetPassword(email.trim());
                  setSubmitting(false);
                  if (result.error) {
                    setError(result.error);
                  } else {
                    setResetSent(true);
                    setError(null);
                  }
                }}
              >
                {resetSent ? '✓ Reset email sent' : 'Forgot password?'}
              </button>
            )}
          </div>
        )}

        {error && <p className="auth-inline-error">{error}</p>}
        {notice && !error && mode !== 'verify' && <p className="auth-inline-success">{notice}</p>}

        {mode !== 'verify' && (
          <>
            <button
              className="auth-modal-submit"
              onClick={submit}
              disabled={!canSubmit}
            >
              {submitting ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>

            <button type="button" className="auth-modal-toggle" onClick={() => setMode((prev) => (prev === 'signin' ? 'signup' : 'signin'))}>
              {mode === 'signin' ? (
                <>
                  Need an account? <span>Create one</span>
                </>
              ) : (
                <>
                  Already have an account? <span>Sign in</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
