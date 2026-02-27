import React from 'react';

interface TileRackProps {
  count: number;
  isActive?: boolean;
}

export default function TileRack({ count, isActive = false }: TileRackProps) {
  const tileW = 18;
  const tileH = 28;
  const gap = 3;

  const tileStyle: React.CSSProperties = {
    width: tileW,
    height: tileH,
    borderRadius: 2,
    background: 'rgba(255,255,255,0.10)',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: isActive
      ? '0 0 3px rgba(61,220,151,0.35)'
      : '0 1px 2px rgba(0,0,0,0.35)',
    flexShrink: 0,
    position: 'relative',
  };

  const dividerStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '25%',
    bottom: '25%',
    width: 1,
    background: 'rgba(255,255,255,0.22)',
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
