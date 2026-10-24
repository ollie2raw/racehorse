import { useState } from 'react';
import type { Tile } from '../../types';

export const publicTileIdentity = (tile: Tile) => `${Math.min(tile.low, tile.high)}-${Math.max(tile.low, tile.high)}`;

/** Only one incremental public tile qualifies. Hydration, replacement and batching are silent. */
export function incrementalTile(previous: string[], current: string[]): string | null {
  if (current.length !== previous.length + 1) return null;
  const old = new Set(previous);
  const next = new Set(current);
  if (previous.some((id) => !next.has(id))) return null;
  return current.find((id) => !old.has(id)) ?? null;
}

export function usePlacementFeedback(tiles: Tile[], handNumber: number, enabled: boolean) {
  const ids = tiles.map(publicTileIdentity).sort();
  const signature = ids.join('|');
  const [observed, setObserved] = useState({ ids, signature, handNumber, enabled, arrival: null as string | null });
  if (observed.signature !== signature || observed.handNumber !== handNumber || observed.enabled !== enabled) {
    setObserved({
      ids, signature, handNumber, enabled,
      arrival: enabled && observed.enabled && observed.handNumber === handNumber
        ? incrementalTile(observed.ids, ids)
        : null,
    });
  }
  return enabled ? observed.arrival : null;
}
