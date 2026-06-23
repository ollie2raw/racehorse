interface Props {
  error: Error;
  onReset: () => void;
}

export function DefaultErrorFallback({ error, onReset }: Props) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#040b17',
        color: '#f0e6cc',
        fontFamily: 'var(--font-display, sans-serif)',
        gap: '16px',
        padding: '32px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '32px' }}>⚠</div>
      <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Something went wrong</h2>
      <p style={{ color: '#6b7a94', fontSize: '14px', maxWidth: '360px', margin: 0 }}>
        An unexpected error occurred. Your progress has been saved.
      </p>
      {import.meta.env.DEV && (
        <pre
          style={{
            fontSize: '11px',
            color: '#ef4444',
            background: '#0d0505',
            padding: '12px',
            borderRadius: '6px',
            maxWidth: '480px',
            overflow: 'auto',
            textAlign: 'left',
          }}
        >
          {error.message}
        </pre>
      )}
      <button
        onClick={onReset}
        style={{
          background: '#C9A84C',
          color: '#040b17',
          border: 'none',
          borderRadius: '6px',
          padding: '10px 24px',
          fontSize: '14px',
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
      <button
        onClick={() => {
          window.location.href = '/';
        }}
        style={{
          background: 'none',
          border: 'none',
          color: '#6b7a94',
          fontSize: '13px',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        Return to home
      </button>
    </div>
  );
}
