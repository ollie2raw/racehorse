import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { isOnline, resetPresenceRegistry, socketsByUserId as registrySockets } from './presenceRegistry';
import { registerPresenceHandlers } from './registerPresenceHandlers';
import { resolveQueueIdentity } from '../matchmaking';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn().mockResolvedValue([]) }));

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const isUuidLike = (v: string | null | undefined) =>
  Boolean(v && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v));
const normalizeUserId = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

type Payload = { userId?: string | null; username?: string; authToken?: string | null };
type Resolver = (p: Payload) => Promise<{ username: string; userId: string | null }>;

function connect(id: string, resolve: Resolver) {
  const handlers: Record<string, (...a: unknown[]) => unknown> = {};
  const socket = {
    id,
    data: {} as Record<string, unknown>,
    on: vi.fn((e: string, h: (...a: unknown[]) => unknown) => { handlers[e] = h; return socket; }),
  } as unknown as Socket;
  const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
  const reg = registerPresenceHandlers(socket, { io, socketsByUserId: registrySockets, resolveSocketIdentity: resolve, normalizeUserId, isUuidLike });
  const identify = (p: Payload) => handlers['presence:identify'](p, vi.fn()) as Promise<void>;
  return { socket, identify, reg };
}

/** The real server rules: verified token -> its user; no token -> only a non-UUID guest label; bad token -> null. */
const tokens: Record<string, string | null> = { 'tok-A': A, 'tok-B': B, 'tok-expired': null };
const realistic: Resolver = async (p) => {
  const username = p.username ?? 'x';
  if (!p.authToken) return { username, userId: p.userId && !isUuidLike(p.userId) ? p.userId : null };
  if (p.authToken === 'tok-outage') throw new Error('auth backend unreachable');
  return { username, userId: tokens[p.authToken] ?? null };
};

beforeEach(() => resetPresenceRegistry());
afterEach(() => resetPresenceRegistry());

describe('socket authority across principal transitions', () => {
  it('A -> logged out: durable authority and presence are gone and queueing is refused', async () => {
    const c = connect('s1', realistic);
    await c.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    expect(c.socket.data.userId).toBe(A);
    expect(isOnline(A)).toBe(true);
    await c.identify({ userId: null, username: 'Guest', authToken: null });
    expect(c.socket.data.userId).toBeUndefined();
    expect(isOnline(A)).toBe(false);
    expect(resolveQueueIdentity(c.socket, { userId: A, username: 'A' })).toEqual({ ok: false, error: 'not_authenticated' });
    expect(resolveQueueIdentity(c.socket, {})).toEqual({ ok: false, error: 'missing_identity' });
  });

  it('A -> guest: only a non-UUID guest label survives, and it is never an account', async () => {
    const c = connect('s1', realistic);
    await c.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    await c.identify({ userId: 'guest_abc', username: 'Guest', authToken: null });
    expect(c.socket.data.userId).toBe('guest_abc');
    expect(isUuidLike(c.socket.data.userId as string)).toBe(false);
    expect(isOnline(A)).toBe(false);
    // A cannot be claimed back through this socket by naming A's id.
    expect(resolveQueueIdentity(c.socket, { userId: A, username: 'A' })).toEqual({ ok: false, error: 'user_mismatch' });
  });

  it('A -> B: the socket moves wholesale; A is offline, B online', async () => {
    const c = connect('s1', realistic);
    await c.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    await c.identify({ userId: B, username: 'B', authToken: 'tok-B' });
    expect(c.socket.data.userId).toBe(B);
    expect(isOnline(A)).toBe(false);
    expect(isOnline(B)).toBe(true);
  });

  it('A -> invalid/expired token: downgraded', async () => {
    const c = connect('s1', realistic);
    await c.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    await c.identify({ userId: A, username: 'A', authToken: 'tok-expired' });
    expect(c.socket.data.userId).toBeUndefined();
    expect(isOnline(A)).toBe(false);
  });

  it('transient verification outage: same-principal rotation keeps A, a different claimed principal drops A', async () => {
    const c = connect('s1', realistic);
    await c.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    await c.identify({ userId: A, username: 'A', authToken: 'tok-outage' });
    expect(c.socket.data.userId).toBe(A); // still A's own session: recovers on the next identify with no state loss
    await c.identify({ userId: B, username: 'B', authToken: 'tok-outage' });
    expect(c.socket.data.userId).toBeUndefined(); // the browser is now B; A must not linger on this socket
    expect(isOnline(A)).toBe(false);
    await c.identify({ userId: B, username: 'B', authToken: 'tok-B' }); // recovery: the next identify restores B
    expect(c.socket.data.userId).toBe(B);
  });

  it('sign-out racing a slow verification of the old token: the stale identify cannot re-install A', async () => {
    let release!: () => void;
    const slow: Resolver = async (p) => {
      if (p.authToken === 'tok-A-slow') {
        await new Promise<void>((r) => { release = r; });
        return { username: 'A', userId: A };
      }
      return realistic(p);
    };
    const c = connect('s1', slow);
    await c.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    const rotation = c.identify({ userId: A, username: 'A', authToken: 'tok-A-slow' }); // in flight
    await c.identify({ userId: null, username: 'Guest', authToken: null }); // user signs out meanwhile
    expect(c.socket.data.userId).toBeUndefined();
    release();
    await rotation;
    expect(c.socket.data.userId).toBeUndefined();
    expect(isOnline(A)).toBe(false);
  });

  it('replacement socket: the old authenticated socket going away does not take the new one offline; sign-out on the new one does', async () => {
    const oldSock = connect('old', realistic);
    await oldSock.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    const newSock = connect('new', realistic);
    await newSock.identify({ userId: A, username: 'A', authToken: 'tok-A' });
    oldSock.reg.handlePresenceDisconnect();
    expect(isOnline(A)).toBe(true);
    await newSock.identify({ userId: null, username: 'Guest', authToken: null });
    expect(isOnline(A)).toBe(false);
  });
});
