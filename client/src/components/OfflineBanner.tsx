import { useState, useEffect } from 'react';

export function OfflineBanner({ online }: { online: boolean }) {
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state when coming back online so the banner can show again if offline recurs
  useEffect(() => {
    if (online) setDismissed(false);
  }, [online]);

  if (online || dismissed) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'rgba(220, 38, 38, 0.96)',
        color: '#fff',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: '0.9rem',
        fontWeight: 600,
        backdropFilter: 'blur(4px)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
      }}
    >
      <span>You&apos;re offline — reconnect to continue playing.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss offline notice"
        style={{
          background: 'none',
          border: '1px solid rgba(255,255,255,0.5)',
          color: '#fff',
          borderRadius: 6,
          padding: '2px 10px',
          cursor: 'pointer',
          fontSize: '0.85rem',
        }}
      >
        ✕
      </button>
    </div>
  );
}
