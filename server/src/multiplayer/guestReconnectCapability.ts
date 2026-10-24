import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const LIFETIME_MS = 24 * 60 * 60 * 1000;
const processSecret = randomBytes(32).toString('hex');

function signingKey(): string {
  // The service key is required in production and survives a server restart.
  // A process-local key keeps tests/dev isolated when no configured key exists.
  return process.env.GUEST_RECONNECT_SIGNING_KEY || process.env.SUPABASE_SERVICE_KEY || processSecret;
}

export function isGuestSeatIdentity(userId: string | null): boolean {
  return !userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
}

function signature(roomCode: string, seatId: string, userId: string, expiresAt: number): Buffer {
  return createHmac('sha256', signingKey())
    .update(JSON.stringify([roomCode, seatId, userId, expiresAt]))
    .digest();
}

export function issueGuestReconnectCapability(
  roomCode: string,
  seatId: string,
  userId: string,
): string {
  const expiresAt = Date.now() + LIFETIME_MS;
  return `v1.${expiresAt}.${signature(roomCode, seatId, userId, expiresAt).toString('base64url')}`;
}

export function verifyGuestReconnectCapability(
  token: unknown,
  roomCode: string,
  seatId: string,
  userId: string,
): boolean {
  if (typeof token !== 'string' || token.length > 160) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d{13}$/.test(parts[1])) return false;
  const expiresAt = Number(parts[1]);
  if (expiresAt < Date.now() || expiresAt > Date.now() + LIFETIME_MS) return false;
  try {
    const supplied = Buffer.from(parts[2], 'base64url');
    const expected = signature(roomCode, seatId, userId, expiresAt);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  } catch {
    return false;
  }
}
