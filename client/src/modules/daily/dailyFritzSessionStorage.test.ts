import { beforeEach, describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { createDailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import { buildDailyFritzStorageKey, loadPersistedDailyFritzMatch, parseDailyFritzPersistedSnapshot, persistDailyFritzSnapshot, type DailyFritzPersistedSnapshot } from './dailyFritzSessionStorage.ts';

const now = new Date('2026-07-12T20:00:00.000Z');
function snapshot(overrides: Partial<DailyFritzPersistedSnapshot> = {}): DailyFritzPersistedSnapshot {
  const match = createBotMatch(60, 7);
  match.players.you.score = 35;
  match.players.bot.score = 20;
  return { schemaVersion:4,challenge:createDailyFritzChallengeIdentity('2026-07-12'),classification:'official',attemptId:'attempt-1',gameNumber:1,currentHandIndex:2,lifecyclePhase:'active_hand',match,handResult:null,movesUsed:4,moveLog:[],transcript:null,verificationPhase:'collecting',startedAt:'2026-07-12T18:00:00.000Z',lastTransitionAt:'2026-07-12T18:01:00.000Z',revision:2,...overrides };
}

describe('Daily Fritz v3 session persistence', () => {
  beforeEach(() => window.localStorage.clear());
  it('round-trips a valid active hand without resetting cumulative scores', () => {
    const key=buildDailyFritzStorageKey('attempt-1',1);const value=snapshot();
    expect(persistDailyFritzSnapshot(key,value)).toBe(true);
    const loaded=loadPersistedDailyFritzMatch(key,'attempt-1',2,'2026-07-12',now);
    expect(loaded?.match.players.you.score).toBe(35);expect(loaded?.match.players.bot.score).toBe(20);
  });
  it('keeps a newer local checkpoint when the server hand index is behind', () => {
    const key = buildDailyFritzStorageKey('attempt-1', 1);
    const value = snapshot({ currentHandIndex: 4 });
    expect(persistDailyFritzSnapshot(key, value)).toBe(true);
    expect(loadPersistedDailyFritzMatch(key, 'attempt-1', 0, '2026-07-12', now)?.currentHandIndex).toBe(4);
  });
  it('rejects malformed, stale-date, version-mismatched, and impossible phase payloads', () => {
    expect(parseDailyFritzPersistedSnapshot({},now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot(snapshot({challenge:createDailyFritzChallengeIdentity('2026-07-11')}),now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot({...snapshot(),schemaVersion:2},now)).toBeNull();
    expect(parseDailyFritzPersistedSnapshot(snapshot({lifecyclePhase:'hand_transition'}),now)).toBeNull();
  });
  it('retains a coherent hand-transition snapshot and rejects terminal resume', () => {
    const transitionMatch=createBotMatch(60,7);transitionMatch.handOver=true;
    const handResult={winner:'you' as const,reason:'domino' as const,pointsAwarded:10,loserPips:10,calcText:'10 points',yourRemainingTiles:[],botRemainingTiles:[{low:1,high:2}]};
    expect(parseDailyFritzPersistedSnapshot(snapshot({match:transitionMatch,lifecyclePhase:'hand_transition',handResult}),now)?.lifecyclePhase).toBe('hand_transition');
    const completedMatch={...transitionMatch,handOver:false,gameOver:true};
    const key=buildDailyFritzStorageKey('attempt-1',1);persistDailyFritzSnapshot(key,snapshot({match:completedMatch,lifecyclePhase:'completed'}));
    expect(loadPersistedDailyFritzMatch(key,'attempt-1',2,'2026-07-12',now)).toBeNull();
  });
  it('prevents an older revision or timestamp from overwriting newer state', () => {
    const key=buildDailyFritzStorageKey('attempt-1',1);expect(persistDailyFritzSnapshot(key,snapshot({revision:5}))).toBe(true);
    expect(persistDailyFritzSnapshot(key,snapshot({revision:4,lastTransitionAt:'2026-07-12T18:02:00.000Z'}))).toBe(false);
    expect(JSON.parse(localStorage.getItem(key)!).revision).toBe(5);
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
