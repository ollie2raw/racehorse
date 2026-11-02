import { describe, expect, it } from 'vitest';
import fixture from './fixtures/multiplayerSavedGame.json';
import {
  rebuildMultiplayerGameFromRecord,
  type SavedMultiplayerRecord,
} from './rebuildMultiplayerGameFromRecord.ts';

/**
 * `fixtures/multiplayerSavedGame.json` is a REAL saved game: a seeded game played through the server's real room code (13 hands, with draws), saved exactly as
 * server/src/gameRecords/saveMultiplayerRecord.ts saves it. The server suite (multiplayerRecord.clientRebuild.test.ts) proves 24 such games rebuild here to the
 * server's scores; these tests pin the behaviour with no server involved, and the refusals.
 */
const good = () => structuredClone(fixture) as unknown as SavedMultiplayerRecord;

describe('rebuildMultiplayerGameFromRecord', () => {
  it('rebuilds a real saved game to the recorded result, hand by hand', () => {
    const saved = good();
    const result = rebuildMultiplayerGameFromRecord(saved);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
    if (!result.ok) return;
    const { finalState, moveLog, snapshots } = result.game;
    expect(finalState.gameOver).toBe(true);
    expect({ you: finalState.players.you.score, opponent: finalState.players.bot.score }).toEqual({ you: saved.result.you, opponent: saved.result.opponent });
    expect(saved.record.hands.length).toBeGreaterThan(5);
    expect(snapshots.length).toBeGreaterThan(saved.record.hands.length);
    // both seats' decisions are captured, as in a Play vs Fritz rebuild
    expect(snapshots.some((s) => s.identifiers.decisionId.includes(':you:'))).toBe(true);
    expect(snapshots.some((s) => s.identifiers.decisionId.includes(':bot:'))).toBe(true);
    expect(moveLog.some((m) => m.player === 'you')).toBe(true);
    expect(moveLog.some((m) => m.player === 'opponent')).toBe(true);
    expect(moveLog.some((m) => m.action === 'draw')).toBe(true);
  });

  it('is deterministic: the same record always yields the same decision ids, so the same review job', () => {
    const ids = () => {
      const r = rebuildMultiplayerGameFromRecord(good());
      if (!r.ok) throw new Error(r.detail);
      return r.game.snapshots.map((s) => s.identifiers.decisionId);
    };
    expect(ids()).toEqual(ids());
  });

  it('treats a record with no rules version (saved before the field existed) as version 1, and accepts an explicit 1', () => {
    const none = good();
    expect(none.record.rulesVersion).toBeUndefined();
    expect(rebuildMultiplayerGameFromRecord(none)).toMatchObject({ ok: true });
    const one = good();
    one.record = { ...one.record, rulesVersion: 1 };
    expect(rebuildMultiplayerGameFromRecord(one)).toMatchObject({ ok: true });
  });

  it('refuses a game saved under a different version of the rules, and says so', () => {
    const saved = good();
    saved.record = { ...saved.record, rulesVersion: 2 };
    expect(rebuildMultiplayerGameFromRecord(saved)).toMatchObject({ ok: false, reason: 'not_replayable', detail: expect.stringMatching(/version 2 of the rules/) });
  });

  it('refuses a record with no hands', () => {
    const saved = good();
    saved.record = { ...saved.record, hands: [] };
    expect(rebuildMultiplayerGameFromRecord(saved)).toMatchObject({ ok: false, reason: 'not_replayable' });
  });

  it('refuses a game that is not double-six', () => {
    const saved = good();
    saved.record = { ...saved.record, config: { ...saved.record.config, maxPips: 9 } };
    expect(rebuildMultiplayerGameFromRecord(saved)).toMatchObject({ ok: false, detail: expect.stringMatching(/double-six/) });
  });

  it('refuses a swapped tile in a deal (the first move no longer fits the hands)', () => {
    const saved = good();
    const deals = saved.record.hands[0]!.deals as { you: string[]; opponent: string[] };
    [deals.you[0], deals.opponent[0]] = [deals.opponent[0]!, deals.you[0]!];
    expect(rebuildMultiplayerGameFromRecord(saved).ok).toBe(false);
  });

  it('refuses a repeated or malformed tile', () => {
    const repeated = good();
    const d = repeated.record.hands[0]!.deals as { you: string[]; opponent: string[] };
    d.opponent[0] = d.you[0]!;
    expect(rebuildMultiplayerGameFromRecord(repeated)).toMatchObject({ ok: false, reason: 'not_replayable', detail: expect.stringMatching(/malformed or repeated/) });

    const malformed = good();
    (malformed.record.hands[0]!.deals as { you: string[] }).you[0] = 'banana';
    expect(rebuildMultiplayerGameFromRecord(malformed)).toMatchObject({ ok: false, reason: 'not_replayable' });
  });

  it('refuses an action by the seat that is not on turn', () => {
    const saved = good();
    const first = saved.record.hands[0]!.actions[0] as { seat: 'you' | 'opponent' };
    first.seat = first.seat === 'you' ? 'opponent' : 'you';
    expect(rebuildMultiplayerGameFromRecord(saved)).toMatchObject({ ok: false, reason: 'not_replayable', detail: expect.stringMatching(/turn/) });
  });

  it('refuses a hand with its last action missing, and a record that stops early', () => {
    const noLast = good();
    (noLast.record.hands[0]!.actions as unknown[]).pop();
    expect(rebuildMultiplayerGameFromRecord(noLast)).toMatchObject({ ok: false });

    const stops = good();
    stops.record = { ...stops.record, hands: stops.record.hands.slice(0, -1) };
    expect(rebuildMultiplayerGameFromRecord(stops)).toMatchObject({ ok: false, reason: 'incomplete_game' });
  });

  it('refuses a hand that starts with the wrong seat', () => {
    const saved = good();
    const hand = saved.record.hands[1]!;
    (hand as { starterId: string }).starterId = hand.starterId === 'you' ? 'opponent' : 'you';
    expect(rebuildMultiplayerGameFromRecord(saved)).toMatchObject({ ok: false, reason: 'not_replayable', detail: expect.stringMatching(/should start with/) });
  });

  it('refuses scores that are not what the engine produces: a hand, and the final result', () => {
    const hand = good();
    hand.record.hands[2]!.endScores = { you: 1, opponent: 1 };
    expect(rebuildMultiplayerGameFromRecord(hand)).toMatchObject({ ok: false, reason: 'result_mismatch', detail: expect.stringMatching(/Hand 3 replayed/) });

    const final = good();
    final.result = { ...final.result, you: final.result.you + 5 };
    expect(rebuildMultiplayerGameFromRecord(final)).toMatchObject({ ok: false, reason: 'result_mismatch' });
  });

  it('refuses a draw submitted while a play was available', () => {
    const saved = good();
    // Turn the first PLAY of the first hand into a draw: the seat has a legal play, so a draw is not allowed.
    const hand = saved.record.hands[0]!;
    const i = hand.actions.findIndex((a) => a.type === 'MOVE');
    (hand.actions as Array<{ seat: string; type: string }>)[i] = { seat: hand.actions[i]!.seat, type: 'DRAW' };
    expect(rebuildMultiplayerGameFromRecord(saved)).toMatchObject({ ok: false, reason: 'not_replayable' });
  });
});
