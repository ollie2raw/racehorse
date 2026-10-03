import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';
import { registerTournamentSocketHandlers } from './socketHandlers';

const mocks = vi.hoisted(() => ({
  registerForTournament: vi.fn(),
  withdrawFromTournament: vi.fn(),
}));

vi.mock('./persistence', async () => {
  const actual = await vi.importActual<typeof import('./persistence')>('./persistence');
  return {
    ...actual,
    registerForTournament: (...args: unknown[]) => mocks.registerForTournament(...args),
    withdrawFromTournament: (...args: unknown[]) => mocks.withdrawFromTournament(...args),
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
    mocks.registerForTournament.mockResolvedValue({ registered: true, already_registered: false, seats_taken: 1 });
    mocks.withdrawFromTournament.mockResolvedValue({ withdrawn: true });
  });

  it('tournament:register rejects when socket is not identified', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket();
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:register', { tournamentId, userId: validUserId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'not_authenticated' });
    expect(mocks.registerForTournament).not.toHaveBeenCalled();
  });

  it('tournament:register rejects userId spoofing', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:register', { tournamentId, userId: otherUserId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'user_mismatch' });
    expect(mocks.registerForTournament).not.toHaveBeenCalled();
  });

  it('tournament:register uses socket identity only', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:register', { tournamentId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: true });
    expect(mocks.registerForTournament).toHaveBeenCalledWith(tournamentId, validUserId);
  });

  it('tournament:withdraw rejects userId spoofing', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:withdraw', { tournamentId, userId: otherUserId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'user_mismatch' });
    expect(mocks.withdrawFromTournament).not.toHaveBeenCalled();
  });

  it('tournament:register passes the RPC code through (full / closed)', async () => {
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    for (const code of ['tournament_full', 'registration_closed']) {
      mocks.registerForTournament.mockRejectedValueOnce(new Error(code));
      const ack = vi.fn();
      await (socket as any)._emit('tournament:register', { tournamentId }, ack);
      expect(ack).toHaveBeenCalledWith({ ok: false, error: code });
    }
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('tournament:withdraw keeps its historical code once registration has closed', async () => {
    mocks.withdrawFromTournament.mockRejectedValueOnce(new Error('withdraw_closed'));
    const io = { emit: vi.fn() } as unknown as import('socket.io').Server;
    const socket = makeSocket(validUserId);
    registerTournamentSocketHandlers(io, socket);
    const ack = vi.fn();
    await (socket as any)._emit('tournament:withdraw', { tournamentId }, ack);
    expect(ack).toHaveBeenCalledWith({ ok: false, error: 'cannot_withdraw_after_start' });
  });
});
