import { useEffect, useMemo, useState } from "react";

interface AuthModalProps {
  open: boolean;
  loading?: boolean;
  supabaseEnabled: boolean;
  supabaseConfigError: string | null;
  onClose: () => void;
  onSignIn: (email: string, password: string) => Promise<{ error: string | null }>;
  onSignUp: (email: string, password: string) => Promise<{ error: string | null }>;
}

export default function AuthModal({
  open,
  loading,
  supabaseEnabled,
  supabaseConfigError,
  onClose,
  onSignIn,
  onSignUp,
}: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
  }, [open, mode]);

  const canSubmit = useMemo(() => {
    if (!supabaseEnabled) return false;
    if (submitting) return false;
    return email.trim().length > 0 && password.length >= 6;
  }, [supabaseEnabled, submitting, email, password]);

  if (!open) return null;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const result = mode === "signin"
        ? await onSignIn(email.trim(), password)
        : await onSignUp(email.trim(), password);

      if (result.error) {
        setError(result.error);
        return;
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1900,
        display: "grid",
        placeItems: "center",
        background: "rgba(6, 10, 18, 0.62)",
        backdropFilter: "blur(4px)",
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          zIndex: 1901,
          pointerEvents: "auto",
          width: "min(520px, calc(100vw - 24px))",
          borderRadius: "16px",
          border: "1px solid rgba(236,252,245,0.2)",
          background: "linear-gradient(170deg, rgba(18,26,39,0.92), rgba(9,15,26,0.96))",
          boxShadow: "0 24px 64px rgba(0,0,0,0.42)",
          padding: "18px",
          color: "rgba(235,245,242,0.96)",
          display: "grid",
          gap: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <h3 style={{ margin: 0 }}>{mode === "signin" ? "Sign in" : "Create account"}</h3>
          <button className="mode-inline-btn" onClick={onClose}>Close</button>
        </div>

        <p style={{ margin: 0, color: "rgba(223,236,244,0.86)" }}>
          {mode === "signin" ? "Sign in to track profile and stats." : "Create an account to save your progress."}
        </p>

        {!supabaseEnabled && (
          <p className="auth-inline-error">{supabaseConfigError ?? "Supabase not configured."}</p>
        )}

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: "0.9rem", color: "rgba(223,236,244,0.9)" }}>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={submitting || Boolean(loading)}
            style={{
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(11,18,30,0.7)",
              color: "rgba(238,248,243,0.96)",
              padding: "10px",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: "0.9rem", color: "rgba(223,236,244,0.9)" }}>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            disabled={submitting || Boolean(loading)}
            style={{
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(11,18,30,0.7)",
              color: "rgba(238,248,243,0.96)",
              padding: "10px",
            }}
          />
        </label>

        {error && <p className="auth-inline-error">{error}</p>}

        <button
          className="mode-option mode-option-primary"
          onClick={submit}
          disabled={!canSubmit}
          style={{ cursor: canSubmit ? "pointer" : "not-allowed" }}
        >
          <span className="mode-option-title">
            {submitting ? "Please wait..." : mode === "signin" ? "Sign in" : "Create account"}
          </span>
        </button>

        <button
          className="mode-inline-btn"
          onClick={() => setMode((prev) => (prev === "signin" ? "signup" : "signin"))}
          disabled={submitting}
        >
          {mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in"}
        </button>
      </div>
    </div>
  );
}
