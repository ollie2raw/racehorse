import type { Socket } from 'socket.io';
import { childLogger } from '../logger';
import { isRoomReactionEmote } from './roomReactionEmotes';

const log = childLogger('multiplayer:reactions');

const nowMs = () => Date.now();

function makeRateLimiter(burst: number, perMs: number, readNowMs: () => number = nowMs) {
  let tokens = burst;
  let last = readNowMs();
  return () => {
    const t = readNowMs();
    const refill = ((t - last) / perMs) * burst;
    tokens = Math.min(burst, tokens + refill);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/**
 * Registers the per-socket match reaction handler.
 *
 * Reactions are the six preset emotes in `roomReactionEmotes.ts` and nothing
 * else. Free-text match chat (`room:chat:send`) was removed for App Store
 * Guideline 1.2: no listener is registered for it, so a client that still
 * emits it is ignored. An emote payload that is not exactly one of the presets
 * is dropped before it reaches the room, so the event cannot carry custom text.
 */
export function registerRoomEmoteHandlers(socket: Socket): void {
  const canSendEmote = makeRateLimiter(10, 10_000);

  socket.on('room:emote:send', (payload: { emote?: unknown }) => {
    try {
      const emote = payload?.emote;
      if (!isRoomReactionEmote(emote)) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;
      if (!canSendEmote()) return;
      const evt = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        emote,
      };
      socket.to(roomId).emit('room:emote', evt);
    } catch (e) {
      log.warn({ err: e instanceof Error ? e.message : e }, 'room:emote:send failed');
    }
  });
}

/** @internal Exported for unit tests only — not part of the public server API. */
export const __roomEmoteTestUtils = {
  makeRateLimiter,
};
