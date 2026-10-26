// client/src/components/board/boardCameraReserve.ts
//
// Keep placed tiles clear of the overlays that sit on top of the board container (the
// zoom/controls tray and the corner pills). A fit that only looks at the container is
// fine while the board is small; once the board is allowed to fill the container (short
// phone viewports, boardBounds.ts) its edge tiles can run under an overlay and become
// unreadable or untappable. This picks the largest camera scale, no larger than the fit,
// at which no tile touches an overlay.
//
// Pure: no DOM. `collectReservedRects` is the one DOM-reading helper, kept separate so the
// geometry stays testable.
import type { BoardLayout } from './boardLayoutTypes';

/** Overlays that sit on the board container and must stay clear of tiles. */
export const BOARD_RESERVED_SELECTOR = '.rh-board-controls, .board-corner-pill';

/** A rectangle in container-local pixels. */
export interface ReservedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Gap kept between a tile edge and an overlay, in px. */
export const RESERVED_CLEARANCE_PX = 4;

export function collectReservedRects(container: HTMLElement): ReservedRect[] {
  const box = container.getBoundingClientRect();
  const scope = container.closest('.screen') ?? document;
  const rects: ReservedRect[] = [];
  for (const el of scope.querySelectorAll(BOARD_RESERVED_SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const local = { left: r.left - box.left, top: r.top - box.top, right: r.right - box.left, bottom: r.bottom - box.top };
    // Only overlays that actually sit over the container matter.
    if (local.right <= 0 || local.bottom <= 0 || local.left >= box.width || local.top >= box.height) continue;
    rects.push(local);
  }
  return rects;
}

export interface ClearScaleInput {
  layout: Pick<BoardLayout, 'tiles' | 'minX' | 'maxX' | 'minY' | 'maxY'>;
  /** Pixels per layout unit at camera scale 1. */
  unitPx: number;
  containerWidth: number;
  containerHeight: number;
  cameraX: number;
  cameraY: number;
  /** The scale the fit wants. */
  fitScale: number;
  /** The camera floor: never go below it, even if a tile cannot be cleared. */
  minScale: number;
  reserved: readonly ReservedRect[];
  clearancePx?: number;
}

function tilesTouchReserved(input: ClearScaleInput, scale: number): boolean {
  const { layout, unitPx, containerWidth, containerHeight, cameraX, cameraY, reserved } = input;
  const clearance = input.clearancePx ?? RESERVED_CLEARANCE_PX;
  const layoutCx = (layout.minX + layout.maxX) / 2;
  const layoutCy = (layout.minY + layout.maxY) / 2;
  for (const tile of layout.tiles) {
    // rotation 0 lies along x for every tile, doubles included.
    const halfW = (tile.rotation === 0 ? 1 : 0.5) * unitPx * scale;
    const halfH = (tile.rotation === 0 ? 0.5 : 1) * unitPx * scale;
    const cx = containerWidth / 2 + (tile.x - layoutCx) * unitPx * scale + cameraX;
    const cy = containerHeight / 2 + (tile.y - layoutCy) * unitPx * scale + cameraY;
    for (const r of reserved) {
      if (
        cx + halfW + clearance > r.left &&
        cx - halfW - clearance < r.right &&
        cy + halfH + clearance > r.top &&
        cy - halfH - clearance < r.bottom
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Largest scale in [minScale, fitScale] at which no tile touches a reserved rect. */
export function clearScaleForReserved(input: ClearScaleInput): number {
  const { fitScale, minScale, reserved } = input;
  if (reserved.length === 0 || !tilesTouchReserved(input, fitScale)) return fitScale;
  if (tilesTouchReserved(input, minScale)) return minScale;
  // Shrinking toward the centre only pulls tiles away from the edges, so touching is monotonic in scale.
  let lo = minScale;
  let hi = fitScale;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    if (tilesTouchReserved(input, mid)) hi = mid;
    else lo = mid;
  }
  return lo;
}
