import React from 'react';

interface TileRackProps {
  count: number;
  isActive?: boolean;
  variant?: 'default' | 'ghost';
}

export default function TileRack({
  count,
  isActive = false,
  variant = 'default',
}: TileRackProps) {
  const tileW = 18;
  const tileH = 28;
  const gap = 3;

  const tileStyle: React.CSSProperties = {
    width: tileW,
    height: tileH,
    borderRadius: 2,
    background:
      variant === 'ghost'
        ? 'linear-gradient(180deg, rgba(213,216,232,0.18), rgba(140,146,170,0.1))'
        : 'rgba(255,255,255,0.10)',
    border:
      variant === 'ghost'
        ? '1px solid rgba(206, 205, 240, 0.26)'
        : '1px solid rgba(255,255,255,0.28)',
    boxShadow: isActive
      ? variant === 'ghost'
        ? '0 0 10px rgba(180, 157, 255, 0.22)'
        : '0 0 3px rgba(61,220,151,0.35)'
      : '0 1px 2px rgba(0,0,0,0.35)',
    flexShrink: 0,
    position: 'relative',
    opacity: variant === 'ghost' ? 0.75 : 1,
  };

  const dividerStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '25%',
    bottom: '25%',
    width: 1,
    background: variant === 'ghost' ? 'rgba(231, 226, 255, 0.22)' : 'rgba(255,255,255,0.22)',
    transform: 'translateX(-50%)',
  };

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'row',
      gap: gap,
      alignItems: 'center',
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={tileStyle}>
          <div style={dividerStyle} />
        </div>
      ))}
    </div>
  );
}
