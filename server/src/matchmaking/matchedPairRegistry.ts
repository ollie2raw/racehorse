import type { QueuedPlayer } from './types';

/**
 * The queue entries a matchmaking room was created for, kept only until the
 * match actually deals. It is what lets a *later* failure (M6 socket-sync
 * timeout) reuse the M1 abort path — requeue at the real ratings instead of
 * reconstructing an approximation from the room roster.
 *
 * Deliberately a standalone module: `matchmaking/index` (writer) and
 * `reservedRoomCleanup` (reaper) both need it, and neither may import the other.
 */
const matchedPairsByRoomCode = new Map<string, [QueuedPlayer, QueuedPlayer]>();

function normalize(roomCode: string): string {
  return String(roomCode ?? '').trim().toUpperCase();
}

export function recordMatchedPair(roomCode: string, a: QueuedPlayer, b: QueuedPlayer): void {
  const code = normalize(roomCode);
  if (!code) return;
  matchedPairsByRoomCode.set(code, [a, b]);
}

export function getMatchedPair(roomCode: string): [QueuedPlayer, QueuedPlayer] | undefined {
  return matchedPairsByRoomCode.get(normalize(roomCode));
}

export function clearMatchedPair(roomCode: string): void {
  matchedPairsByRoomCode.delete(normalize(roomCode));
}

export function getTrackedMatchedPairRoomCodesForTests(): string[] {
  return [...matchedPairsByRoomCode.keys()];
}

export function resetMatchedPairsForTests(): void {
  matchedPairsByRoomCode.clear();
}
