import { useEffect, useState } from 'react';

export type ResponsiveHandTileSize = {
  handTileSize: number;
  handCompactStacked: boolean;
};

export function computeResponsiveHandTileSize(
  handLength: number,
  innerWidth: number,
  innerHeight: number,
): ResponsiveHandTileSize {
  const tileCount = Math.max(1, handLength);
  const isLandscape = innerWidth > innerHeight;
  const isMobileWidth = innerWidth <= 900;
  const forceTwoRows = !isLandscape && isMobileWidth && tileCount > 7;
  const maxTileSize = 56;
  const containerWidth = innerWidth - 40;
  const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
  const handTileSize = Math.min(maxTileSize, Math.floor((containerWidth - 20) / effectiveLen));
  return { handTileSize, handCompactStacked: forceTwoRows };
}

/**
 * Responsive hand-dock tile sizing for Daily Puzzle play screens.
 * Pass `undefined` when runtime state is absent (matches prior `if (!runtimeState) return` guard).
 */
export function useResponsiveHandTileSize(handLength: number | undefined): ResponsiveHandTileSize {
  const [handTileSize, setHandTileSize] = useState(56);
  const [handCompactStacked, setHandCompactStacked] = useState(false);

  useEffect(() => {
    if (handLength === undefined) return;
    const updateHandTileSize = () => {
      const { handTileSize: tileWidth, handCompactStacked: forceTwoRows } = computeResponsiveHandTileSize(
        handLength,
        window.innerWidth,
        window.innerHeight,
      );
      setHandTileSize(tileWidth);
      setHandCompactStacked(forceTwoRows);
    };
    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [handLength]);

  return { handTileSize, handCompactStacked };
}