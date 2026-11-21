// client/src/components/board/boardCameraComfort.ts
//
// The comfort test behind camera policy B (config/boardCameraPolicy.ts). Pure, and built on the same geometry the fit uses (layout bounds in
// layout units, the world-frame offset the camera carries, the reserved-overlay check), so both policies share one description of the board.
import { touchesReserved } from './boardCameraReserve';
import type { ReservedRect } from './boardCameraReserve';
import type { BoardLayout } from './boardLayout';

/**
 * The padded bounds must stay this far inside every edge of the container (share of each side). The layout's own padding (2.5 units, or the exact
 * drop-zone envelope on phones) is inside the bounds, so "comfortable" already leaves room for a placement zone at each end. Initial experimental value.
 */
export const COMFORT_INSET = 0.03;

export interface ComfortInput {
  layout: Pick<BoardLayout, 'tiles' | 'minX' | 'maxX' | 'minY' | 'maxY' | 'dropZoneFootprints'>;
  /** How far the bounds centre sits from the world origin tiles are positioned against, in layout units (the camera carries it). */
  worldOffsetUnits: { x: number; y: number };
  /** The camera as it is: screen = container centre + camera + scale * (tile - origin) * unitPx. */
  camera: { x: number; y: number; scale: number };
  unitPx: number;
  containerWidth: number;
  containerHeight: number;
  /** Overlays the board must not run under (tray, corner pills), container-local px. Empty when the fit does not clear them. */
  reserved: readonly ReservedRect[];
  inset?: number;
}

/** True when the camera, left exactly as it is, shows the whole padded board inside the comfort zone and clear of every overlay. */
export function isBoardComfortable(input: ComfortInput): boolean {
  const { layout, worldOffsetUnits, camera, unitPx, containerWidth, containerHeight, reserved, inset = COMFORT_INSET } = input;
  if (!(containerWidth > 0 && containerHeight > 0 && camera.scale > 0)) return false;
  const halfW = (layout.maxX - layout.minX) / 2;
  const halfH = (layout.maxY - layout.minY) / 2;
  const px = camera.scale * unitPx;
  // Bounds centre on screen, relative to the container centre.
  const cx = camera.x + px * worldOffsetUnits.x;
  const cy = camera.y + px * worldOffsetUnits.y;
  const limitX = (containerWidth / 2) * (1 - 2 * inset);
  const limitY = (containerHeight / 2) * (1 - 2 * inset);
  if (cx - px * halfW < -limitX || cx + px * halfW > limitX || cy - px * halfH < -limitY || cy + px * halfH > limitY) return false;
  if (reserved.length === 0) return true;
  return !touchesReserved(
    { layout, unitPx, containerWidth, containerHeight, cameraX: cx, cameraY: cy, fitScale: camera.scale, minScale: camera.scale, reserved },
    camera.scale,
  );
}
