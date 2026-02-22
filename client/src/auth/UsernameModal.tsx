import { useEffect, useState } from "react";

interface UsernameModalProps {
  open: boolean;
  currentUsername: string | null;
  onSave: (username: string) => Promise<{ error: string | null }>;
}

export default function UsernameModal({ open, currentUsername, onSave }: UsernameModalProps) {
  const [username, setUsername] = useState(currentUsername ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setUsername(currentUsername ?? "");
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
      setError(err instanceof Error ? err.message : "Unable to save username.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-label="Choose username">
      <div className="auth-modal-card">
        <div className="auth-modal-header">
          <h3>Pick your username</h3>
        </div>

        <p className="auth-modal-copy">This username is shown in your profile and stats.</p>

        <label className="auth-field">
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="racehorse_ace"
            disabled={saving}
          />
        </label>

        {error && <p className="auth-inline-error">{error}</p>}

        <button className="mode-option mode-option-primary auth-submit" onClick={submit} disabled={saving}>
          <span className="mode-option-title">{saving ? "Saving..." : "Save username"}</span>
        </button>
      </div>
    </div>
  );
}
