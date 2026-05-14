type Props = { online: number; queued: number };

/**
 * Small "X online · Y searching" pill — green dot + count.
 * Renders inline; consumer controls placement.
 */
export function OnlineCountBadge({ online, queued }: Props) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 999,
        background: 'rgba(10, 16, 28, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        fontFamily: "'Outfit', sans-serif",
        fontSize: 12,
        fontWeight: 600,
        color: 'rgba(255, 255, 255, 0.78)',
        letterSpacing: '0.02em',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#4ADE80',
          boxShadow: '0 0 10px rgba(74, 222, 128, 0.65)',
        }}
      />
      {online.toLocaleString()} online · {queued.toLocaleString()} searching
    </div>
  );
}
