// client/src/components/board/useBoardWorldFrame.ts
//
// React side of boardWorldFrame.ts: keeps the render origin across layouts. Derived state
// (adjust-state-during-render) rather than a ref write, so it is safe under StrictMode and
// concurrent rendering: the same (layout, resetSignature) always yields the same origin.
import { useState } from 'react';
import { advanceWorldOrigin, boundsCenter, type WorldOrigin } from './boardWorldFrame';
import type { BoardLayout } from './boardLayoutTypes';

interface FrameState {
  layout: BoardLayout;
  resetSignature: string;
  origin: WorldOrigin;
}

/**
 * The origin tiles are positioned against. Static boards (lessons, diagrams, review snapshots)
 * keep the bounds centre, exactly as before.
 */
export function useBoardWorldFrame(layout: BoardLayout, resetSignature: string, staticView: boolean): WorldOrigin {
  const [frame, setFrame] = useState<FrameState>(() => ({ layout, resetSignature, origin: boundsCenter(layout) }));
  if (staticView) return boundsCenter(layout);
  if (frame.layout === layout && frame.resetSignature === resetSignature) return frame.origin;
  // A new hand (or board reset) starts a fresh frame; otherwise the frame follows the tiles.
  const origin =
    frame.resetSignature !== resetSignature
      ? boundsCenter(layout)
      : advanceWorldOrigin(frame.layout, frame.origin, layout);
  setFrame({ layout, resetSignature, origin });
  return origin;
}
