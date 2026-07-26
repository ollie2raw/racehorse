import { beforeEach, describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { createDailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import { buildDailyFritzStorageKey, DAILY_FRITZ_SESSION_SCHEMA_VERSION, loadPersistedDailyFritzMatch, parseDailyFritzPersistedSnapshot, persistDailyFritzSnapshot, type DailyFritzPersistedSnapshot } from './dailyFritzSessionStorage.ts';

const now = new Date('2026-07-12T20:00:00.000Z');
const RUN_FP = 'abc123fingerprint00000000000000';
function snapshot(overrides: Partial<DailyFritzPersistedSnapshot> = {}): DailyFritzPersistedSnapshot {
  const match = createBotMatch(60, 7);
  match.players.you.score = 35;
  match.players.bot.score = 20;
  return {
    schemaVersion: DAILY_FRITZ_SESSION_SCHEMA_VERSION,
    challenge: createDailyFritzChallengeIdentity('2026-07-12'),
    classification: 'official',
    attemptId: 'attempt-1',
    runFingerprint: RUN_FP,
    gameNumber: 1,
    currentHandIndex: 2,
    lifecyclePhase: 'active_hand',
    match,
    handResult: null,
    movesUsed: 4,
    moveLog: [],
    transcript: null,
    verificationPhase: 'collecting',
    startedAt: '2026-07-12T18:00:00.000Z',
    lastTransitionAt: '2026-07-12T18:01:00.000Z',
    revision: 2,
    ...overrides,
  };
}

describe('Daily Fritz v3 session persistence', () => {
  beforeEach(() => window.localStorage.clear());
  it('round-trips a valid active hand without resetting cumulative scores', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const value = snapshot();
    expect(persistDailyFritzSnapshot(key, value)).toBe(true);
    const loaded = loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, RUN_FP);
    expect(loaded?.match.players.you.score).toBe(35);
    expect(loaded?.match.players.bot.score).toBe(20);
  });
  it('rejects a local checkpoint that does not match the server hand index', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const value = snapshot({ currentHandIndex: 4 });
    expect(persistDailyFritzSnapshot(key, value)).toBe(true);
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 0, '2026-07-12', now, RUN_FP)).toBeNull();
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 4, '2026-07-12', now, RUN_FP)?.currentHandIndex).toBe(4);
  });
  it('rejects a checkpoint when the server run fingerprint changes', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot())).toBe(true);
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, 'different-fingerprint')).toBeNull();
  });
  it('rejects malformed, stale-date, version-mismatched, and impossible phase payloads', () => {
    expect(parseDailyFritzPersistedSnapshot({}, now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot(snapshot({ challenge: createDailyFritzChallengeIdentity('2026-07-11') }), now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot({ ...snapshot(), schemaVersion: 6 }, now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot(snapshot({ lifecyclePhase: 'hand_transition' }), now)).toBeNull();
  });
  it('retains a coherent hand-transition snapshot and rejects terminal resume', () => {
    const transitionMatch = createBotMatch(60, 7);
    transitionMatch.handOver = true;
    const handResult = {
      winner: 'you' as const,
      reason: 'domino' as const,
      pointsAwarded: 10,
      loserPips: 10,
      calcText: '10 points',
      yourRemainingTiles: [],
      botRemainingTiles: [{ low: 1, high: 2 }],
    };
    expect(parseDailyFritzPersistedSnapshot(snapshot({ match: transitionMatch, lifecyclePhase: 'hand_transition', handResult }), now)?.lifecyclePhase).toBe('hand_transition');
    const completedMatch = { ...transitionMatch, handOver: false, gameOver: true };
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    persistDailyFritzSnapshot(key, snapshot({ match: completedMatch, lifecyclePhase: 'completed' }));
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, RUN_FP)).toBeNull();
  });
  it('resumes mid-hand with the exact server hand index and preserved board/boneyard', () => {
    const midHand = createBotMatch(60, 7);
    midHand.players.you.score = 18;
    midHand.players.bot.score = 12;
    midHand.boneyard = midHand.boneyard.slice(0, 5);
    midHand.handNumber = 3;
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot({
      currentHandIndex: 2,
      lifecyclePhase: 'active_hand',
      match: midHand,
      movesUsed: 11,
    }))).toBe(true);
    const loaded = loadPersistedDailyFritzMatch(key, 'attempt-1', 2, '2026-07-12', now, RUN_FP);
    expect(loaded?.currentHandIndex).toBe(2);
    expect(loaded?.match.players.you.score).toBe(18);
    expect(loaded?.match.players.bot.score).toBe(12);
    expect(loaded?.match.boneyard).toHaveLength(5);
    expect(loaded?.match.handNumber).toBe(3);
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 3, '2026-07-12', now, RUN_FP)).toBeNull();
  });
  it('prevents an older revision or timestamp from overwriting newer state', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    expect(persistDailyFritzSnapshot(key, snapshot({ revision: 5 }))).toBe(true);
    expect(persistDailyFritzSnapshot(key, snapshot({ revision: 4, lastTransitionAt: '2026-07-12T18:02:00.000Z' }))).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!).revision).toBe(5);
  });
  it('removes and replaces a checkpoint from the unsafe draw-presentation schema', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    window.localStorage.setItem(key, JSON.stringify({
      ...snapshot(),
      schemaVersion: 6,
      revision: 99,
    }));

    expect(loadPersistedDailyFritzMatch(
      key,
      'attempt-1',
      2,
      '2026-07-12',
      now,
      RUN_FP,
    )).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();

    expect(persistDailyFritzSnapshot(key, snapshot({ revision: 1 }))).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(key)!).schemaVersion)
      .toBe(DAILY_FRITZ_SESSION_SCHEMA_VERSION);
  });
  it('repairs duplicate physical-tile evidence before a saved hand resumes', () => {
    const duplicatePlacement = {
      moveNumber: 1,
      handNumber: 1,
      player: 'you' as const,
      action: 'place' as const,
      tile: [0, 5] as [number, number],
      position: 'left' as const,
      boardEnds: [-1, -1] as [number, number],
      handBefore: [[0, 5]] as [number, number][],
      validMoves: [[0, 5]] as [number, number][],
      pipDelta: 5,
      pointsScored: 1,
      boardState: [],
      boardRenderState: null,
      handSnapshot: [[0, 5]] as [number, number][],
      engineBestMove: null,
    };
    const parsed = parseDailyFritzPersistedSnapshot(snapshot({
      moveLog: [
        duplicatePlacement,
        {
          ...duplicatePlacement,
          moveNumber: 3,
          position: 'right',
          boardEnds: [5, 5],
        },
      ],
    }), now);

    expect(parsed?.moveLog).toHaveLength(1);
    expect(parsed?.moveLog[0]?.moveNumber).toBe(1);
  });
  it.each([
    { low: -1, high: 2 },
    { low: 1, high: -1 },
    { low: 7, high: 7 },
    { low: 1, high: 7 },
    { low: 1.5, high: 2 },
    { low: 1, high: '2' },
    { low: 1 },
  ])('rejects an invalid persisted tile %#', (tile) => {
    const value = snapshot();
    value.match.players.you.hand = [tile as never];
    expect(parseDailyFritzPersistedSnapshot(value, now)).toBeNull();
  });
});
