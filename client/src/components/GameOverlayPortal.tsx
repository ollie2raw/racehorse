import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface GameOverlayPortalProps {
  children: ReactNode;
}

/**
 * Game overlays must be portaled/fixed outside the match layout so they never reflow the rack.
 * Direct children of `.screen.game-screen.walnut-live` are forced to `position: relative` for
 * z-index stacking; portaling avoids that rule and keeps overlays out of the board/tray flex column.
 */
export function GameOverlayPortal({ children }: GameOverlayPortalProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
