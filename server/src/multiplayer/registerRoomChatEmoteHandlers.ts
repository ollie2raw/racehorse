import type { Socket } from 'socket.io';

const nowMs = () => Date.now();

function clampString(s: string, max: number) {
  const t = (s ?? '').trim();
  return t.length > max ? t.slice(0, max) : t;
}

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

/** Registers per-socket room chat/emote handlers with independent token-bucket limits. */
export function registerRoomChatEmoteHandlers(socket: Socket): void {
  const canSendChat = makeRateLimiter(6, 10_000);
  const canSendEmote = makeRateLimiter(10, 10_000);

  socket.on('room:chat:send', (payload: { text: string }) => {
    try {
      if (!canSendChat()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const text = clampString(String(payload?.text ?? ''), 200);
      if (!text) return;

      const msg = {
        id: `${nowMs()}-${Math.random().toString(16).slice(2)}`,
        t: nowMs(),
        from: {
          userId: (socket.data?.userId as string | undefined) ?? null,
          username: (socket.data?.username as string | undefined) ?? 'Player',
        },
        text,
      };

      socket.to(roomId).emit('room:chat', msg);
    } catch (e) {
      console.warn('room:chat:send failed', e);
    }
  });

  socket.on('room:emote:send', (payload: { emote: string }) => {
    try {
      if (!canSendEmote()) return;
      const roomId = (socket.data?.roomId as string | undefined) ?? undefined;
      if (!roomId) return;

      const emote = clampString(String(payload?.emote ?? ''), 16);
      if (!emote) return;

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
      console.warn('room:emote:send failed', e);
    }
  });
}

/** @internal Exported for unit tests only — not part of the public server API. */
export const __roomChatEmoteTestUtils = {
  clampString,
  makeRateLimiter,
};