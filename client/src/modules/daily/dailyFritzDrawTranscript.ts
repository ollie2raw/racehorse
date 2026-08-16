/**
 * Daily Fritz server verification expects one transcript action per drawn tile.
 * Non-Daily modes keep a single collapsed draw entry for move-log UX.
 */
export function resolveTranscriptDrawLogCount(
  isDailyFritzMode: boolean,
  drawCount: number,
): number {
  if (drawCount <= 0) return 0;
  return isDailyFritzMode ? drawCount : 1;
}

/**
 * Caps the number of 'draw' MoveEntries actually appended to the log at the
 * number of real, positively-observed per-step snapshots available.
 *
 * `drawCount` (fed into resolveTranscriptDrawLogCount) is deliberately
 * corrected UPWARD from a boneyard-length delta to guard against an
 * interrupted draw sequence under-reporting via its onStep callback — but
 * that correction has no matching per-step snapshot to log if it pushes the
 * count past how many onStep-confirmed draws actually happened.
 * Iterating past `drawSnapshotCount` would fabricate additional 'draw'
 * MoveEntries backed by a stale (pre-draw) snapshot instead of a real
 * drawOne() call.
 *
 * That matters specifically for Daily Fritz: its server-side verifier
 * replays the transcript action-by-action and self-heals MISSING draws
 * before a later action (server/src/dailyFritzVerifier.ts's
 * applyOmittedMandatoryDraws), but has no equivalent recovery for an
 * EXTRA/duplicate draw action — that one is replayed as a real draw command
 * and rejected outright once canDraw is false, producing an unrecoverable
 * 'illegal_action' / "Draw is not legal" verifier rejection (the
 * stuck-Hand-Over failure this guards against). So under-reporting is
 * always the safe direction to err on for Daily Fritz; non-Daily modes
 * don't need this cap since resolveTranscriptDrawLogCount already collapses
 * them to at most 1 collapsed entry and there is no server-side replay to
 * diverge from.
 */
export function capDailyFritzDrawLogCount(
  isDailyFritzMode: boolean,
  drawLogCount: number,
  drawSnapshotCount: number,
): number {
  return isDailyFritzMode ? Math.min(drawLogCount, drawSnapshotCount) : drawLogCount;
}
