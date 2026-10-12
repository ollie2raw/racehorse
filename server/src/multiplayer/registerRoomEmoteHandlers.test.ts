import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { __roomEmoteTestUtils, registerRoomEmoteHandlers } from './registerRoomEmoteHandlers';
import { ROOM_REACTION_EMOTES, isRoomReactionEmote } from './roomReactionEmotes';

const { makeRateLimiter } = __roomEmoteTestUtils;

type HandlerMap = Record<string, (payload: unknown) => void>;

function createSocketStub(overrides: {
  data?: Record<string, unknown>;
  emit?: ReturnType<typeof vi.fn>;
} = {}): { socket: Socket; handlers: HandlerMap; roomEmit: ReturnType<typeof vi.fn> } {
  const handlers: HandlerMap = {};
  const roomEmit = overrides.emit ?? vi.fn();
  const socket = {
    data: overrides.data ?? {},
    on: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers[event] = handler;
    }),
    to: vi.fn(() => ({ emit: roomEmit })),
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
