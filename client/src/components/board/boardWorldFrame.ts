// client/src/components/board/boardWorldFrame.ts
//
// A stable "world frame" for the board. The layout engine anchors coordinates to the main
// line, so adding a tile at one end shifts every other tile's layout coordinates by the same
// vector, and the renderer used to position tiles from the bounds centre, which also changes
// on every placement. The result: on each placement ALL tiles teleported in canvas space at
// the same instant the camera scale snapped.
//
// The fix is to render tiles against an origin that moves WITH the tiles: when the next
// layout is the previous one plus a uniform shift, the origin shifts by that same vector, so
// every placed tile keeps exactly the same canvas position. All recentring then happens in
// the camera transform, where it can be animated.
//
// The uniform shift is the most common displacement among tiles present in both layouts.
// Tiles that genuinely moved (re-routing) are the minority and simply move.
import type { BoardLayout } from './boardLayoutTypes';

export interface WorldOrigin {
  x: number;
  y: number;
}

type FrameLayout = Pick<BoardLayout, 'tiles' | 'minX' | 'maxX' | 'minY' | 'maxY'>;

const BUCKET = 1e-6;

export function boundsCenter(layout: Pick<BoardLayout, 'minX' | 'maxX' | 'minY' | 'maxY'>): WorldOrigin {
  return { x: (layout.minX + layout.maxX) / 2, y: (layout.minY + layout.maxY) / 2 };
}

/** The displacement most surviving tiles share between two layouts, or null if no tile survived. */
export function commonDisplacement(before: FrameLayout, after: FrameLayout): WorldOrigin | null {
  const prev = new Map(before.tiles.map((t) => [t.key, t]));
  const votes = new Map<string, { count: number; dx: number; dy: number }>();
  let best: { count: number; dx: number; dy: number } | null = null;
  for (const t of after.tiles) {
    const old = prev.get(t.key);
    if (!old) continue;
    const dx = t.x - old.x;
    const dy = t.y - old.y;
    const bucket = `${Math.round(dx / BUCKET)}|${Math.round(dy / BUCKET)}`;
    const vote = votes.get(bucket) ?? { count: 0, dx, dy };
    vote.count += 1;
    votes.set(bucket, vote);
    if (!best || vote.count > best.count) best = vote;
  }
  return best ? { x: best.dx, y: best.dy } : null;
}

/**
 * The origin for `next`, given the previous layout and the origin it was rendered against.
 * With no surviving tile (first tile of a hand) the frame starts at the bounds centre, which is
 * exactly what the renderer used before, so the first frame is unchanged.
 */
export function advanceWorldOrigin(before: FrameLayout, origin: WorldOrigin, after: FrameLayout): WorldOrigin {
  const shift = commonDisplacement(before, after);
  if (!shift) return boundsCenter(after);
  return { x: origin.x + shift.x, y: origin.y + shift.y };
}
