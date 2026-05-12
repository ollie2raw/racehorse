import React from 'react';

interface BrandLogoProps {
  className?: string;
  iconSize?: number;
  showWordmark?: boolean;
  borderColor?: string;
}

export function BrandLogo({
  className = '',
  iconSize = 44,
  showWordmark = true,
  borderColor,
}: BrandLogoProps) {
  // Reference sizes from the high-fidelity design
  const refIconSize = 44;
  const refBoxSize = 60;
  const refMainFont = 28;
  const refGap = 14;

  // Scale factors
  const ratio = iconSize / refIconSize;
  const boxSize = refBoxSize * ratio;
  const mainFontSize = refMainFont * ratio;
  const gap = refGap * ratio;

  const finalBorderColor = borderColor || '#C8922A99'; // default to 60% opacity brass
  const shadowColor = borderColor ? `${borderColor}22` : 'rgba(200,146,42,0.1)';

  return (
    <div className={`flex items-center ${className}`} style={{ gap }}>
      {/* Icon Container */}
      <div 
        className="flex items-center justify-center rounded-[13px] bg-[linear-gradient(155deg,#121317_0%,#08090D_100%)]"
        style={{ 
          width: boxSize, 
          height: boxSize,
          borderRadius: Math.round(13 * ratio),
          border: `1px solid ${finalBorderColor}`,
          boxShadow: `0 0 14px ${shadowColor}, inset 0 1px 0 rgba(255,255,255,0.04)`
        }}
      >
        <img 
          src="/brand_logo.png" 
          alt="Racehorse Logo"
          style={{ width: iconSize, height: iconSize, objectFit: 'contain' }}
        />
      </div>

      {/* Wordmark */}
      {showWordmark && (
        <div className="flex flex-col justify-center">
          <div 
            className="font-black leading-none tracking-[0.04em] text-[#F5F2EC] uppercase"
            style={{ 
              fontSize: mainFontSize,
              fontFamily: "'Outfit', system-ui, sans-serif"
            }}
          >
            RACEHORSE
          </div>
        </div>
      )}
    </div>
  );
}
