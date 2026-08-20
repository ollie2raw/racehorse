import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests } from './roomSession';
import { registerRoomJoinHandlers } from './registerRoomJoinHandlers';
import { MatchTerminalJoinError } from './matchTerminalJoin';
import * as telemetry from './mpAuthorityTelemetry';

function makeSocket() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const socket = {
    id: 'sock-join',
    data: {} as Record<string, unknown>,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return socket;
    },
  };
  return { socket: socket as any, handlers };
}

describe('registerRoomJoinHandlers', () => {
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

  it('room:join surfaces attach errors via ack', async () => {
    const io = {} as any;
    const { socket, handlers } = makeSocket();
    const attachSocketToTrackedRoom = vi.fn(async () => {
      throw new Error('Room not found.');
    });

    registerRoomJoinHandlers(io, socket, {
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
    await handlers.get('room:join')?.('MISSING', cb);
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'Room not found.' });
  });

  it('room:join surfaces structured match_terminal ack when archive exists', async () => {
    const io = {} as any;
    const { socket, handlers } = makeSocket();
    const attachSocketToTrackedRoom = vi.fn(async () => {
      throw new MatchTerminalJoinError({
        status: 'completed',
        matchId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        recoverable: true,
      });
    });

    registerRoomJoinHandlers(io, socket, {
      handlerDeps: {
        resolveSocketIdentity: async () => ({ username: 'Guest', userId: 'user-1' }),
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
    const emit = vi.spyOn(telemetry, 'emitMpAuthorityFunnel');
    await handlers.get('room:join')?.('ARCHV1', cb);
    expect(cb).toHaveBeenCalledWith({
      ok: false,
      error: 'match_terminal',
      terminal: {
        status: 'completed',
        matchId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        recoverable: true,
      },
    });
    expect(emit).toHaveBeenCalledWith('private_terminal_recovery', expect.objectContaining({
      roomCode: 'ARCHV1',
      extra: expect.objectContaining({
        source: 'join_ack',
        matchId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        status: 'completed',
      }),
    }));
  });
});