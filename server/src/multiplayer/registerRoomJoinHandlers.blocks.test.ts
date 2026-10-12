import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isBlockedPairOrFalseMock } = vi.hoisted(() => ({ isBlockedPairOrFalseMock: vi.fn() }));
vi.mock('../moderation/blockStore', () => ({ isBlockedPairOrFalse: isBlockedPairOrFalseMock }));

import { createRoom, getRoom, resetRoomRuntimeForTests } from '../rooms';
import { resetRoomSessionStoresForTests, setRoomRoster } from './roomSession';
import { registerRoomJoinHandlers } from './registerRoomJoinHandlers';

const HOST = '11111111-1111-4111-8111-111111111111';
const JOINER = '22222222-2222-4222-8222-222222222222';

function setup(joinerUserId: string | null) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const socket = {
    id: 'sock-join',
    data: {} as Record<string, unknown>,
    on: (event: string, handler: (...args: unknown[]) => unknown) => { handlers.set(event, handler); return socket; },
  };
  const attachSocketToTrackedRoom = vi.fn(async ({ roomCode }: { roomCode: string }) => ({
    room: { code: roomCode, state: null },
    joinedPlayerSeatId: 'seat-guest',
    roster: [],
    stateWithCounts: null,
    rejoinLegalMoves: [],
    rejoinCanDraw: false,
    hydrationOutcome: 'skipped',
    tournamentMatchMeta: null,
  }));
  registerRoomJoinHandlers({} as never, socket as never, {
    handlerDeps: {
      resolveSocketIdentity: async () => ({ username: 'joiner', userId: joinerUserId }),
    } as never,
    attachSocketToTrackedRoom: attachSocketToTrackedRoom as never,
  });
  return {
    attachSocketToTrackedRoom,
    async join(code: string) {
      const cb = vi.fn();
      await handlers.get('room:join')?.(code, cb);
      return cb.mock.calls[0]?.[0] as { ok: boolean; error?: string };
    },
  };
}

function privateRoomWithHost(): string {
  const room = createRoom('seat-host');
  setRoomRoster(room.code, [{ id: 'seat-host', socketId: 'sock-host', username: 'host', userId: HOST }]);
  return room.code;
}

describe('room:join — blocks', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
    resetRoomSessionStoresForTests();
    isBlockedPairOrFalseMock.mockReset();
    isBlockedPairOrFalseMock.mockResolvedValue(false);
  });

  it('refuses a new joiner across a block, answering like a wrong code', async () => {
    const code = privateRoomWithHost();
    isBlockedPairOrFalseMock.mockResolvedValue(true);
    const h = setup(JOINER);

    const ack = await h.join(code);

    expect(ack).toEqual({ ok: false, error: 'Room not found.' });
    expect(isBlockedPairOrFalseMock).toHaveBeenCalledWith(JOINER, HOST, 'room:join');
    expect(h.attachSocketToTrackedRoom).not.toHaveBeenCalled();
  });

  it('lets an unrelated joiner in', async () => {
    const code = privateRoomWithHost();
    const h = setup(JOINER);

    const ack = await h.join(code);

    expect(ack.ok).toBe(true);
    expect(h.attachSocketToTrackedRoom).toHaveBeenCalledTimes(1);
  });

  it('never refuses a player who already holds a seat (reconnect)', async () => {
    const code = privateRoomWithHost();
    setRoomRoster(code, [
      { id: 'seat-host', socketId: 'sock-host', username: 'host', userId: HOST },
      { id: 'seat-guest', socketId: 'sock-old', username: 'joiner', userId: JOINER },
    ]);
    isBlockedPairOrFalseMock.mockResolvedValue(true);
    const h = setup(JOINER);

    const ack = await h.join(code);

    expect(ack.ok).toBe(true);
    expect(isBlockedPairOrFalseMock).not.toHaveBeenCalled();
  });

  it('does not check guests or non-private rooms', async () => {
    const code = privateRoomWithHost();
    isBlockedPairOrFalseMock.mockResolvedValue(true);
    expect((await setup(null).join(code)).ok).toBe(true);

    const mmCode = privateRoomWithHost();
    getRoom(mmCode).matchmakingMatchId = 'mm-1';
    expect((await setup(JOINER).join(mmCode)).ok).toBe(true);
    expect(isBlockedPairOrFalseMock).not.toHaveBeenCalled();
  });
});
