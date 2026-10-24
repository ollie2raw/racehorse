// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentRoomMatchId,
  emitGameAction,
  emitGameRematch,
  emitHandReady,
  emitRoomAbandonMatch,
  setRoomMatchIdReader,
} from './roomTransport';
import { buildLogicalActionSignature, resolveLogicalActionRequestId } from '../match/session/actions/gameplayActionIdentity';

function socket() {
  const emit = vi.fn((_event: string, ...args: unknown[]) => {
    const last = args[args.length - 1];
    if (typeof last === 'function') (last as (r: unknown) => void)({ ok: true });
  });
  return { emit };
}
const sent = (s: ReturnType<typeof socket>, event: string) => s.emit.mock.calls.find(([e]) => e === event)!.slice(1);

afterEach(() => setRoomMatchIdReader(() => null));

describe('match-generation binding (client -> server)', () => {
  it('reads the room session\'s own match id and never invents one', () => {
    expect(currentRoomMatchId()).toBeNull();
    setRoomMatchIdReader(() => 'match-A');
    expect(currentRoomMatchId()).toBe('match-A');
    setRoomMatchIdReader(() => { throw new Error('ref gone'); });
    expect(currentRoomMatchId()).toBeNull();
  });

  it('game:action carries the match id it was created with; a retry after a rematch keeps game A\'s id', async () => {
    let live = 'match-A';
    setRoomMatchIdReader(() => live);
    const baselineSequence = 10;
    const signature = buildLogicalActionSignature({ kind: 'pass', roomCode: 'ROOM1', playerId: 'p1', baselineSequence, handNumber: 1 });
    const params = { kind: 'pass' as const, roomCode: 'ROOM1', playerId: 'p1', baselineSequence, handNumber: 1, signature };
    const created = resolveLogicalActionRequestId({ current: null, ...params, matchId: currentRoomMatchId() });
    expect(created.matchId).toBe('match-A');

    const s = socket();
    await emitGameAction(s, 'ROOM1', { type: 'PASS', requestId: created.requestId, matchId: created.matchId });
    expect(sent(s, 'game:action')[1]).toMatchObject({ requestId: created.requestId, matchId: 'match-A' });

    // response lost -> logical action is marked uncertain; rematch begins (the session now reports B)
    live = 'match-B';
    const retry = resolveLogicalActionRequestId({ current: { ...created, uncertain: true }, ...params, matchId: null });
    expect(retry.requestId).toBe(created.requestId);
    expect(retry.matchId).toBe('match-A');
    const s2 = socket();
    await emitGameAction(s2, 'ROOM1', { type: 'PASS', requestId: retry.requestId, matchId: retry.matchId });
    expect(sent(s2, 'game:action')[1]).toMatchObject({ requestId: created.requestId, matchId: 'match-A' });

    // knowing positively that the match changed means it is NOT a retry: new request id, new match id
    const fresh = resolveLogicalActionRequestId({ current: { ...created, uncertain: true }, ...params, matchId: 'match-B' });
    expect(fresh.requestId).not.toBe(created.requestId);
    expect(fresh.matchId).toBe('match-B');
  });

  it('an explicitly unbound command (null) is never silently bound to a later match', async () => {
    setRoomMatchIdReader(() => 'match-B');
    const s = socket();
    await emitGameAction(s, 'ROOM1', { type: 'DRAW', requestId: 'r1', matchId: null });
    expect(sent(s, 'game:action')[1]).not.toHaveProperty('matchId', 'match-B');
    expect((sent(s, 'game:action')[1] as { matchId?: unknown }).matchId).toBeUndefined();
  });

  it('a bare payload (no matchId key) is stamped with the current match at emit time', async () => {
    setRoomMatchIdReader(() => 'match-A');
    const s = socket();
    await emitGameAction(s, 'ROOM1', { type: 'DRAW', requestId: 'r2' });
    expect(sent(s, 'game:action')[1]).toMatchObject({ matchId: 'match-A' });
  });

  it('hand:ready, game:rematch and room:abandon_match carry the current match id', async () => {
    setRoomMatchIdReader(() => 'match-A');
    const s = socket();
    await emitHandReady(s, 'ROOM1', 2);
    emitGameRematch(s, 'ROOM1', () => undefined);
    await emitRoomAbandonMatch(s, { roomCode: 'ROOM1', tournamentMatchId: null });
    expect(sent(s, 'hand:ready')[1]).toMatchObject({ handNumber: 2, matchId: 'match-A' });
    expect(sent(s, 'game:rematch')[1]).toEqual({ matchId: 'match-A' });
    expect(sent(s, 'room:abandon_match')[0]).toMatchObject({ roomCode: 'ROOM1', matchId: 'match-A' });
  });

  it('with no known match id the legacy wire shapes are preserved', async () => {
    const s = socket();
    emitGameRematch(s, 'ROOM1', () => undefined);
    expect(sent(s, 'game:rematch')).toHaveLength(2); // (code, ack) - unchanged
    await emitHandReady(s, 'ROOM1', 1);
    expect((sent(s, 'hand:ready')[1] as { matchId?: unknown }).matchId).toBeUndefined();
  });
});
