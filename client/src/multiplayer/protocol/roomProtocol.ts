import type { GameState, Move } from '../../types';
import type { PreGameDrawState } from '../../match/preGameDraw/preGameDrawLogic';

/**
 * Stable multiplayer room transport contract.
 * Owned by the multiplayer transport layer — not connection runtime bags or UI shells.
 */

export type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};

export type StateUpdatePayload = {
  you?: string;
  state?: GameState | null;
  legalMoves?: Move[];
  canDraw?: boolean;
  eventMeta?: RoomEventMeta | null;
  preGameDraw?: PreGameDrawState | null;
  /** Authoritative lobby flag from server — do not infer from local state shape. */
  matchStarted?: boolean;
  /** Set with `state` when the server aggregated a forced-draw chain after a PLAY. */
  forcedDrawCount?: number;
  forcedDrawActorId?: string;
  /** Server auto-passed players (socket ids) this frame — show a brief notice. */
  recentAutoPasses?: string[];
};

export type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';

export type RoomIdentity = {
  username: string;
  userId: string | null;
  authToken: string | null;
};

export type RoomPlayer = { id: string; username: string; userId: string | null };

export type RoomChatEvent = {
  id: string;
  t: number;
  from: { userId: string | null; username: string };
  text: string;
};

export type RoomEmoteEvent = {
  id: string;
  t: number;
  from: { userId: string | null; username: string };
  emote: string;
};

function normalizeRoomUsername(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  return raw || 'Guest';
}

/**
 * Normalize raw socket room player payloads to the client RoomPlayer shape.
 * Drops server-only fields (socketId, etc.) intentionally — client only needs
 * id, username, userId for roster display and match identity.
 */
export function normalizeRoomPlayers(value: unknown): RoomPlayer[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { id: entry, username: 'Guest', userId: null };
      }
      if (entry && typeof entry === 'object') {
        const rec = entry as { id?: unknown; username?: unknown; userId?: unknown };
        const id = typeof rec.id === 'string' ? rec.id : '';
        const userId = typeof rec.userId === 'string' ? rec.userId.trim() || null : null;
        return { id, username: normalizeRoomUsername(rec.username), userId };
      }
      return { id: '', username: 'Guest', userId: null };
    })
    .filter((p) => Boolean(p.id));
}