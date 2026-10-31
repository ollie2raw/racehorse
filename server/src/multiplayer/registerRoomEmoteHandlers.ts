import type { Socket } from 'socket.io';
import { childLogger } from '../logger';
import { listBlockCounterpartiesOrNull } from '../moderation/blockStore';
import { getRoom } from '../rooms';
import { isRoomReactionEmote } from './roomReactionEmotes';
import { isAnyTournamentRoom } from './roomKind';

const log = childLogger('multiplayer:reactions');

const nowMs = () => Date.now();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * How long a sender's block list is reused for tournament-room reactions (one lookup, not one per emote). A block made
 * mid-match takes effect within this long.
 */
export const EMOTE_BLOCK_CACHE_MS = 15_000;

/**
 * Tournament rooms: relay a reaction to everyone in the room EXCEPT people on the other side of a block with the sender
 * (either direction). Player blocks are enforced for friend requests, invites, Quick Match and new private-room seats,
 * but a tournament bracket assigns the opponent, so the pairing itself cannot honour a block; instead nothing social
 * passes between the pair inside the match (tournament launch gate: "option B"). The sender is never told, so a block
 * is not revealed. Guests have no account to block and always receive.
 *
 * Fails CLOSED: if the block list cannot be read, the reaction is dropped (a missed emote costs nothing; delivering one
 * across a block is the harm this exists to prevent).
 */
async function relayAroundBlocks(socket: Socket, roomId: string, evt: object, blocked: Set<string> | null): Promise<void> {
  if (blocked === null) return;
  const peers = await socket.nsp.in(roomId).fetchSockets();
  for (const peer of peers) {
    if (peer.id === socket.id) continue;
    const peerUserId = peer.data?.userId as string | undefined;
    if (peerUserId && blocked.has(peerUserId)) continue;
    peer.emit('room:emote', evt);
  }
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
  // The sender's block counterparties, for tournament rooms only. Failures are not cached.
  let blockCache: { at: number; ids: Set<string> } | null = null;
  const blockedPeers = async (userId: string | undefined): Promise<Set<string> | null> => {
    if (!userId || !UUID_RE.test(userId)) return new Set();
    const t = nowMs();
    if (blockCache && t - blockCache.at < EMOTE_BLOCK_CACHE_MS) return blockCache.ids;
    const ids = await listBlockCounterpartiesOrNull(userId, 'tournament:emote');
    blockCache = ids ? { at: t, ids } : null;
    return ids;
  };

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
      const room = getRoom(roomId);
      if (room && isAnyTournamentRoom(room)) {
        void blockedPeers(evt.from.userId ?? undefined)
          .then((blocked) => relayAroundBlocks(socket, roomId, evt, blocked))
          .catch((e) => log.warn({ err: e instanceof Error ? e.message : e }, 'tournament room:emote relay failed'));
        return;
      }
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
