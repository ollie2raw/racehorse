// client/src/components/handDrag/tileDragGesture.ts
//
// The decisions behind dragging a tile from the hand onto the board, as pure functions: when a
// press becomes a drag, and which drop zone a pointer position means. No DOM, no React, so the
// rules are unit-tested (useTileDrag.ts is the thin DOM layer that applies them).
import type { PlacementPosition } from '../../types';

/** Movement before a press is a drag rather than a tap. */
export const DRAG_START_PX = 8;

/**
 * How far outside a drop zone's rectangle a release still counts as dropping on it. A zone is a
 * tile-sized target on a board that can be scaled down to ~0.2 on a phone, and a thumb is ~44 px:
 * requiring a pixel-exact release would make drag worse than tapping.
 */
export const ZONE_SLOP_PX = 28;

/**
 * A touch drag that starts sideways is the player scrolling the rack, not placing a tile. Mouse and
 * pen drags have no scrolling to compete with, so any direction starts a drag.
 */
export type PointerKind = 'mouse' | 'touch' | 'pen';
export type DragIntent = 'pending' | 'drag' | 'abandon';

export function dragIntent(dx: number, dy: number, kind: PointerKind): DragIntent {
  if (Math.hypot(dx, dy) < DRAG_START_PX) return 'pending';
  if (kind === 'touch' && Math.abs(dx) > Math.abs(dy)) return 'abandon';
  return 'drag';
}

export interface DropZoneRect {
  position: PlacementPosition;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function distanceToRect(zone: DropZoneRect, x: number, y: number): number {
  const dx = Math.max(zone.left - x, 0, x - zone.right);
  const dy = Math.max(zone.top - y, 0, y - zone.bottom);
  return Math.hypot(dx, dy);
}

/**
 * The zone a pointer at (x, y) means: the nearest zone within `slopPx` of its rectangle. A pointer
 * inside a zone is distance 0; among zones the pointer is equally "inside" (overlapping zones),
 * the one whose centre is nearest wins.
 */
export function pickDropZone(
  zones: readonly DropZoneRect[],
  x: number,
  y: number,
  slopPx: number = ZONE_SLOP_PX,
): PlacementPosition | null {
  let best: { position: PlacementPosition; edge: number; centre: number } | null = null;
  for (const zone of zones) {
    const edge = distanceToRect(zone, x, y);
    if (edge > slopPx) continue;
    const centre = Math.hypot((zone.left + zone.right) / 2 - x, (zone.top + zone.bottom) / 2 - y);
    if (!best || edge < best.edge || (edge === best.edge && centre < best.centre)) {
      best = { position: zone.position, edge, centre };
    }
  }
  return best ? best.position : null;
}
