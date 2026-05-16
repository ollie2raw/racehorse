import type { MatchedPair, QueuedPlayer } from './types';

function pairingDebugEnabled(): boolean {
  return process.env.MATCHMAKING_DEBUG === '1';
}

/**
 * Half-width of the rating window for a player who has waited `waitedMs`.
 * Production schedule (per-player queue time):
 * - 0–15s:  ±150
 * - 15–30s: ±300
 * - 30–60s: ±500
 * - 60s+:   ±Infinity
 */
export function ratingWindowMsAt(waitedMs: number): number {
  if (waitedMs >= 60_000) return Infinity;
  if (waitedMs >= 30_000) return 500;
  if (waitedMs >= 15_000) return 300;
  return 150;
}

/**
 * Greedy matching: the longest-waiting player picks the closest-rated peer
 * whose rating delta is inside the tighter of the two players' windows.
 * Repeats until no further pairs are formable.
 *
 * Pure function — does not mutate `players`.
 */
export function findPairs(players: QueuedPlayer[], nowMs: number): MatchedPair[] {
  const sorted = [...players].sort((a, b) => a.joinedAtMs - b.joinedAtMs);
  const used = new Set<string>();
  const pairs: MatchedPair[] = [];
  const debug = pairingDebugEnabled();

  for (const a of sorted) {
    if (used.has(a.socketId)) continue;
    const aWindow = ratingWindowMsAt(nowMs - a.joinedAtMs);
    let best: QueuedPlayer | null = null;
    let bestDelta = Infinity;

    for (const b of sorted) {
      if (b.socketId === a.socketId) continue;
      if (used.has(b.socketId)) continue;
      if (a.userId === b.userId) continue;
      const bWindow = ratingWindowMsAt(nowMs - b.joinedAtMs);
      const allowed = Math.min(aWindow, bWindow);
      const delta = Math.abs(a.rating - b.rating);
      let reject: string | null = null;
      if (delta > allowed) reject = `delta ${delta} > allowed ${allowed}`;
      else if (!(delta < bestDelta)) reject = `delta ${delta} not better than best ${bestDelta}`;

      if (debug) {
        console.log('[matchmaking][debug] candidate', {
          seeker: { socketId: a.socketId, userId: a.userId, rating: a.rating, waitedMs: nowMs - a.joinedAtMs, window: aWindow },
          candidate: { socketId: b.socketId, userId: b.userId, rating: b.rating, waitedMs: nowMs - b.joinedAtMs, window: bWindow },
          allowedMinWindow: allowed,
          ratingDelta: delta,
          decision: reject ? `reject: ${reject}` : 'eligible',
        });
      }

      if (delta <= allowed && delta < bestDelta) {
        best = b;
        bestDelta = delta;
      }
    }

    if (best) {
      if (debug) {
        console.log('[matchmaking][debug] matched pair', {
          a: { socketId: a.socketId, userId: a.userId, rating: a.rating },
          b: { socketId: best.socketId, userId: best.userId, rating: best.rating },
          ratingDelta: bestDelta,
        });
      }
      used.add(a.socketId);
      used.add(best.socketId);
      pairs.push({ a, b: best, matchedAtMs: nowMs, ratingDelta: bestDelta });
    } else if (debug && sorted.length > 1) {
      console.log('[matchmaking][debug] no partner for seeker', {
        socketId: a.socketId,
        userId: a.userId,
        rating: a.rating,
        waitedMs: nowMs - a.joinedAtMs,
        window: aWindow,
        queueSize: sorted.length,
      });
    }
  }

  return pairs;
}
