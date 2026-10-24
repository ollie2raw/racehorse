/**
 * Landscape rack tile sizing, shared by Play vs Fritz / Daily Fritz (useMatchPresentation) and multiplayer (MultiplayerGameShell).
 *
 * The old rule capped the tile at a fixed size (60, or 68 in multiplayer) above 900px wide and "fit" it with
 * floor(usableWidth / tiles), which treats a tile's WHOLE width as its pip-half width, about twice too big, so the fit never
 * bound: at 920-980px a normal 7-tile hand rendered 126px tiles, 954px of rack in an 820px tray (tile 0 at x=-15), while at 900px
 * the same hand was 90px tiles. This solves the real inequality instead, per row:
 *
 *   perRow * (2 * half + CHROME) * zoom + (perRow - 1) * gap <= available
 *
 * and, on the web build, ramps the cap from the phone size to the desktop size across 900-1000px instead of stepping at 900.
 * The installed app keeps its caps exactly (its tiles already fit; the fit only matters if a hand ever would not).
 */

/** A rack tile is `2 * half + 6` wide (3px border each side) and `half + 4` tall, before any CSS zoom. */
export const RACK_TILE_CHROME = 6;
/** Phone landscape (<= 900px wide) cap, shared with the native shell. */
export const RACK_PHONE_HALF_WIDTH = 42;
/** Web: the cap ramps linearly from the phone size at RAMP_START to the desktop size at RAMP_START + RAMP_SPAN. */
export const RACK_RAMP_START = 900;
export const RACK_RAMP_SPAN = 100;
const MIN_HALF_WIDTH = 24;
const FALLBACK_GAP = 10;

export interface RackCaps {
  /** Desktop cap for a hand of up to 9 tiles. */
  few: number;
  /** Desktop cap for a hand of more than 9 tiles (two rows). */
  many: number;
}

export interface RackSizingInput {
  tileCount: number;
  /** Most tiles one row holds before the layout wraps to two rows (the same limit the hand layout uses). */
  rowLimit: number;
  innerWidth: number;
  isNative: boolean;
  /** Width of the tray the rows sit in (does not depend on the tiles), in CSS px. */
  availableWidth: number;
  /** Horizontal gap between tiles in a row, in CSS px. */
  gap: number;
  /** CSS zoom applied to rack tiles (0.82 on compact phones, else 1). */
  zoom: number;
  caps: RackCaps;
}

/** Cap for a landscape rack: phone size at <= 900, then the desktop size (ramped on web, stepped in the native shell). */
export function rackTileCap(input: Pick<RackSizingInput, 'tileCount' | 'innerWidth' | 'isNative' | 'caps'>): number {
  const { tileCount, innerWidth, isNative, caps } = input;
  if (innerWidth <= RACK_RAMP_START) return RACK_PHONE_HALF_WIDTH;
  const target = tileCount > 9 ? caps.many : caps.few;
  if (isNative) return target;
  const ramp = RACK_PHONE_HALF_WIDTH + ((innerWidth - RACK_RAMP_START) * (target - RACK_PHONE_HALF_WIDTH)) / RACK_RAMP_SPAN;
  return Math.min(target, Math.round(ramp));
}

/** Largest pip-half width at which `perRow` tiles fit `availableWidth`. */
export function rackFitHalfWidth(perRow: number, availableWidth: number, gap: number, zoom: number): number {
  const outer = (availableWidth - Math.max(0, perRow - 1) * gap) / perRow;
  return Math.floor((outer / zoom - RACK_TILE_CHROME) / 2);
}

/** Pip-half width of a landscape rack tile (the value `<DominoTile size>` takes). */
export function resolveLandscapeRackHalfWidth(input: RackSizingInput): number {
  const perRow = input.tileCount > input.rowLimit ? Math.ceil(input.tileCount / 2) : Math.max(1, input.tileCount);
  const fit = rackFitHalfWidth(perRow, input.availableWidth, input.gap, input.zoom);
  return Math.max(MIN_HALF_WIDTH, Math.min(rackTileCap(input), fit));
}

export interface RackMeasure {
  availableWidth: number;
  gap: number;
  zoom: number;
}

/**
 * Reads the live rack: the tray width, the row gap and the tile zoom. `root` is any element that contains the tray
 * (`.tray-center`); falls back to the viewport when the rack has not rendered yet.
 */
export function measureRack(root: Element | null | undefined, fallbackWidth: number): RackMeasure {
  const tray = root instanceof HTMLElement && root.classList.contains('tray-center')
    ? root
    : root?.querySelector<HTMLElement>('.tray-center') ?? null;
  const row = (tray ?? root)?.querySelector<HTMLElement>('.hand-row') ?? null;
  const tile = row?.querySelector<HTMLElement>('.domino-tile') ?? null;
  const gap = row ? Number.parseFloat(getComputedStyle(row).columnGap) : Number.NaN;
  const zoom = tile ? Number.parseFloat(getComputedStyle(tile).zoom) : Number.NaN;
  return {
    availableWidth: tray?.clientWidth || fallbackWidth,
    gap: Number.isFinite(gap) ? gap : FALLBACK_GAP,
    zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 1,
  };
}

/** The installed Capacitor app marks `<html class="rh-native">` (main.tsx). */
export function isNativeShell(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('rh-native');
}
