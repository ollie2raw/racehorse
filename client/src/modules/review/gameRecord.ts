import { apiPost } from '../../api/client.ts';
import { peekCachedSession } from '../../auth/sessionToken.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import { moveEntriesToRecordMoves, type RecordMoveEntry } from '../ghost/ghostMatchHelpers.ts';
import {
  GAME_RECORD_RETRY_DELAYS_MS,
  enqueueGameRecord,
  flushGameRecordOutbox,
  type GameRecordBodyBase,
} from './gameRecordOutbox.ts';

/**
 * The saved game record (docs/review-game-record-architecture.md, Phase 2): the minimum needed to replay a game. The
 * server verifies it against the deal it issued when it can, and review is derived from the saved record later.
 */
export type GameRecordBody = GameRecordBodyBase & {
  mode: 'pvf';
  localMatchId: string | null;
  fritzTier: string | null;
  dealSize: 7 | 14 | null;
  winningScore: number | null;
  matchStarter: 'you' | 'bot' | null;
  /** The server-issued deal seed (ranked games); null when the client dealt (unranked). */
  dealSeed: string | null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  moves: RecordMoveEntry[];
  playedAt: string;
};

export function buildGameRecordBody(input: {
  sourceMatchId: string;
  localMatchId: string | null;
  fritzTier: string | null;
  dealSize: number | null | undefined;
  winningScore: number | null | undefined;
  matchStarter: 'you' | 'bot' | null | undefined;
  dealSeed: string | null | undefined;
  scores: { you: number; opponent: number };
  winnerId: 'you' | 'bot' | null | undefined;
  moveLog: readonly MoveEntry[];
  playedAt?: Date;
}): GameRecordBody | null {
  const moves = moveEntriesToRecordMoves(input.moveLog);
  if (moves.length === 0) return null;
  return {
    sourceMatchId: input.sourceMatchId,
    mode: 'pvf',
    localMatchId: input.localMatchId,
    fritzTier: input.fritzTier,
    dealSize: input.dealSize === 7 || input.dealSize === 14 ? input.dealSize : null,
    winningScore: input.winningScore ?? null,
    matchStarter: input.matchStarter ?? null,
    dealSeed: input.dealSeed ?? null,
    result: {
      you: input.scores.you,
      opponent: input.scores.opponent,
      winner: input.winnerId === 'you' ? 'you' : input.winnerId === 'bot' ? 'opponent' : null,
    },
    moves,
    playedAt: (input.playedAt ?? new Date()).toISOString(),
  };
}

/** One send. Idempotent on the server (first save wins), so repeating it is always safe. */
export async function sendGameRecord(body: GameRecordBody): Promise<{ ok: true } | { ok: false; status?: number }> {
  try {
    const result = await apiPost('/api/game-records', body);
    return result.error ? { ok: false, status: result.status } : { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Save a finished game. Parked in a durable outbox first, then sent with backoff while the page is open; anything
 * still unsent goes out on the next load, on reconnect, or when the tab is visible (see `useReviewWriteOutboxFlush`).
 * Gameplay never waits on this. Signed out: nothing is saved (a record belongs to an account).
 */
export function saveGameRecord(body: GameRecordBody): void {
  const userId = peekCachedSession()?.userId ?? null;
  if (!userId) return;
  enqueueGameRecord(userId, body);
  const attempt = (retryIndex: number): void => {
    void flushGameRecordOutbox<GameRecordBody>(userId, sendGameRecord).then(({ remaining }) => {
      const delay = GAME_RECORD_RETRY_DELAYS_MS[retryIndex];
      if (remaining > 0 && delay !== undefined) setTimeout(() => attempt(retryIndex + 1), delay);
    });
  };
  attempt(0);
}
