import type { Request, Response } from 'express';
import type { Socket } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import { isValidUuid } from './persistence';

export type TournamentAuthError =
  | 'not_authenticated'
  | 'user_mismatch'
  | 'invalid_user';

/** Resolve user id from Bearer token (no response side effects). */
export async function getUserIdFromBearerToken(token: string | null | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const userData = await supabaseFetch<{ id?: string }>(
      '/auth/v1/user',
      { headers: { Authorization: `Bearer ${token}` } } as RequestInit,
    );
    const userId = userData?.id ?? null;
    if (!isValidUuid(userId)) return null;
    return userId.trim();
  } catch {
    return null;
  }
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
