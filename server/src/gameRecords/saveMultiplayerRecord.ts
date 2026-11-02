import { supabaseFetch } from '../supabaseUtils';
import { childLogger } from '../logger';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import { isTournamentLikeRoom } from '../multiplayer/terminalCompletion';
import { deriveMultiplayerRecord, type MultiplayerRecordDraft } from './multiplayerRecord';
import { replayMultiplayerRecord } from './multiplayerReplay';
import { GAME_RECORD_MAX_MOVES, GAME_RECORD_VERSION, type GameRecordVerification } from './gameRecordPayload';

const log = childLogger('mp-game-records');

/**
 * Saves a finished multiplayer game as one `game_records` row per human participant (docs/review-game-record-architecture.md, "Multiplayer"; roadmap 3.9).
 *
 * It sits OUTSIDE the game-over completion: it is called only after that completion has succeeded, builds its rows in one synchronous pass (so a rematch cannot
 * change the room underneath it), and inserts them afterwards. Nothing here can change a result, a rating or a tournament: every failure is logged and swallowed.
 *
 * Off unless MP_RECORDS_ENABLED is exactly "true", which must not happen before supabase/migrations/2026-11-02_game_records_multiplayer.sql is applied.
 * Never for a tournament room, and only when BOTH seats are signed-in accounts (a guest seat or a bot has no archive to put it in).
 */

export function multiplayerRecordsEnabled(setting: string | undefined = process.env.MP_RECORDS_ENABLED): boolean {
  return setting === 'true';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** One row of `game_records`, as inserted. */
export type MultiplayerRecordRow = {
  user_id: string;
  source_match_id: string;
  local_match_id: null;
  mode: 'mp';
  fritz_tier: null;
  deal_size: number | null;
  winning_score: number | null;
  match_starter: null;
  deal_seed: null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  moves: { kind: 'mp'; version: 1; record: MultiplayerRecordDraft };
  move_count: number;
  record_version: number;
  verification: GameRecordVerification;
  played_at: string;
  opponent_name: string | null;
};

/**
 * One participant's view of the record: both seats relabelled "you" and "opponent" in the engine's deal order. A seat id can be an account id, and the saved
 * record must carry no account or seat id (the opponent can delete their account), so nothing keyed by a seat id survives this.
 */
export function relabelRecord(record: MultiplayerRecordDraft, mySeat: string): MultiplayerRecordDraft {
  const label = (seat: string) => (seat === mySeat ? 'you' : 'opponent');
  const byLabel = (scores: Record<string, number>) => Object.fromEntries(Object.entries(scores).map(([seat, score]) => [label(seat), score]));
  return {
    players: record.players.map(label),
    config: record.config,
    ...(record.rulesVersion === undefined ? {} : { rulesVersion: record.rulesVersion }),
    hands: record.hands.map((hand) => ({
      handNumber: hand.handNumber,
      starterId: label(hand.starterId),
      deals: Object.fromEntries(Object.entries(hand.deals).map(([seat, tiles]) => [label(seat), [...tiles]])),
      actions: hand.actions.map((action) => ({ ...action, seat: label(action.seat) })),
      drawn: [...hand.drawn],
      endScores: hand.endScores ? byLabel(hand.endScores) : null,
    })),
    finalScores: byLabel(record.finalScores),
    winnerId: record.winnerId === null ? null : label(record.winnerId),
  };
}

export type PrepareResult = { ok: true; rows: MultiplayerRecordRow[] } | { ok: false; reason: string };

const cleanName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 64);
  return trimmed || null;
};

/**
 * Builds the rows for a finished game, or says why not. Synchronous and read-only: it never touches the room. A record whose replay does not land on the
 * recorded result is still returned, flagged `replay_mismatch`, so a derivation problem shows up in the data instead of vanishing.
 */
export function prepareMultiplayerRecordRows(input: GameOverPersistInput, now: Date = new Date()): PrepareResult {
  const { room, a, b } = input;
  if (isTournamentLikeRoom(room)) return { ok: false, reason: 'tournament_room' };
  if (!a.userId || !b.userId || !UUID.test(a.userId) || !UUID.test(b.userId)) return { ok: false, reason: 'not_two_accounts' };
  if (a.userId === b.userId) return { ok: false, reason: 'same_account' };
  if (!room.state) return { ok: false, reason: 'no_state' };

  const derived = deriveMultiplayerRecord({
    players: room.players,
    config: room.state.config,
    tileSetSize: room.activeTileSetSize,
    events: room.events,
    ghostMoveLogs: room.ghostMoveLogs,
  });
  if (!derived.ok) return { ok: false, reason: derived.reason };
  const record = derived.record;
  if (!record.players.includes(a.id) || !record.players.includes(b.id)) return { ok: false, reason: 'seat_mismatch' };

  // Replay the ORIGINAL (seat-keyed) record, then relabel for storage: the stored copy is the same game under different names.
  const replay = replayMultiplayerRecord(record);
  const verification: GameRecordVerification = replay.ok ? 'replay_verified' : 'replay_mismatch';
  if (!replay.ok) log.warn({ roomCode: room.code, sourceMatchId: input.sourceMatchId, reason: replay.reason }, 'multiplayer record did not replay');

  const moveCount = record.hands.reduce((sum, hand) => sum + hand.actions.length, 0);
  if (moveCount < 1 || moveCount > GAME_RECORD_MAX_MOVES) return { ok: false, reason: 'move_count_out_of_range' };

  const tiles = record.config.tilesPerPlayer;
  const dealSize = tiles === 7 || tiles === 14 ? tiles : null;
  const winningScore = Number.isInteger(record.config.winningScore) && record.config.winningScore >= 1 && record.config.winningScore <= 200 ? record.config.winningScore : null;
  const playedAt = now.toISOString();

  const rowFor = (me: typeof a, opponent: typeof b): MultiplayerRecordRow => {
    const mine = relabelRecord(record, me.id);
    const you = mine.finalScores.you;
    const opp = mine.finalScores.opponent;
    return {
      user_id: me.userId as string,
      source_match_id: input.sourceMatchId,
      local_match_id: null,
      mode: 'mp',
      fritz_tier: null,
      deal_size: dealSize,
      winning_score: winningScore,
      match_starter: null,
      deal_seed: null,
      result: { you, opponent: opp, winner: mine.winnerId === 'you' ? 'you' : mine.winnerId === 'opponent' ? 'opponent' : null },
      moves: { kind: 'mp', version: 1, record: mine },
      move_count: moveCount,
      record_version: GAME_RECORD_VERSION,
      verification,
      played_at: playedAt,
      opponent_name: cleanName(opponent.username),
    };
  };
  return { ok: true, rows: [rowFor(a, b), rowFor(b, a)] };
}

/** Inserts the rows idempotently on (user_id, source_match_id): the first save wins, a retry is a no-op. */
export async function insertMultiplayerRecordRows(rows: readonly MultiplayerRecordRow[]): Promise<void> {
  await supabaseFetch('/rest/v1/game_records?on_conflict=user_id,source_match_id', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  });
}

/**
 * The hook the game-over completion calls once it has succeeded. Returns nothing and throws nothing: the rows are built before it returns (the room may be reset
 * the moment the caller continues), and the insert runs in the background.
 */
export function saveMultiplayerGameRecords(
  input: GameOverPersistInput,
  deps: { enabled?: boolean; insert?: typeof insertMultiplayerRecordRows } = {},
): void {
  // Read defensively: this runs in its own catch handler too, and a handler that throws would defeat the point of the hook.
  const where = { roomCode: input?.room?.code, sourceMatchId: input?.sourceMatchId };
  try {
    if (!(deps.enabled ?? multiplayerRecordsEnabled())) return;
    const prepared = prepareMultiplayerRecordRows(input);
    if (!prepared.ok) {
      log.info({ ...where, reason: prepared.reason }, 'multiplayer record not saved');
      return;
    }
    const insert = deps.insert ?? insertMultiplayerRecordRows;
    void insert(prepared.rows).then(
      () => log.info({ ...where, verification: prepared.rows[0].verification }, 'multiplayer record saved'),
      (err: unknown) => log.warn({ err, ...where }, 'multiplayer record save failed'),
    );
  } catch (err) {
    log.warn({ err, ...where }, 'multiplayer record save failed');
  }
}
