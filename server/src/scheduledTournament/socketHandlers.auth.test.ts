import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';
import { registerTournamentSocketHandlers } from './socketHandlers';

const mocks = vi.hoisted(() => ({
  fetchTournamentById: vi.fn(),
  fetchRegistrations: vi.fn(),
  fetchActiveRegistration: vi.fn(),
  insertRegistration: vi.fn(),
  withdrawRegistration: vi.fn(),
}));

vi.mock('./persistence', async () => {
  const actual = await vi.importActual<typeof import('./persistence')>('./persistence');
  return {
    ...actual,
    fetchTournamentById: (...args: unknown[]) => mocks.fetchTournamentById(...args),
    fetchRegistrations: (...args: unknown[]) => mocks.fetchRegistrations(...args),
    fetchActiveRegistration: (...args: unknown[]) => mocks.fetchActiveRegistration(...args),
    insertRegistration: (...args: unknown[]) => mocks.insertRegistration(...args),
    withdrawRegistration: (...args: unknown[]) => mocks.withdrawRegistration(...args),
    fetchBracketView: vi.fn(),
  };
});

const validUserId = '11111111-1111-4111-8111-111111111111';
const otherUserId = '33333333-3333-4333-8333-333333333333';
const tournamentId = '22222222-2222-4222-8222-222222222222';

function makeSocket(userId?: string): Socket {
  const handlers = new Map<string, (payload: unknown, ack?: (resp: unknown) => void) => void>();
  const socket = {
    data: userId ? { userId } : {},
    on: (event: string, handler: (payload: unknown, ack?: (resp: unknown) => void) => void) => {
      handlers.set(event, handler);
    },
    _emit: (event: string, payload: unknown, ack?: (resp: unknown) => void) => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`no handler for ${event}`);
      return handler(payload, ack);
    },
  };
  return socket as unknown as Socket & { _emit: typeof socket._emit };
}

describe('tournament socket auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchTournamentById.mockResolvedValue({
      id: tournamentId,
      status: 'registration_open',
      max_players: 8,
    });
    mocks.fetchRegistrations.mockResolvedValue([]);
    mocks.fetchActiveRegistration.mockResolvedValue(null);
    mocks.insertRegistration.mockResolvedValue(undefined);
    mocks.withdrawRegistration.mockResolvedValue(undefined);
  });

  it('tournament:register rejects when socket is not identified', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket();
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:register', { tournamentId, userId: validUserId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_authenticated' });
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it('tournament:register rejects userId spoofing', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:register', { tournamentId, userId: otherUserId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'user_mismatch' });
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it('tournament:register uses socket identity only', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:register', { tournamentId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(mocks.insertRegistration).toHaveBeenCalledWith(tournamentId, validUserId);
  });

  it('tournament:withdraw rejects userId spoofing', async () => {
    mocks.fetchTournamentById.mockResolvedValue({
      id: tournamentId,
      status: 'registration_open',
      max_players: 8,
    });
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:withdraw', { tournamentId, userId: otherUserId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'user_mismatch' });
    expect(mocks.withdrawRegistration).not.toHaveBeenCalled();
  });
});
