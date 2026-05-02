import React from 'react';

export function RotatePhoneIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      className="rotate-phone-icon"
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <path d="M12 18h.01" />
      <path d="M17 2H7" />
      <path
        d="M22 10c0-4.42-3.58-8-8-8"
        strokeDasharray="2 2"
        style={{ opacity: 0.4 }}
      />
      <path d="M21 13l3-3-3-3" />
    </svg>
  );
}

export function RotateOverlay() {
  return (
    <div className="rotate-phone-overlay">
      <div className="rotate-phone-content">
        <div className="rotate-icon-wrapper">
          <RotatePhoneIcon style={{ width: 64, height: 64 }} />
        </div>
        <h2 className="rotate-title">Rotate to Play</h2>
        <p className="rotate-text">
          Racehorse is best played in landscape so the board and hand fit properly.
        </p>
      </div>
    </div>
  );
}
