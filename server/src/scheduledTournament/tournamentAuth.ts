import type { Request, Response } from 'express';
import type { Socket } from 'socket.io';
import { verifyBearerToken } from '../platform/auth/supabaseAuth';
import { fetchMatchById, fetchMatchByRoomCode, isValidUuid } from './persistence';
import { isTournamentRoomCode } from './tournamentRoomCode';
import type { MatchRow } from './types';

export type TournamentAuthError =
  | 'not_authenticated'
  | 'user_mismatch'
  | 'invalid_user';

/**
 * Resolve user id from a Bearer token (no response side effects).
 * AU-8 (HARDENING_PLAN §6.3): routes through the canonical cached
 * `verifyBearerToken`, then keeps this module's extra `isValidUuid` gate —
 * tournament ids must be UUIDs, and a non-UUID here is treated as unauthenticated.
 */
export async function getUserIdFromBearerToken(token: string | null | undefined): Promise<string | null> {
  const userId = await verifyBearerToken(token ?? null);
  return userId && isValidUuid(userId) ? userId.trim() : null;
}

export async function requireAuthUserId(
  req: Request,
  res: Response,
  opts: { allowAnonymous?: boolean } = {},
): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    if (opts.allowAnonymous) return null;
    res.status(401).json({ ok: false, error: 'not_authenticated' });
    return null;
  }
  const userId = await getUserIdFromBearerToken(token);
  if (!userId) {
    if (opts.allowAnonymous) return null;
    res.status(401).json({ ok: false, error: 'not_authenticated' });
    return null;
  }
  return userId;
}

/** Verified identity from socket handshake / presence:identify. */
export function getSocketUserId(socket: Socket): string | null {
  const raw = socket.data?.userId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!isValidUuid(trimmed)) return null;
  return trimmed;
}

/**
 * When clients still send userId, it must match the authenticated identity.
 * Returns an error code or null if OK (including when payload omits userId).
 */
export function rejectMismatchedPayloadUserId(
  authenticatedUserId: string,
  payloadUserId: unknown,
): TournamentAuthError | null {
  if (payloadUserId === undefined || payloadUserId === null) return null;
  if (typeof payloadUserId !== 'string') return 'invalid_user';
  const trimmed = payloadUserId.trim();
  if (!trimmed) return null;
  if (!isValidUuid(trimmed)) return 'invalid_user';
  if (trimmed !== authenticatedUserId) return 'user_mismatch';
  return null;
}

// ── Match participant authorization (§1.4.5) ────────────────────────────────
//
// "May this verified user act on this tournament match?" — one gate, replacing
// the inline fetch/null-check/completed-check/participant-check that had been
// hand-rolled (and drifted) in registerTournamentAttachHandlers, roomForfeit,
// and roomSocketAttach. Reads the match FRESH every call: a stale client id
// can't slip through, and callers get the row back so they don't re-fetch.

export type TournamentAuthzDenial =
  | 'not_authenticated'   // no verified user id
  | 'match_not_found'
  | 'match_completed'     // terminal — nothing to act on
  | 'not_a_participant';  // authenticated, but not player1/player2 of this match

export type MatchParticipantAuthz =
  | { ok: true; match: MatchRow }
  | { ok: false; code: TournamentAuthzDenial };

/** A match is terminal once it is completed/bye or carries a winner/completion stamp. */
function isMatchTerminal(match: MatchRow): boolean {
  return (
    match.status === 'completed' ||
    match.status === 'bye' ||
    match.completed_at != null ||
    match.winner_id != null
  );
}

/**
 * The single participant gate. `ref` is a match id or a room code; the room-code
 * form only hits the DB for codes shaped like a tournament room (the post-restart
 * fallback — a rehydrated room shell carries no match-id marker). A row that
 * doesn't exist returns `match_not_found`; a fetch that *throws* (DB down) is
 * NOT swallowed — it propagates so each caller decides retry vs. give-up.
 *
 * `opts.allowCompleted` lets forfeit / room-join paths proceed on a terminal
 * match (the RPC is idempotent; the room still needs to report terminal state).
 */
export async function authorizeMatchParticipant(
  userId: string | null,
  ref: { matchId: string } | { roomCode: string },
  opts?: { allowCompleted?: boolean },
  deps?: {
    fetchMatchById?: typeof fetchMatchById;
    fetchMatchByRoomCode?: typeof fetchMatchByRoomCode;
  },
): Promise<MatchParticipantAuthz> {
  const verifiedUserId = typeof userId === 'string' && userId.trim() ? userId.trim() : null;
  if (!verifiedUserId) return { ok: false, code: 'not_authenticated' };

  // Bindings are resolved per-branch, not eagerly — one variant never touches
  // the other's fetch function (matters for tests that mock only one).
  let match: MatchRow | null = null;
  if ('matchId' in ref) {
    match = await (deps?.fetchMatchById ?? fetchMatchById)(ref.matchId);
  } else if (isTournamentRoomCode(ref.roomCode)) {
    match = await (deps?.fetchMatchByRoomCode ?? fetchMatchByRoomCode)(ref.roomCode);
  }
  if (!match) return { ok: false, code: 'match_not_found' };

  if (!opts?.allowCompleted && isMatchTerminal(match)) {
    return { ok: false, code: 'match_completed' };
  }

  if (match.player1_id !== verifiedUserId && match.player2_id !== verifiedUserId) {
    return { ok: false, code: 'not_a_participant' };
  }

  return { ok: true, match };
}

/** Denial → socket ack. Strings kept wire-compatible with existing clients. */
export function matchAuthzAck(code: TournamentAuthzDenial): { ok: false; error: string } {
  switch (code) {
    case 'not_authenticated':
      return { ok: false, error: 'not_authenticated' };
    case 'match_not_found':
      return { ok: false, error: 'match_not_found' };
    case 'match_completed':
      return { ok: false, error: 'match_completed' };
    case 'not_a_participant':
      return { ok: false, error: 'tournament_not_assigned' };
  }
}

/** Denial → HTTP status for REST routes. */
export function matchAuthzHttpStatus(code: TournamentAuthzDenial): 401 | 403 | 404 | 409 {
  switch (code) {
    case 'not_authenticated':
      return 401;
    case 'match_not_found':
      return 404;
    case 'match_completed':
      return 409;
    case 'not_a_participant':
      return 403;
  }
}

export function sendAuthError(res: Response, error: TournamentAuthError): void {
  if (error === 'user_mismatch') {
    res.status(403).json({ ok: false, error: 'user_mismatch' });
    return;
  }
  if (error === 'invalid_user') {
    res.status(400).json({ ok: false, error: 'invalid_user' });
    return;
  }
  res.status(401).json({ ok: false, error: 'not_authenticated' });
}
