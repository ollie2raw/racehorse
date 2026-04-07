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
  const visibleCount = count;
  const tileW = 20;
  const tileH = 32;
  const gap = 4;

  const tileStyle: React.CSSProperties = {
    width: tileW,
    height: tileH,
    borderRadius: 4,
    background:
      variant === 'ghost'
        ? 'linear-gradient(180deg, rgba(250,248,255,0.92), rgba(222,216,244,0.86))'
        : 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,236,228,0.94))',
    border:
      variant === 'ghost'
        ? '1px solid rgba(221, 212, 255, 0.68)'
        : '1px solid rgba(255,255,255,0.88)',
    boxShadow: isActive
      ? variant === 'ghost'
        ? '0 0 16px rgba(180, 157, 255, 0.26), 0 4px 10px rgba(0,0,0,0.24)'
        : '0 0 12px rgba(61,220,151,0.22), 0 4px 10px rgba(0,0,0,0.22)'
      : '0 3px 8px rgba(0,0,0,0.28)',
    flexShrink: 0,
    position: 'relative',
    opacity: variant === 'ghost' ? 0.92 : 1,
  };

  return (
    <div style={{
      display: 'inline-flex',
      flexDirection: 'row',
      gap: gap,
      alignItems: 'center',
    }}>
      {Array.from({ length: visibleCount }).map((_, i) => (
        <div key={i} style={tileStyle} />
      ))}
    </div>
  );
}
