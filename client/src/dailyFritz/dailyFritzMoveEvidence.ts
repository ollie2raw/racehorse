import type { MoveEntry, TileTuple } from '../game/moveLogger.ts';

function normalizedTileKey(tile: TileTuple): string {
  const low = Math.min(tile[0], tile[1]);
  const high = Math.max(tile[0], tile[1]);
  return `${low}|${high}`;
}

function placementKey(
  entry: Pick<MoveEntry, 'action' | 'player' | 'tile'>,
  handNumber: number,
): string | null {
  if (entry.action !== 'place' || !entry.tile) return null;
  return `${handNumber}:${entry.player}:${normalizedTileKey(entry.tile)}`;
}

/**
 * A double-six deal contains one physical copy of each tile. The same actor
 * therefore cannot legitimately place the same tile twice in one hand.
 *
 * This is deliberately narrower than general replay de-duplication: draws and
 * passes can repeat, and the same tile is valid again in a later hand.
 */
export function isDuplicateDailyFritzPlacement(
  moveLog: readonly MoveEntry[],
  entry: Pick<MoveEntry, 'action' | 'player' | 'tile'>,
  handNumber: number,
): boolean {
  const candidateKey = placementKey(entry, handNumber);
  if (!candidateKey) return false;
  return moveLog.some((existing) =>
    existing.handNumber === handNumber
    && placementKey(existing, handNumber) === candidateKey
  );
}

/** Defense in depth for resumed/legacy logs captured before source de-duplication. */
export function canonicalizeDailyFritzMoveLog(
  moveLog: readonly MoveEntry[],
): MoveEntry[] {
  const seenPlacements = new Set<string>();
  const canonical: MoveEntry[] = [];

  // Persisted checkpoints can be assembled from more than one synchronous
  // capture path. Move numbers are the recorder's ordering authority; never
  // make the verifier infer turn order from array insertion order.
  const orderedMoveLog = [...moveLog].sort((a, b) => a.moveNumber - b.moveNumber);
  for (const entry of orderedMoveLog) {
    const handNumber = entry.handNumber;
    const key = typeof handNumber === 'number'
      ? placementKey(entry, handNumber)
      : null;
    if (key && seenPlacements.has(key)) continue;
    if (key) seenPlacements.add(key);
    canonical.push(entry);
  }

  return canonical;
}
