import { useEffect, useState } from 'react';

interface UsernameModalProps {
  open: boolean;
  currentUsername: string | null;
  onSave: (username: string) => Promise<{ error: string | null }>;
  onClose?: () => void;
}

export default function UsernameModal({
  open,
  currentUsername,
  onSave,
  onClose,
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose username"
      onClick={() => {
        if (!saving) onClose?.();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1900,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(6, 10, 18, 0.62)',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          zIndex: 1901,
          pointerEvents: 'auto',
          width: 'min(500px, calc(100vw - 24px))',
          borderRadius: '16px',
          border: '1px solid rgba(236,252,245,0.2)',
          background: 'linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.42)',
          padding: '18px',
          color: 'rgba(235,245,242,0.96)',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <h3 style={{ margin: 0 }}>Pick your username</h3>
          {onClose && (
            <button className="mode-inline-btn" onClick={onClose} disabled={saving}>
              Not now
            </button>
          )}
        </div>

        <p style={{ margin: 0, color: 'rgba(223,236,244,0.86)' }}>
          This username is shown in your profile and stats.
        </p>

        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: '0.9rem', color: 'rgba(223,236,244,0.9)' }}>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="racehorse_ace"
            disabled={saving}
            style={{
              borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(11,18,30,0.7)',
              color: 'rgba(238,248,243,0.96)',
              padding: '10px',
            }}
          />
        </label>

        {error && <p className="auth-inline-error">{error}</p>}

        <button
          className="mode-option mode-option-primary auth-submit"
          onClick={submit}
          disabled={saving}
        >
          <span className="mode-option-title">{saving ? 'Saving...' : 'Save username'}</span>
        </button>
      </div>
    </div>
  );
}
