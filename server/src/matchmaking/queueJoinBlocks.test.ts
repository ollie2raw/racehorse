/**
 * queue:join snapshots the player's blocks and Quick Match never pairs across
 * them. Driven through the real handler with only Supabase stubbed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const USER_C = '33333333-3333-4333-8333-333333333333';

let blockRows: Array<{ blocker_user_id: string; blocked_user_id: string }> = [];
let blockLookupFails = false;
const supabaseFetchMock = vi.fn(async (path: string) => {
  if (path.startsWith('/rest/v1/profiles')) return [{ glicko_rating: 1500 }];
  if (path.startsWith('/rest/v1/user_blocks')) {
    if (blockLookupFails) throw new Error('Supabase request failed: 503');
    const id = decodeURIComponent(path).match(/blocker_user_id\.eq\.([0-9a-f-]{36})/)?.[1];
    return blockRows.filter((r) => r.blocker_user_id === id || r.blocked_user_id === id);
  }
  return [];
});

vi.mock('../supabaseUtils', async () => {
  const actual = await vi.importActual<typeof import('../supabaseUtils')>('../supabaseUtils');
  return { ...actual, supabaseFetch: (path: string) => supabaseFetchMock(path) };
});

const {
  registerMatchmakingHandlers,
  getMatchmakingQueueServiceForTests,
  resetMatchmakingRuntimeForTests,
} = await import('./index');

function makeSocket(id: string, userId: string) {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  return {
    id,
    data: { userId, username: `p-${id}` },
    on(event: string, handler: (...args: unknown[]) => unknown) { handlers[event] = handler; },
    emit: vi.fn(),
    join: vi.fn(),
    async trigger(event: string, ...args: unknown[]) { await handlers[event]?.(...args); },
  };
}

const io = { sockets: { sockets: { size: 3, get: () => undefined } }, emit: vi.fn(), to: () => ({ emit: vi.fn() }) };

async function join(socket: ReturnType<typeof makeSocket>) {
  registerMatchmakingHandlers(io as never, socket as never, vi.fn());
  const ack = vi.fn();
  await socket.trigger('queue:join', {}, ack);
  return ack.mock.calls[0]?.[0] as { ok: boolean };
}

describe('queue:join — blocks', () => {
  afterEach(() => {
    resetMatchmakingRuntimeForTests();
    blockRows = [];
    blockLookupFails = false;
  });

  it('two players who blocked each other both queue and stay unpaired', async () => {
    blockRows = [{ blocker_user_id: USER_A, blocked_user_id: USER_B }];

    expect((await join(makeSocket('sa', USER_A))).ok).toBe(true);
    expect((await join(makeSocket('sb', USER_B))).ok).toBe(true);

    const queued = getMatchmakingQueueServiceForTests()!.list();
    expect(queued.map((p) => p.userId).sort()).toEqual([USER_A, USER_B]);
    expect(queued.find((p) => p.userId === USER_A)?.blockedUserIds?.has(USER_B)).toBe(true);
    // The blocked side carries the block too, so either player's check holds.
    expect(queued.find((p) => p.userId === USER_B)?.blockedUserIds?.has(USER_A)).toBe(true);
  });

  it('a third, unrelated player is still paired with the waiting one', async () => {
    blockRows = [{ blocker_user_id: USER_A, blocked_user_id: USER_B }];

    await join(makeSocket('sa', USER_A));
    await join(makeSocket('sb', USER_B));
    await join(makeSocket('sc', USER_C));

    const remaining = getMatchmakingQueueServiceForTests()!.list().map((p) => p.userId);
    expect(remaining).toHaveLength(1);
    expect([USER_A, USER_B]).toContain(remaining[0]);
  });

  it('fails closed: a player whose blocks cannot be read is not queued (no pairing, no retry loop)', async () => {
    await join(makeSocket('sc', USER_C));
    blockLookupFails = true;

    const ack = await join(makeSocket('sa', USER_A));

    expect(ack).toMatchObject({ ok: false, error: 'queue_unavailable' });
    expect(getMatchmakingQueueServiceForTests()!.list().map((p) => p.userId)).toEqual([USER_C]);

    // Once lookups work again the same player can search and is paired.
    blockLookupFails = false;
    expect((await join(makeSocket('sa2', USER_A))).ok).toBe(true);
    expect(getMatchmakingQueueServiceForTests()!.list()).toHaveLength(0);
  });
});
