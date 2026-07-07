import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests } from './roomSession';
import { registerTournamentAttachHandlers } from './registerTournamentAttachHandlers';

function makeSocket(userId?: string) {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: 'sock-tour',
    data: { userId } as Record<string, unknown>,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
  };
  return { socket: socket as any, handlers };
}

describe('registerTournamentAttachHandlers', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    initRoomSession({ sockets: { sockets: new Map() } } as any, {
      resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
      normalizeUsername: (v) => String(v ?? 'Guest'),
      normalizeUserId: (v) => (typeof v === 'string' ? v : null),
      tryHydrateMatchmakingRoomShell: async () => 'skipped',
      waitUntilMatchmakingRoomSocketsReady: async () => undefined,
      onAfterMatchStarted: async () => undefined,
      notifyRoomPlayersInGame: () => undefined,
      persistRoomMatchLog: async () => undefined,
      onGameOver: () => null,
    });
  });

  it('rejects unauthenticated attach requests', async () => {
    const io = {} as any;
    const { socket, handlers } = makeSocket(undefined);
    const attachSocketToTrackedRoom = vi.fn();

    registerTournamentAttachHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
        normalizeUsername: (v) => String(v ?? 'Guest'),
        normalizeUserId: (v) => (typeof v === 'string' ? v : null),
        tryHydrateMatchmakingRoomShell: async () => 'skipped',
        waitUntilMatchmakingRoomSocketsReady: async () => undefined,
        onAfterMatchStarted: async () => undefined,
        notifyRoomPlayersInGame: () => undefined,
        persistRoomMatchLog: async () => undefined,
      },
      attachSocketToTrackedRoom,
    });

    const cb = vi.fn();
    await handlers.get('tournament:attach_assigned_match')?.({ matchId: 'match-1' }, cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'not_authenticated' });
    expect(attachSocketToTrackedRoom).not.toHaveBeenCalled();
  });
});