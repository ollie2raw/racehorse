import type { Server, Socket } from 'socket.io';
import { createReservedRoom, getRoom } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { QueueService } from './queueService';
import type { MatchFoundPayload, QueuedPlayer } from './types';
import { recordMatchStart } from './persistence';
import { isForbiddenMatchmakingPlayer } from './forbiddenQueuePlayer';

const MATCH_FOUND_COUNTDOWN_MS = 3000;
const ONLINE_BROADCAST_INTERVAL_MS = 2000;
const DEFAULT_RATING = 800;

function matchmakingDebugEnabled(): boolean {
  return process.env.MATCHMAKING_DEBUG === '1';
}

let serviceSingleton: QueueService | null = null;
let onlineBroadcastTimer: ReturnType<typeof setInterval> | null = null;

function makeRoomCode(): string {
  return `MM${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function fetchPlayerRating(userId: string): Promise<number> {
  try {
    const rows = await supabaseFetch<Array<{ glicko_rating: number | null }>>(
      `/rest/v1/profiles?select=glicko_rating&id=eq.${encodeURIComponent(userId)}&limit=1`,
    );
    const raw = rows[0]?.glicko_rating;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : DEFAULT_RATING;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[matchmaking] fetchPlayerRating failed', err instanceof Error ? err.message : err);
    }
    return DEFAULT_RATING;
  }
}

export function getOnlineCount(io: Server): number {
  return io.sockets.sockets.size;
}

/**
 * Wire up matchmaking socket events for one client connection.
 * The first call to this function in the server lifetime also boots the
 * singleton QueueService and the online-count broadcast.
 *
 * `broadcastStateUpdate` is the callback used by the sim bot to push
 * game-state updates to real clients after each sim move. Passing it in
 * via this function (rather than importing it) avoids a circular dependency
 * between matchmaking/index.ts and server/src/index.ts.
 */
export function registerMatchmakingHandlers(
  io: Server,
  socket: Socket,
  _broadcastStateUpdate: (roomCode: string) => void,
): void {
  void _broadcastStateUpdate; // reserved for future use; sim loop now started by index.ts
  const service = getOrCreateService(io);

  socket.on('queue:join', async (payload: { userId?: string; username?: string }, ack?: (resp: unknown) => void) => {
    try {
      if (!payload?.userId || !payload?.username) {
        ack?.({
          ok: false,
          error: 'missing_identity',
          online: getOnlineCount(io),
          queued: service.size(),
        });
        return;
      }
      const rating = await fetchPlayerRating(payload.userId);
      const result = service.join({
        socketId: socket.id,
        userId: payload.userId,
        username: payload.username,
        rating,
        isSim: false,
      });
      if (!result.ok) {
        if (matchmakingDebugEnabled()) {
          console.log('[matchmaking][debug] queue:join rejected', {
            reason: result.reason,
            userId: payload.userId,
            socketId: socket.id,
          });
        }
        ack?.({
          ok: false,
          error: result.reason,
          online: getOnlineCount(io),
          queued: service.size(),
        });
        return;
      }
      if (matchmakingDebugEnabled()) {
        console.log('[matchmaking][debug] queue:join accepted', {
          socketId: socket.id,
          userId: payload.userId,
          username: payload.username,
          rating,
          queueSize: service.size(),
          online: getOnlineCount(io),
        });
      }
      ack?.({
        ok: true,
        rating,
        queueSize: service.size(),
        online: getOnlineCount(io),
        queued: service.size(),
      });

      // One immediate sweep so two players who join milliseconds apart do not
      // always wait for the next interval tick.
      service.tick();

      // Broadcast an immediate online-count update so the joining client
      // sees their own contribution to the count without waiting for the
      // 2s interval tick.
      io.emit('queue:online', { online: getOnlineCount(io), queued: service.size() });
    } catch (err) {
      console.warn('[matchmaking] queue:join failed', err instanceof Error ? err.message : err);
      ack?.({
        ok: false,
        error: 'internal',
        online: getOnlineCount(io),
        queued: service.size(),
      });
    }
  });

  socket.on('queue:leave', (_payload: unknown, ack?: (resp: unknown) => void) => {
    const removed = service.leave(socket.id);
    if (removed) {
      io.emit('queue:online', { online: getOnlineCount(io), queued: service.size() });
    }
    ack?.({ ok: removed });
  });

  socket.on('queue:status', (_payload: unknown, ack?: (resp: unknown) => void) => {
    const status = service.getStatus(socket.id);
    ack?.({ ok: true, status });
  });

  socket.on('queue:online', (_payload: unknown, ack?: (resp: unknown) => void) => {
    ack?.({ ok: true, online: getOnlineCount(io), queued: service.size() });
  });

  socket.on('disconnect', () => {
    if (service.leave(socket.id)) {
      io.emit('queue:online', { online: getOnlineCount(io), queued: service.size() });
    }
  });
}

function getOrCreateService(io: Server): QueueService {
  if (serviceSingleton) return serviceSingleton;
  serviceSingleton = new QueueService({
    onMatched: (a, b) => { void handleMatched(io, a, b); },
    onTimeout: (socketId) => {
      if (matchmakingDebugEnabled()) {
        console.log('[matchmaking][debug] queue:timeout', { socketId });
      }
      io.to(socketId).emit('queue:timeout', { fallbackOffered: true });
    },
  });
  serviceSingleton.start();

  if (!onlineBroadcastTimer) {
    onlineBroadcastTimer = setInterval(() => {
      io.emit('queue:online', { online: getOnlineCount(io), queued: serviceSingleton!.size() });
    }, ONLINE_BROADCAST_INTERVAL_MS);
  }

  return serviceSingleton;
}

/** If a synthetic seat was ever paired (should not happen), put real humans back in the queue. */
function tryRequeueHumanAfterAbortedMatch(p: QueuedPlayer): void {
  if (!serviceSingleton || isForbiddenMatchmakingPlayer(p)) return;
  const result = serviceSingleton.join({
    socketId: p.socketId,
    userId: p.userId,
    username: p.username,
    rating: p.rating,
    isSim: false,
  });
  if (!result.ok && matchmakingDebugEnabled()) {
    console.log('[matchmaking][debug] requeue after aborted synthetic pair failed', {
      userId: p.userId,
      reason: result.reason,
    });
  }
}

async function handleMatched(io: Server, a: QueuedPlayer, b: QueuedPlayer): Promise<void> {
  if (isForbiddenMatchmakingPlayer(a) || isForbiddenMatchmakingPlayer(b)) {
    console.warn('[matchmaking] aborted quick match: synthetic seat in pair (humans-only queue)', {
      a: { userId: a.userId, username: a.username, isSim: a.isSim },
      b: { userId: b.userId, username: b.username, isSim: b.isSim },
    });
    tryRequeueHumanAfterAbortedMatch(a);
    tryRequeueHumanAfterAbortedMatch(b);
    serviceSingleton?.tick();
    return;
  }

  const code = makeRoomCode();
  createReservedRoom(code, { winningScore: 60 });

  try {
    const record = await recordMatchStart({ roomCode: code, a, b });
    const room = getRoom(code);
    if (room) {
      room.matchmakingMatchId = record.id;
    }

    const aPayload: MatchFoundPayload = {
      roomCode: code,
      opponent: { userId: b.userId, username: b.username, rating: b.rating, isSim: b.isSim },
      yourRating: a.rating,
      countdownMs: MATCH_FOUND_COUNTDOWN_MS,
    };
    const bPayload: MatchFoundPayload = {
      roomCode: code,
      opponent: { userId: a.userId, username: a.username, rating: a.rating, isSim: a.isSim },
      yourRating: b.rating,
      countdownMs: MATCH_FOUND_COUNTDOWN_MS,
    };
    if (!a.isSim) io.to(a.socketId).emit('queue:matched', aPayload);
    if (!b.isSim) io.to(b.socketId).emit('queue:matched', bPayload);
    if (matchmakingDebugEnabled()) {
      console.log('[matchmaking][debug] queue:matched emitted', {
        roomCode: code,
        a: { socketId: a.socketId, userId: a.userId, isSim: a.isSim },
        b: { socketId: b.socketId, userId: b.userId, isSim: b.isSim },
      });
    }
    // The sim move loop is started by the auto-start hook in room:join once
    // the game state actually exists. Nothing to do here for sim cases —
    // handleMatched only prepares the room + DB record.
  } catch (err) {
    console.warn('[matchmaking] handleMatched failed', err instanceof Error ? err.message : err);
  }
}
