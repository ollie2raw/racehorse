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

function samePreActionEvidence(
  left: Pick<MoveEntry, 'action' | 'player' | 'handBefore' | 'boardEnds' | 'boardState'>,
  right: Pick<MoveEntry, 'action' | 'player' | 'handBefore' | 'boardEnds' | 'boardState'>,
): boolean {
  // Empty/default snapshots are legacy "evidence unavailable" values, not
  // proof that two actions came from one physical pre-action state. A real
  // draw/pass always starts with tiles in the acting hand.
  return left.handBefore.length > 0
    && right.handBefore.length > 0
    && left.action === right.action
    && left.player === right.player
    && JSON.stringify(left.handBefore) === JSON.stringify(right.handBefore)
    && JSON.stringify(left.boardEnds) === JSON.stringify(right.boardEnds)
    && JSON.stringify(left.boardState) === JSON.stringify(right.boardState);
}

/**
 * Exact-once guard for recorder evidence. Placements are keyed by their
 * physical tile. Draw/pass actions may legitimately repeat, so only reject an
 * immediately repeated action captured from the exact same pre-action state.
 */
export function isDuplicateDailyFritzActionEvidence(
  moveLog: readonly MoveEntry[],
  entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>,
  handNumber: number,
): boolean {
  if (isDuplicateDailyFritzPlacement(moveLog, entry, handNumber)) return true;
  if (entry.action === 'place') return false;
  const previous = moveLog[moveLog.length - 1];
  return Boolean(
    previous
    && previous.handNumber === handNumber
    && samePreActionEvidence(previous, entry),
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
    const previous = canonical[canonical.length - 1];
    if (
      !key
      && typeof handNumber === 'number'
      && previous?.handNumber === handNumber
      && samePreActionEvidence(previous, entry)
    ) continue;
    if (key) seenPlacements.add(key);
    canonical.push(entry);
  }

  return canonical;
}
