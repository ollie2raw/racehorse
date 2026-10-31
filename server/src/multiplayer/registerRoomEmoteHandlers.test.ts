import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
const mocks = vi.hoisted(() => ({ getRoom: vi.fn(), listBlocked: vi.fn() }));
vi.mock('../rooms', () => ({ getRoom: mocks.getRoom }));
vi.mock('../moderation/blockStore', () => ({ listBlockCounterpartiesOrNull: mocks.listBlocked }));

import { EMOTE_BLOCK_CACHE_MS, __roomEmoteTestUtils, registerRoomEmoteHandlers } from './registerRoomEmoteHandlers';
import { ROOM_REACTION_EMOTES, isRoomReactionEmote } from './roomReactionEmotes';

const { makeRateLimiter } = __roomEmoteTestUtils;

type HandlerMap = Record<string, (payload: unknown) => void>;

type Peer = { id: string; data: Record<string, unknown>; emit: ReturnType<typeof vi.fn> };

function createSocketStub(overrides: {
  data?: Record<string, unknown>;
  emit?: ReturnType<typeof vi.fn>;
  peers?: Peer[];
} = {}): { socket: Socket; handlers: HandlerMap; roomEmit: ReturnType<typeof vi.fn> } {
  const handlers: HandlerMap = {};
  const roomEmit = overrides.emit ?? vi.fn();
  const socket = {
    data: overrides.data ?? {},
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
    id: 'sender-socket',
    nsp: { in: vi.fn(() => ({ fetchSockets: vi.fn(async () => overrides.peers ?? []) })) },
  } as unknown as Socket;
  return { socket, handlers, roomEmit };
}

describe('makeRateLimiter', () => {
  it('allows burst sends then blocks until tokens refill', () => {
    let now = 0;
    const limiter = makeRateLimiter(3, 10_000, () => now);

    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(false);

    now = 5_000;
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(false);

    now = 15_000;
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(true);
    expect(limiter()).toBe(false);
  });
});

describe('isRoomReactionEmote', () => {
  it('accepts exactly the six presets', () => {
    expect(ROOM_REACTION_EMOTES).toEqual(['👍', '😂', '😮', '❤️', '😡', '🎉']);
    for (const emote of ROOM_REACTION_EMOTES) expect(isRoomReactionEmote(emote)).toBe(true);
  });

  it('rejects arbitrary strings, padded presets, and non-strings', () => {
    for (const value of ['hello', 'wave', 'thumbsup', ' 👍', '👍 ', '👍👍', '🖕', '', 'u suck', null, undefined, 42, { emote: '👍' }]) {
      expect(isRoomReactionEmote(value)).toBe(false);
    }
  });
});

describe('registerRoomEmoteHandlers', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers no free-text chat listener', () => {
    const { socket, handlers } = createSocketStub({ data: { roomId: 'ROOM1' } });
    registerRoomEmoteHandlers(socket);

    expect(Object.keys(handlers)).toEqual(['room:emote:send']);
    expect(handlers['room:chat:send']).toBeUndefined();
  });

  it('relays a preset emote with the expected shape via socket.to(roomId)', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM9', userId: 'user-1', username: 'Alice' },
    });
    registerRoomEmoteHandlers(socket);

    handlers['room:emote:send']({ emote: '🎉' });

    expect(socket.to).toHaveBeenCalledWith('ROOM9');
    expect(roomEmit).toHaveBeenCalledWith('room:emote', {
      id: expect.stringMatching(/^1700000000000-/),
      t: 1_700_000_000_000,
      from: { userId: 'user-1', username: 'Alice' },
      emote: '🎉',
    });
  });

  it('drops arbitrary text sent through the emote event', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    registerRoomEmoteHandlers(socket);

    for (const emote of ['you are trash', 'thumbsup', '  👍  ', '👍 gg', '<b>x</b>']) {
      handlers['room:emote:send']({ emote });
    }
    handlers['room:emote:send']({ text: 'hello' });
    handlers['room:emote:send'](null);

    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('rejected payloads do not spend the rate-limit budget', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    registerRoomEmoteHandlers(socket);

    for (let i = 0; i < 20; i += 1) handlers['room:emote:send']({ emote: `spam-${i}` });
    handlers['room:emote:send']({ emote: '👍' });

    expect(roomEmit).toHaveBeenCalledTimes(1);
  });

  it('no-ops when roomId is missing', () => {
    const { socket, handlers, roomEmit } = createSocketStub({ data: {} });
    registerRoomEmoteHandlers(socket);

    handlers['room:emote:send']({ emote: '👍' });

    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('rate-limits preset emotes per socket', () => {
    const first = createSocketStub({ data: { roomId: 'ROOM1', userId: 'u1', username: 'A' } });
    const second = createSocketStub({ data: { roomId: 'ROOM1', userId: 'u2', username: 'B' } });
    registerRoomEmoteHandlers(first.socket);
    registerRoomEmoteHandlers(second.socket);

    for (let i = 0; i < 11; i += 1) first.handlers['room:emote:send']({ emote: '😂' });
    second.handlers['room:emote:send']({ emote: '😮' });

    expect(first.roomEmit).toHaveBeenCalledTimes(10);
    expect(second.roomEmit).toHaveBeenCalledTimes(1);
  });
});

describe('client/server emote allow-list drift', () => {
  it('the client renders exactly the server allow-list', () => {
    const clientSource = readFileSync(
      fileURLToPath(new URL('../../../client/src/multiplayer/roomReactionEmotes.ts', import.meta.url)),
      'utf8',
    );
    const match = clientSource.match(/ROOM_REACTION_EMOTES\s*=\s*\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    const clientEmotes = [...match![1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
    expect(clientEmotes).toEqual([...ROOM_REACTION_EMOTES]);
  });
});

describe('tournament rooms: reactions never cross a block (launch gate, option B)', () => {
  const SENDER = '11111111-1111-4111-8111-111111111111';
  const FOE = '22222222-2222-4222-8222-222222222222';   // blocked the sender, or was blocked by them
  const OTHER = '33333333-3333-4333-8333-333333333333'; // a spectator with no block
  const peer = (id: string, userId?: string): Peer => ({ id, data: userId ? { userId } : {}, emit: vi.fn() });
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const tournamentRoom = { scheduledTournamentMatchId: 'match-1' };

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mocks.getRoom.mockReset();
    mocks.listBlocked.mockReset();
    mocks.getRoom.mockReturnValue(tournamentRoom);
    mocks.listBlocked.mockResolvedValue(new Set([FOE]));
  });
  afterEach(() => vi.restoreAllMocks());

  const setup = (peers: Peer[], data: Record<string, unknown> = { roomId: 'TROOM', userId: SENDER, username: 'Alice' }) => {
    const stub = createSocketStub({ data, peers });
    registerRoomEmoteHandlers(stub.socket);
    return stub;
  };

  it('does not deliver to the other side of a block, in either direction, and still delivers to everyone else', async () => {
    const foe = peer('s-foe', FOE);
    const other = peer('s-other', OTHER);
    const guest = peer('s-guest');
    const me = peer('sender-socket', SENDER);
    const { handlers, roomEmit } = setup([foe, other, guest, me]);

    handlers['room:emote:send']({ emote: '🎉' });
    await flush();

    expect(foe.emit).not.toHaveBeenCalled();
    expect(me.emit).not.toHaveBeenCalled(); // never echoed to the sender
    expect(other.emit).toHaveBeenCalledWith('room:emote', expect.objectContaining({ emote: '🎉', from: { userId: SENDER, username: 'Alice' } }));
    expect(guest.emit).toHaveBeenCalledTimes(1); // a guest has no account to block
    expect(roomEmit).not.toHaveBeenCalled(); // the unfiltered broadcast is not used in a tournament room
    expect(mocks.listBlocked).toHaveBeenCalledWith(SENDER, 'tournament:emote');
  });

  it('fails closed: if the block list cannot be read, nobody receives the reaction', async () => {
    mocks.listBlocked.mockResolvedValue(null);
    const other = peer('s-other', OTHER);
    const { handlers } = setup([other]);

    handlers['room:emote:send']({ emote: '👍' });
    await flush();

    expect(other.emit).not.toHaveBeenCalled();
  });

  it('does not cache a failed lookup: the next reaction asks again', async () => {
    mocks.listBlocked.mockResolvedValueOnce(null).mockResolvedValue(new Set());
    const other = peer('s-other', OTHER);
    const { handlers } = setup([other]);

    handlers['room:emote:send']({ emote: '👍' });
    await flush();
    handlers['room:emote:send']({ emote: '😮' });
    await flush();

    expect(mocks.listBlocked).toHaveBeenCalledTimes(2);
    expect(other.emit).toHaveBeenCalledTimes(1);
    expect(other.emit).toHaveBeenCalledWith('room:emote', expect.objectContaining({ emote: '😮' }));
  });

  it('looks the block list up once, not once per reaction, and again after the cache expires', async () => {
    const other = peer('s-other', OTHER);
    const { handlers } = setup([other]);
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1_700_000_000_000);
    handlers['room:emote:send']({ emote: '👍' });
    await flush();
    now.mockReturnValue(1_700_000_000_000 + EMOTE_BLOCK_CACHE_MS - 1);
    handlers['room:emote:send']({ emote: '😂' });
    await flush();
    expect(mocks.listBlocked).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_700_000_000_000 + EMOTE_BLOCK_CACHE_MS + 1);
    handlers['room:emote:send']({ emote: '😮' });
    await flush();
    expect(mocks.listBlocked).toHaveBeenCalledTimes(2);
  });

  it('a guest sender has no block list to look up, and reaches everyone', async () => {
    const other = peer('s-other', OTHER);
    const { handlers } = setup([other], { roomId: 'TROOM', username: 'Guest' });

    handlers['room:emote:send']({ emote: '👍' });
    await flush();

    expect(mocks.listBlocked).not.toHaveBeenCalled();
    expect(other.emit).toHaveBeenCalledTimes(1);
  });

  it('still drops anything that is not a preset, and still rate-limits, before any lookup', async () => {
    const { handlers } = setup([peer('s-other', OTHER)]);

    for (let i = 0; i < 20; i += 1) handlers['room:emote:send']({ emote: `spam-${i}` });
    await flush();
    expect(mocks.listBlocked).not.toHaveBeenCalled();

    for (let i = 0; i < 15; i += 1) handlers['room:emote:send']({ emote: '👍' });
    await flush();
    expect(mocks.getRoom).toHaveBeenCalledTimes(10);
  });

  it('every other kind of room is exactly as before: the plain broadcast, with no block lookup', async () => {
    for (const room of [undefined, { matchmakingMatchId: 'mm-1' }, {}]) {
      mocks.getRoom.mockReturnValue(room);
      mocks.listBlocked.mockClear();
      const { socket, handlers, roomEmit } = createSocketStub({ data: { roomId: 'ROOM1', userId: SENDER, username: 'Alice' } });
      registerRoomEmoteHandlers(socket);

      handlers['room:emote:send']({ emote: '🎉' });
      await flush();

      expect(socket.to).toHaveBeenCalledWith('ROOM1');
      expect(roomEmit).toHaveBeenCalledTimes(1);
      expect(mocks.listBlocked).not.toHaveBeenCalled();
    }
  });

  it('the legacy league counts as a tournament room too', async () => {
    mocks.getRoom.mockReturnValue({ config: { tournamentId: 'league-1' } });
    const foe = peer('s-foe', FOE);
    const { handlers } = setup([foe]);

    handlers['room:emote:send']({ emote: '👍' });
    await flush();

    expect(foe.emit).not.toHaveBeenCalled();
  });
});

