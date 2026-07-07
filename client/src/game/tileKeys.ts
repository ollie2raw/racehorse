import type { Tile } from '../types.ts';

function normalizeTileKey(value: string): string {
  const [aRaw, bRaw] = value.split('|');
  const a = Number(aRaw);
  const b = Number(bRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return value;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return `${low}|${high}`;
}

export function toTileKey(tile: Tile): string {
  return normalizeTileKey(`${tile.low}|${tile.high}`);
}

export function parseTileKey(value: string): Tile | null {
  const normalized = normalizeTileKey(value);
  const [lowRaw, highRaw] = normalized.split('|');
  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
}