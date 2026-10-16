import type { Room } from '../rooms';

export const STALE_MATCH_ERROR = 'stale_match';

/**
 * Optional generation binding for client commands. A client that knows which match (room generation)
 * a command was composed for may send `matchId`; if the room has since moved to another match
 * (rematch / replacement session) the command is refused instead of landing in the new game.
 * Absent or non-string values keep the legacy behavior (state legality + seat ownership only).
 */
export const MATCH_ID_REQUIRED_ERROR = 'match_id_required';

/**
 * Rollout switch. Off (default) = a missing `matchId` is accepted so already-deployed clients keep
 * working; once every supported client binds its commands, set COMMAND_MATCH_ID_REQUIRED=true and
 * unbound match-scoped commands fail closed. A PRESENT matchId is always compared.
 */
function matchIdRequired(): boolean {
  return process.env.COMMAND_MATCH_ID_REQUIRED === 'true';
}

export function staleMatchAck(room: Pick<Room, 'matchId'>, claimed: unknown): { ok: false; error: string; stale: true; matchId: string } | null {
  if (typeof claimed !== 'string' || !claimed) {
    return matchIdRequired() ? { ok: false, error: MATCH_ID_REQUIRED_ERROR, stale: true, matchId: room.matchId } : null;
  }
  if (claimed === room.matchId) return null;
  return { ok: false, error: STALE_MATCH_ERROR, stale: true, matchId: room.matchId };
}

export type CommandRejectionCode =
  | 'malformed'
  | 'unauthorized'
  | 'stale_match'
  | 'request_id_conflict'
  | 'not_active'
  | 'illegal'
  | 'internal_error';

const INTERNAL_DETAIL = /(supabase|postgres|postgrest|fetch failed|\becONN|\betimedout|\bat\s+\S+\s+\(|node_modules|\/home\/|\.ts:\d+|room_live_sessions|jwt)/i;

/**
 * Machine-readable category for a rejected gameplay command, so a client can reconcile (reload on
 * `stale_match`/`not_active`, stop retrying on `request_id_conflict`) without parsing prose. Messages
 * that expose infrastructure detail are replaced by a generic one.
 */
export function classifyCommandError(message: string): { code: CommandRejectionCode; error: string } {
  if (INTERNAL_DETAIL.test(message)) return { code: 'internal_error', error: 'Action failed. Please retry.' };
  const m = message.toLowerCase();
  if (/spectator|seat not found|not in room|player not in/.test(m)) return { code: 'unauthorized', error: message };
  if (/room not found|game not started|game is over|match_abandoned|match_completed|tournament_forfeit|waiting for next hand|hand is over|persistence_failed|room_degraded|reconnect_unavailable|_blocked|paused/.test(m)) {
    return { code: 'not_active', error: message };
  }
  if (/invalid|unknown action|missing action|malformed/.test(m)) return { code: 'malformed', error: message };
  return { code: 'illegal', error: message };
}

const MAX_PIP = 12; // largest supported domino set is double-twelve; legality is the engine's job

/** Shape-only gate for a `game:action` payload so type errors never reach (or leak from) the engine. */
export function isWellFormedGameAction(action: unknown): boolean {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return false;
  const a = action as { type?: unknown; move?: unknown };
  if (a.type !== 'MOVE') return a.type === 'DRAW' || a.type === 'PASS';
  const move = a.move;
  if (!move || typeof move !== 'object' || Array.isArray(move)) return false;
  const m = move as { tile?: unknown; position?: unknown; end?: unknown };
  const tile = m.tile;
  if (!tile || typeof tile !== 'object' || Array.isArray(tile)) return false;
  const t = tile as { high?: unknown; low?: unknown };
  for (const pip of [t.high, t.low]) {
    if (typeof pip !== 'number' || !Number.isInteger(pip) || pip < 0 || pip > MAX_PIP) return false;
  }
  for (const where of [m.position, m.end]) {
    if (where !== undefined && where !== null && (typeof where !== 'string' || where.length > 32)) return false;
  }
  return true;
}
