import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import {
  __roomChatEmoteTestUtils,
  registerRoomChatEmoteHandlers,
} from './registerRoomChatEmoteHandlers';

const { clampString, makeRateLimiter } = __roomChatEmoteTestUtils;

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

describe('clampString', () => {
  it('trims and clamps chat text to max length', () => {
    expect(clampString('  hello  ', 200)).toBe('hello');
    expect(clampString('x'.repeat(250), 200)).toBe('x'.repeat(200));
  });

  it('trims and clamps emote text to 16 chars', () => {
    expect(clampString('  wave  ', 16)).toBe('wave');
    expect(clampString('abcdefghijklmnopqrs', 16)).toBe('abcdefghijklmnop');
  });
});

describe('makeRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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

describe('registerRoomChatEmoteHandlers', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers independent chat and emote limiters per socket', () => {
    const first = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    const second = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u2', username: 'B' },
    });
    registerRoomChatEmoteHandlers(first.socket);
    registerRoomChatEmoteHandlers(second.socket);

    for (let i = 0; i < 6; i += 1) {
      first.handlers['room:chat:send']({ text: `msg-${i}` });
    }
    first.handlers['room:chat:send']({ text: 'blocked' });
    expect(first.roomEmit).toHaveBeenCalledTimes(6);

    second.handlers['room:chat:send']({ text: 'still-ok' });
    expect(second.roomEmit).toHaveBeenCalledTimes(1);
  });

  it('no-ops chat when roomId is missing', () => {
    const { socket, handlers, roomEmit } = createSocketStub({ data: {} });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:chat:send']({ text: 'hello' });

    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('no-ops chat when rate-limited', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    registerRoomChatEmoteHandlers(socket);

    for (let i = 0; i < 6; i += 1) {
      handlers['room:chat:send']({ text: `msg-${i}` });
    }
    handlers['room:chat:send']({ text: 'blocked' });

    expect(roomEmit).toHaveBeenCalledTimes(6);
    expect(roomEmit.mock.calls.at(-1)?.[1]).toMatchObject({ text: 'msg-5' });
  });

  it('emits chat payload with expected shape via socket.to(roomId)', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM9', userId: 'user-1', username: 'Alice' },
    });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:chat:send']({ text: '  hello world  ' });

    expect(socket.to).toHaveBeenCalledWith('ROOM9');
    expect(roomEmit).toHaveBeenCalledWith('room:chat', {
      id: expect.stringMatching(/^1700000000000-/),
      t: 1_700_000_000_000,
      from: { userId: 'user-1', username: 'Alice' },
      text: 'hello world',
    });
  });

  it('no-ops emote when roomId is missing', () => {
    const { socket, handlers, roomEmit } = createSocketStub({ data: {} });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:emote:send']({ emote: 'wave' });

    expect(roomEmit).not.toHaveBeenCalled();
  });

  it('no-ops emote when rate-limited', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM1', userId: 'u1', username: 'A' },
    });
    registerRoomChatEmoteHandlers(socket);

    for (let i = 0; i < 10; i += 1) {
      handlers['room:emote:send']({ emote: `e${i}` });
    }
    handlers['room:emote:send']({ emote: 'blocked' });

    expect(roomEmit).toHaveBeenCalledTimes(10);
  });

  it('emits emote payload with expected shape via socket.to(roomId)', () => {
    const { socket, handlers, roomEmit } = createSocketStub({
      data: { roomId: 'ROOM9', userId: 'user-1', username: 'Alice' },
    });
    registerRoomChatEmoteHandlers(socket);

    handlers['room:emote:send']({ emote: '  thumbsup  ' });

    expect(socket.to).toHaveBeenCalledWith('ROOM9');
    expect(roomEmit).toHaveBeenCalledWith('room:emote', {
      id: expect.stringMatching(/^1700000000000-/),
      t: 1_700_000_000_000,
      from: { userId: 'user-1', username: 'Alice' },
      emote: 'thumbsup',
    });
  });
});