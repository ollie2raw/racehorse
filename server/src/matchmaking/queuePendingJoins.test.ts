/**
 * Phase 3 item 3.5: explicit per-user queue uniqueness via pendingJoins.
 *
 * Simulates two concurrent queue:join events for the same userId arriving
 * while fetchPlayerRating is awaited, and confirms the second is rejected
 * without relying on microtask ordering.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { QueueService } from './queueService';

// Minimal socket mock
function makeSocket(socketId: string, userId: string) {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  return {
    id: socketId,
    data: { userId, username: 'player' },
    on(event: string, handler: (...args: unknown[]) => void) {
      (handlers[event] ??= []).push(handler);
    },
    emit: vi.fn(),
    _trigger(event: string, ...args: unknown[]) {
      (handlers[event] ?? []).forEach((h) => h(...args));
    },
  };
}

function makeIo(sockets: ReturnType<typeof makeSocket>[]) {
  return {
    sockets: { sockets: { size: sockets.length } },
    emit: vi.fn(),
  };
}

describe('matchmaking pendingJoins guard (item 3.5)', () => {
  let service: QueueService;

  afterEach(() => {
    service?.stop();
  });

  it('rejects a second queue:join from same userId while first is awaiting rating fetch', async () => {
    // Two join calls arrive "concurrently" (both start before either resolves).
    // We use a deferred promise to hold fetchPlayerRating open so both calls
    // enter the pendingJoins check before the first resolves.

    let resolveRating!: (v: number) => void;
    const ratingPromise = new Promise<number>((res) => { resolveRating = res; });

    // Patch supabaseFetch to return our deferred promise
    vi.doMock('../supabaseUtils', () => ({
      supabaseFetch: () => ratingPromise.then((r) => [{ glicko_rating: r }]),
    }));

    const { registerMatchmakingHandlers } = await import('./index?v=pending-test');

    service = new QueueService({
      onMatched: vi.fn(),
      onTimeout: vi.fn(),
      tickIntervalMs: 99999,
      timeoutAfterMs: 99999,
    });
    service.start();

    const socket1 = makeSocket('s1', 'user-abc');
    const socket2 = makeSocket('s2', 'user-abc'); // same userId, different socket
    const io = makeIo([socket1, socket2]);

    // Register handlers for both sockets
    registerMatchmakingHandlers(io as any, socket1 as any, vi.fn());
    registerMatchmakingHandlers(io as any, socket2 as any, vi.fn());

    const ack1 = vi.fn();
    const ack2 = vi.fn();

    // Fire both queue:join events synchronously (before rating resolves)
    socket1._trigger('queue:join', { userId: 'user-abc', username: 'player' }, ack1);
    socket2._trigger('queue:join', { userId: 'user-abc', username: 'player' }, ack2);

    // Now let the rating resolve
    resolveRating(1200);

    // Wait for both async handlers to finish
    await new Promise<void>((r) => setTimeout(r, 10));

    // Exactly one should have been accepted; the other rejected as already_queued
    const results = [ack1.mock.calls[0]?.[0], ack2.mock.calls[0]?.[0]] as Array<{ ok: boolean; error?: string } | undefined>;
    const accepted = results.filter((r) => r?.ok === true);
    const rejected = results.filter((r) => r?.ok === false);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toBe('already_queued');

    vi.doUnmock('../supabaseUtils');
    service.stop();
  });
});
