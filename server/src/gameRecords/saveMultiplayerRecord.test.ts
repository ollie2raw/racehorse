import { describe, expect, it, vi } from 'vitest';

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('../supabaseUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabaseUtils')>()),
  supabaseFetch: fetchMock,
}));

import { createReservedRoom, getRoom, joinRoom, startGame, type Room } from '../rooms';
import type { GameOverPersistInput } from '../multiplayer/roomSession';
import { replayMultiplayerRecord } from './multiplayerReplay';
import {
  insertMultiplayerRecordRows,
  multiplayerRecordsEnabled,
  prepareMultiplayerRecordRows,
  relabelRecord,
  saveMultiplayerGameRecords,
  type MultiplayerRecordRow,
} from './saveMultiplayerRecord';
import { deriveMultiplayerRecord } from './multiplayerRecord';
import { installRoomHarness, makeIo, playGame } from './multiplayerRecord.testkit';

installRoomHarness();

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function inputFor(room: Room, over: Partial<GameOverPersistInput> = {}): GameOverPersistInput {
  const state = room.state!;
  const scoreA = state.players['seat-a'].score;
  const scoreB = state.players['seat-b'].score;
  return {
    room,
    sourceMatchId: `src-${room.code}`,
    cfg: room.config,
    aId: 'seat-a',
    bId: 'seat-b',
    a: { id: 'seat-a', socketId: '', username: 'Alice', userId: A },
    b: { id: 'seat-b', socketId: '', username: 'Bob', userId: B },
    scoreA,
    scoreB,
    winnerSeatId: state.winnerId ?? 'seat-a',
    ...over,
  };
}

const prepared = (input: GameOverPersistInput) => {
  const result = prepareMultiplayerRecordRows(input, new Date('2026-11-02T12:00:00.000Z'));
  if (!result.ok) throw new Error(result.reason);
  return result.rows;
};

describe('multiplayerRecordsEnabled', () => {
  it('is on only for the exact string "true"', () => {
    expect(multiplayerRecordsEnabled('true')).toBe(true);
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes']) expect(multiplayerRecordsEnabled(v)).toBe(false);
  });
});

describe('the rows saved for a finished game', () => {
  it('are one per participant, each from their own side, verified by the engine replay', async () => {
    const room = await playGame('SAVE1', 31337);
    const rows = prepared(inputFor(room));
    expect(rows).toHaveLength(2);
    const [rowA, rowB] = rows;
    expect(rowA.user_id).toBe(A);
    expect(rowB.user_id).toBe(B);
    for (const row of rows) {
      expect(row).toMatchObject({
        mode: 'mp',
        source_match_id: 'src-SAVE1',
        local_match_id: null,
        fritz_tier: null,
        match_starter: null,
        deal_seed: null,
        verification: 'replay_verified',
        deal_size: 7,
        winning_score: 60,
        record_version: 1,
        played_at: '2026-11-02T12:00:00.000Z',
      });
      expect(row.move_count).toBeGreaterThan(0);
    }
    expect(rowA.opponent_name).toBe('Bob');
    expect(rowB.opponent_name).toBe('Alice');
    // each row is the game from its own side
    expect(rowA.result.you).toBe(rowB.result.opponent);
    expect(rowA.result.opponent).toBe(rowB.result.you);
    const aWon = room.state!.winnerId === 'seat-a';
    expect(rowA.result.winner).toBe(aWon ? 'you' : 'opponent');
    expect(rowB.result.winner).toBe(aWon ? 'opponent' : 'you');
  });

  it('carry no seat id and no account id, only "you" and "opponent"', async () => {
    const room = await playGame('SAVE2', 99);
    const text = JSON.stringify(prepared(inputFor(room)).map((r) => r.moves));
    expect(text).not.toMatch(/seat-a|seat-b/);
    expect(text).not.toContain(A);
    expect(text).not.toContain(B);
    expect(text).toContain('"you"');
    expect(text).toContain('"opponent"');
  });

  it('are the same game under new names: each relabelled record still replays to the same result', async () => {
    const room = await playGame('SAVE3', 4711);
    for (const row of prepared(inputFor(room))) {
      const replay = replayMultiplayerRecord(row.moves.record);
      expect(replay, JSON.stringify(replay)).toMatchObject({ ok: true });
      if (replay.ok) expect(replay.finalScores).toEqual({ you: row.result.you, opponent: row.result.opponent });
    }
  });

  it('give each side their own dealt hand, in the engine\'s deal order', async () => {
    const room = await playGame('SAVE4', 55);
    const derived = deriveMultiplayerRecord({ players: room.players, config: room.state!.config, tileSetSize: room.activeTileSetSize, events: room.events, ghostMoveLogs: room.ghostMoveLogs });
    if (!derived.ok) throw new Error(derived.reason);
    const forA = relabelRecord(derived.record, 'seat-a');
    const forB = relabelRecord(derived.record, 'seat-b');
    expect(forA.players).toEqual(['you', 'opponent']);
    expect(forB.players).toEqual(['opponent', 'you']);
    expect(forA.hands[0].deals.you).toEqual(derived.record.hands[0].deals['seat-a']);
    expect(forB.hands[0].deals.you).toEqual(derived.record.hands[0].deals['seat-b']);
    expect(forA.hands[0].deals.opponent).toEqual(forB.hands[0].deals.you);
  });

  it('are still returned, flagged replay_mismatch, when the recorded result does not replay', async () => {
    const room = await playGame('SAVE5', 8080);
    const tampered = { ...room, events: room.events.map((e) => (e.type === 'hand_ended' && e === room.events.find((x) => x.type === 'hand_ended')
      ? { ...e, payload: { ...e.payload, scores: Object.fromEntries(Object.entries(e.payload.scores as Record<string, number>).map(([k, v]) => [k, v + 5])) } }
      : e)) } as Room;
    const rows = prepared(inputFor(tampered));
    expect(rows.map((r) => r.verification)).toEqual(['replay_mismatch', 'replay_mismatch']);
  });
});

describe('what is not saved', () => {
  const why = (input: GameOverPersistInput) => {
    const r = prepareMultiplayerRecordRows(input);
    return r.ok ? 'saved' : r.reason;
  };

  it('a tournament room, however finished', async () => {
    const room = await playGame('SKIP1', 1);
    room.scheduledTournamentMatchId = 'match-1';
    expect(why(inputFor(room))).toBe('tournament_room');
    const league = await playGame('SKIP1B', 2, { tournamentId: 't1' });
    expect(why(inputFor(league))).toBe('tournament_room');
  });

  it('a game where a seat is not a signed-in account (a guest key, a bot, a malformed id), or both seats are one account', async () => {
    const room = await playGame('SKIP2', 3);
    expect(why(inputFor(room, { b: { id: 'seat-b', socketId: '', username: 'Guest', userId: null } }))).toBe('not_two_accounts');
    expect(why(inputFor(room, { b: { id: 'seat-b', socketId: '', username: 'Guest', userId: 'guest-reconnect-key' } }))).toBe('not_two_accounts');
    expect(why(inputFor(room, { b: { id: 'seat-b', socketId: '', username: 'Bob', userId: A } }))).toBe('same_account');
  });

  it('a game that has not finished', async () => {
    createReservedRoom('SKIP3', { skipPregameDraw: true });
    joinRoom('SKIP3', 'seat-a');
    joinRoom('SKIP3', 'seat-b');
    const room = getRoom('SKIP3');
    room.players = ['seat-a', 'seat-b'];
    room.state = null;
    await startGame('SKIP3', makeIo());
    expect(why(inputFor(room))).toBe('not_finished');
  });

  it('a room that dealt from a custom deck, and a seat that is not in the record', async () => {
    const room = await playGame('SKIP4', 5);
    room.activeTileSetSize = 10;
    expect(why(inputFor(room))).toBe('custom_tile_set');
    delete room.activeTileSetSize;
    expect(why(inputFor(room, { a: { id: 'seat-x', socketId: '', username: 'X', userId: A } }))).toBe('seat_mismatch');
  });

  it('a room with no game state', async () => {
    const room = await playGame('SKIP5', 6);
    const input = inputFor(room);
    room.state = null;
    expect(why(input)).toBe('no_state');
  });
});

describe('saveMultiplayerGameRecords (the hook the completion calls)', () => {
  it('does nothing while the flag is off', async () => {
    const room = await playGame('HOOK1', 7);
    const insert = vi.fn().mockResolvedValue(undefined);
    saveMultiplayerGameRecords(inputFor(room), { enabled: false, insert });
    expect(insert).not.toHaveBeenCalled();
  });

  it('with the flag on, inserts both rows, built before it returns, so a rematch resetting the room cannot change them', async () => {
    const room = await playGame('HOOK2', 8);
    let received: readonly MultiplayerRecordRow[] = [];
    const insert = vi.fn(async (rows: readonly MultiplayerRecordRow[]) => { received = rows; });
    saveMultiplayerGameRecords(inputFor(room), { enabled: true, insert });
    expect(insert).toHaveBeenCalledTimes(1); // called synchronously, with the rows already built
    room.events = [];
    room.ghostMoveLogs = {};
    expect(received).toHaveLength(2);
    expect(received[0].moves.record.hands.length).toBeGreaterThan(0);
  });

  it('never throws and never leaves a rejection unhandled: a failing insert, a throwing insert, a broken input', async () => {
    const room = await playGame('HOOK3', 9);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    expect(() => saveMultiplayerGameRecords(inputFor(room), { enabled: true, insert: vi.fn().mockRejectedValue(new Error('db down')) })).not.toThrow();
    expect(() => saveMultiplayerGameRecords(inputFor(room), { enabled: true, insert: vi.fn(() => { throw new Error('sync boom'); }) })).not.toThrow();
    expect(() => saveMultiplayerGameRecords({ room: null } as never, { enabled: true, insert: vi.fn() })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('saves nothing for a game it cannot save (a tournament), and does not call the database', async () => {
    const room = await playGame('HOOK4', 10);
    room.scheduledTournamentMatchId = 'm';
    const insert = vi.fn().mockResolvedValue(undefined);
    saveMultiplayerGameRecords(inputFor(room), { enabled: true, insert });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('insertMultiplayerRecordRows', () => {
  it('posts both rows once, ignoring duplicates on (user, match), so a retry is a no-op', async () => {
    fetchMock.mockReset().mockResolvedValue(undefined);
    const room = await playGame('INS1', 11);
    const rows = prepared(inputFor(room));
    await insertMultiplayerRecordRows(rows);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/rest/v1/game_records?on_conflict=user_id,source_match_id');
    expect(init.method).toBe('POST');
    expect(init.headers.Prefer).toContain('resolution=ignore-duplicates');
    expect(JSON.parse(init.body)).toHaveLength(2);
  });
});
