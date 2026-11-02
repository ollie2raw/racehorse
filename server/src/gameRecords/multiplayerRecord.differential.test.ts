/**
 * The differential test for multiplayer game records (docs/review-game-record-architecture.md, "Multiplayer", item 6).
 *
 * Real games are played end to end through the real room code (`startGame`, `act`, `nextHand`) with a seeded policy, a record is DERIVED from what the room
 * holds (events + the server's per-player move log), and that record is then REPLAYED in a second room from explicit deals. Every hand's score and the final
 * result must come out identical. If this holds, a multiplayer game can be saved and rebuilt without changing any authority code.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests, startGame, type ActionPayload, type Room } from '../rooms';
import { createInitialState, generateFullSet, startNewHand } from '../game/engine';
import type { Tile } from '../game/types';
import { deriveMultiplayerRecord, type MultiplayerRecordDraft } from './multiplayerRecord';
import { replayMultiplayerRecord } from './multiplayerReplay';
import { installRoomHarness, makeIo, playGame } from './multiplayerRecord.testkit';

const CFG = createInitialState(['a', 'b']).config;

const tileOf = (key: string): Tile => {
  const [low, high] = key.split('|').map(Number);
  return { low, high };
};
const keyOf = (t: Tile) => `${Math.min(t.low, t.high)}|${Math.max(t.low, t.high)}`;

installRoomHarness();

/** Replays a derived record in a fresh room from its explicit deals. Returns the per-hand scores it produced and the final state. */
async function replay(record: MultiplayerRecordDraft, original: Room): Promise<{ handScores: Array<Record<string, number>>; room: Room }> {
  const code = `RPL${Math.floor(Math.random() * 1e6)}`;
  createReservedRoom(code, { skipPregameDraw: true });
  const room = getRoom(code);
  room.players = [...record.players];
  room.activeTileSetSize = original.activeTileSetSize;
  const full = generateFullSet(original.state!.config.maxPips);
  room.state = createInitialState(record.players, original.state!.config);
  const io = makeIo();
  const handScores: Array<Record<string, number>> = [];

  for (const hand of record.hands) {
    const used = new Set<string>();
    const deck: Tile[] = [];
    for (const seat of record.players) {
      for (const key of hand.deals[seat]) {
        deck.push(tileOf(key));
        used.add(key);
      }
    }
    for (const key of hand.drawn) {
      deck.push(tileOf(key));
      used.add(key);
    }
    for (const t of full) if (!used.has(keyOf(t))) deck.push(t); // never drawn, so their order cannot matter
    room.state = startNewHand(room.state!, deck, hand.starterId);

    for (const action of hand.actions) {
      const payload: ActionPayload =
        action.type === 'MOVE'
          ? { type: 'MOVE', move: { tile: tileOf(action.tile), position: action.position as never } }
          : { type: action.type };
      await act(code, action.seat, payload, io, () => {});
    }
    handScores.push(Object.fromEntries(record.players.map((p) => [p, room.state!.players[p].score])));
  }
  return { handScores, room };
}

const SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7);

describe('multiplayer game records: a derived record replays to the same game', () => {
  it.each(SEEDS)('seed %i: every hand and the final result match', async (seed) => {
    const original = await playGame(`DIFF${seed}`, seed);
    const derived = deriveMultiplayerRecord({ players: original.players, config: original.state!.config, tileSetSize: original.activeTileSetSize, events: original.events, ghostMoveLogs: original.ghostMoveLogs });
    expect(derived.ok, JSON.stringify(derived)).toBe(true);
    if (!derived.ok) return;

    const { handScores, room } = await replay(derived.record, original);

    expect(handScores).toEqual(derived.record.hands.map((h) => h.endScores));
    const finalOriginal = Object.fromEntries(original.players.map((p) => [p, original.state!.players[p].score]));
    expect(derived.record.finalScores).toEqual(finalOriginal);
    expect(Object.fromEntries(room.players.map((p) => [p, room.state!.players[p].score]))).toEqual(finalOriginal);
    expect(room.state!.gameOver).toBe(true);
    expect(room.state!.winnerId).toBe(original.state!.winnerId);
    expect(derived.record.winnerId).toBe(original.state!.winnerId);

    // The same record, replayed by the engine alone (no room): this is the one that can run in production.
    const pure = replayMultiplayerRecord(derived.record);
    expect(pure, JSON.stringify(pure)).toMatchObject({ ok: true, finalScores: finalOriginal, winnerId: original.state!.winnerId });
    if (pure.ok) expect(pure.handScores).toEqual(handScores);
  });

  it('records more than one hand in a typical game, including draws and passes, so the coverage above means something', async () => {
    let multiHand = 0;
    let draws = 0;
    let passes = 0;
    for (const seed of SEEDS) {
      const original = await playGame(`COV${seed}`, seed);
      const derived = deriveMultiplayerRecord({ players: original.players, config: original.state!.config, tileSetSize: original.activeTileSetSize, events: original.events, ghostMoveLogs: original.ghostMoveLogs });
      if (!derived.ok) continue;
      if (derived.record.hands.length > 1) multiHand += 1;
      for (const hand of derived.record.hands) {
        draws += hand.actions.filter((a) => a.type === 'DRAW').length;
        passes += hand.actions.filter((a) => a.type === 'PASS').length;
      }
      resetRoomRuntimeForTests();
    }
    // Measured on these seeds: every game has several hands and there are hundreds of submitted draws (forced draws after a play are exercised too).
    // Submitted PASS never happens in real play (the engine auto-passes a blocked seat), so that rule has its own unit test below.
    expect(multiHand).toBeGreaterThan(20);
    expect(draws).toBeGreaterThan(200);
    expect(passes).toBe(0);
  });
});

describe('the pure replay does not trust a record that does not add up', () => {
  async function goodRecord(seed = 2024): Promise<MultiplayerRecordDraft> {
    const original = await playGame(`TAMP${seed}`, seed);
    const derived = deriveMultiplayerRecord({ players: original.players, config: original.state!.config, tileSetSize: original.activeTileSetSize, events: original.events, ghostMoveLogs: original.ghostMoveLogs });
    if (!derived.ok) throw new Error(derived.reason);
    return structuredClone(derived.record);
  }
  const reasonOf = (r: ReturnType<typeof replayMultiplayerRecord>) => (r.ok ? 'ok' : r.reason);

  it('the untouched record replays', async () => {
    expect(reasonOf(replayMultiplayerRecord(await goodRecord()))).toBe('ok');
  });

  it('a swapped tile in a deal', async () => {
    const rec = await goodRecord();
    const [a, b] = rec.players;
    [rec.hands[0].deals[a][0], rec.hands[0].deals[b][0]] = [rec.hands[0].deals[b][0], rec.hands[0].deals[a][0]];
    expect(reasonOf(replayMultiplayerRecord(rec))).not.toBe('ok');
  });

  it('a deal of the wrong size, a repeated tile, and a malformed tile', async () => {
    const short = await goodRecord();
    short.hands[0].deals[short.players[0]].pop();
    expect(reasonOf(replayMultiplayerRecord(short))).toMatch(/^bad_deal_size:/);

    const repeated = await goodRecord();
    repeated.hands[0].deals[repeated.players[1]][0] = repeated.hands[0].deals[repeated.players[0]][0];
    expect(reasonOf(replayMultiplayerRecord(repeated))).toMatch(/^bad_or_repeated_tile:/);

    const malformed = await goodRecord();
    malformed.hands[0].deals[malformed.players[0]][0] = 'banana';
    expect(reasonOf(replayMultiplayerRecord(malformed))).toMatch(/^bad_or_repeated_tile:/);
  });

  it('an action by the wrong seat, or of a tile the seat does not hold', async () => {
    const wrongSeat = await goodRecord();
    const first = wrongSeat.hands[0].actions[0];
    first.seat = wrongSeat.players.find((p) => p !== first.seat)!;
    expect(reasonOf(replayMultiplayerRecord(wrongSeat))).toMatch(/^illegal_action:/);

    const notHeld = await goodRecord();
    const move = notHeld.hands[0].actions.find((a) => a.type === 'MOVE');
    if (move?.type === 'MOVE') move.tile = '9|9';
    expect(reasonOf(replayMultiplayerRecord(notHeld))).toMatch(/^illegal_action:/);
  });

  it('a missing last action leaves the hand unfinished', async () => {
    const rec = await goodRecord();
    rec.hands[0].actions.pop();
    expect(reasonOf(replayMultiplayerRecord(rec))).not.toBe('ok');
  });

  it('a recorded score that is not what the engine produces', async () => {
    const hand = await goodRecord();
    hand.hands[0].endScores![hand.players[0]] += 5;
    expect(reasonOf(replayMultiplayerRecord(hand))).toBe('score_mismatch:hand_1');

    const final = await goodRecord();
    final.finalScores[final.players[1]] += 5;
    expect(reasonOf(replayMultiplayerRecord(final))).toBe('final_score_mismatch');

    const winner = await goodRecord();
    winner.winnerId = winner.players.find((p) => p !== winner.winnerId) ?? null;
    expect(reasonOf(replayMultiplayerRecord(winner))).toBe('winner_mismatch');
  });

  it('draws that do not add up to the recorded draw order', async () => {
    const rec = await goodRecord();
    const hand = rec.hands.find((h) => h.drawn.length > 0)!;
    hand.drawn.pop();
    expect(reasonOf(replayMultiplayerRecord(rec))).not.toBe('ok');
  });

  it('a record made under a different version of the rules is refused with its own reason, not reported as a score mismatch', async () => {
    const newer = await goodRecord();
    newer.rulesVersion = 2;
    expect(reasonOf(replayMultiplayerRecord(newer))).toBe('unsupported_rules_version:2');
  });

  it('a record with no rules version (saved before the field existed) means version 1', async () => {
    const rec = await goodRecord();
    expect(rec.rulesVersion).toBe(1); // new records are stamped
    delete rec.rulesVersion;
    expect(reasonOf(replayMultiplayerRecord(rec))).toBe('ok');
  });

  it('never throws on garbage', () => {
    expect(replayMultiplayerRecord({ players: ['a', 'b'], config: CFG, hands: [{ handNumber: 1, starterId: 'a', deals: {}, actions: [], drawn: [], endScores: null }], finalScores: {}, winnerId: null }).ok).toBe(false);
    expect(replayMultiplayerRecord({ players: ['a', 'b'], config: CFG, hands: [], finalScores: {}, winnerId: null }).ok).toBe(false);
  });
});

describe('deriveMultiplayerRecord refuses what it cannot rebuild', () => {
  it('a game that has not finished', async () => {
    const io = makeIo();
    createReservedRoom('UNFIN', { skipPregameDraw: true });
    joinRoom('UNFIN', 'seat-a');
    joinRoom('UNFIN', 'seat-b');
    const room = getRoom('UNFIN');
    room.players = ['seat-a', 'seat-b'];
    room.state = null;
    await startGame('UNFIN', io);
    const result = deriveMultiplayerRecord({ players: room.players, config: room.state!.config, tileSetSize: room.activeTileSetSize, events: room.events, ghostMoveLogs: room.ghostMoveLogs });
    expect(result).toEqual({ ok: false, reason: 'not_finished' });
  });

  it('a game whose move log has a gap (a seat with no logged action in a hand)', async () => {
    const original = await playGame('GAP1', 4242);
    const gappy = { ...original.ghostMoveLogs, 'seat-a': [] };
    const result = deriveMultiplayerRecord({ players: original.players, config: original.state!.config, tileSetSize: original.activeTileSetSize, events: original.events, ghostMoveLogs: gappy });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/^missing_deal:seat-a:/);
  });

  describe('which passes count as submitted', () => {
    const ev = (sequence: number, type: string, actorSocketId: string | null, payload: Record<string, unknown> = {}) => ({ sequence, type, actorSocketId, payload }) as never;
    const base = [
      ev(1, 'hand_started', null, { handNumber: 1, currentPlayerId: 'a' }),
    ];
    const end = [
      ev(90, 'hand_ended', 'a', { handNumber: 1, winnerId: 'a', gameOver: true, scores: { a: 60, b: 10 } }),
      ev(91, 'match_ended', 'a', { winnerId: 'a', handNumber: 1, scores: { a: 60, b: 10 } }),
    ];
    const logs = { a: [{ hand_number: 1, hand_before: ['1|2'] }], b: [{ hand_number: 1, hand_before: ['3|4'] }] } as never;
    const actionsOf = (events: unknown[]) => {
      const r = deriveMultiplayerRecord({ players: ['a', 'b'], config: CFG, tileSetSize: 28, events: events as never, ghostMoveLogs: logs });
      if (!r.ok) throw new Error(r.reason);
      return r.record.hands[0].actions;
    };

    it('a pass straight after a draw is the draw running out of boneyard, so it is not a submitted action', () => {
      expect(actionsOf([...base, ev(2, 'draw_requested', null, { playerSeatId: 'a' }), ev(3, 'tile_drawn', 'a', { tile: '0|1' }), ev(4, 'turn_passed', 'a'), ...end]))
        .toEqual([{ seat: 'a', type: 'DRAW' }]);
      expect(actionsOf([...base, ev(2, 'draw_requested', null, { playerSeatId: 'a' }), ev(3, 'turn_passed', 'a'), ...end]))
        .toEqual([{ seat: 'a', type: 'DRAW' }]);
    });

    it('a pass that does not follow a draw was submitted', () => {
      expect(actionsOf([...base, ev(2, 'tile_played', 'a', { tile: '1|2', position: 'left' }), ev(3, 'turn_passed', 'b'), ...end]))
        .toEqual([{ seat: 'a', type: 'MOVE', tile: '1|2', position: 'left' }, { seat: 'b', type: 'PASS' }]);
    });

    it('tiles drawn by a forced draw after a play are recorded as drawn, not as actions', () => {
      const result = deriveMultiplayerRecord({
        players: ['a', 'b'],
        config: CFG,
        tileSetSize: 28,
        events: [...base, ev(2, 'tile_played', 'a', { tile: '1|2', position: 'left', forcedDraw: true }), ev(3, 'tile_drawn', 'a', { tile: '5|6' }), ...end] as never,
        ghostMoveLogs: logs,
      });
      expect(result.ok && result.record.hands[0].actions).toEqual([{ seat: 'a', type: 'MOVE', tile: '1|2', position: 'left' }]);
      expect(result.ok && result.record.hands[0].drawn).toEqual(['5|6']);
    });
  });

  it('a room that dealt from a custom deck (a replay from the standard set would see locked hands differently)', async () => {
    const original = await playGame('CUSTOM1', 77);
    const result = deriveMultiplayerRecord({ players: original.players, config: original.state!.config, tileSetSize: 10, events: original.events, ghostMoveLogs: original.ghostMoveLogs });
    expect(result).toEqual({ ok: false, reason: 'custom_tile_set' });
    const standard = deriveMultiplayerRecord({ players: original.players, config: original.state!.config, tileSetSize: 28, events: original.events, ghostMoveLogs: original.ghostMoveLogs });
    expect(standard.ok).toBe(true);
  });

  it('anything but two players', () => {
    expect(deriveMultiplayerRecord({ players: ['a', 'b', 'c'], config: CFG, tileSetSize: 28, events: [], ghostMoveLogs: {} })).toEqual({ ok: false, reason: 'not_two_players' });
  });
});
