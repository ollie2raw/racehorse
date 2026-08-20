import { resolveDailyFritzMatchSession } from './resolveDailyFritzSession.ts';
import { isCoherentDailyFritzSession } from './dailyFritzMatchSession.ts';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import type { DailyFritzPersistedSnapshot } from './dailyFritzSessionStorage.ts';
import { describe, expect, it } from 'vitest';

function startPackage(overrides: Partial<DailyFritzStartResponse> = {}): DailyFritzStartResponse {
  return {
    attempt_id: 'attempt-1',
    verified_match_id: 'verified-1',
    run_date: '2026-07-12',
    run_fingerprint: 'fp',
    challenge_id: 'challenge',
    current_game_number: 1,
    current_hand_index: 2,
    authority_revision: 7,
    deal_size: 7,
    winning_score: 60,
    draw_winner: 'you',
    first_hand: {
      player_tiles: [{ low: 0, high: 1 }],
      fritz_tiles: [{ low: 2, high: 3 }],
      boneyard: [],
      locked: [],
    },
    ...overrides,
  } as DailyFritzStartResponse;
}

describe('resolveDailyFritzMatchSession', () => {
  it('binds persisted snapshot cursor and match together', () => {
    const match = createBotMatch(60, 7);
    match.handNumber = 3;
    const persisted = {
      currentHandIndex: 2,
      authorityRevision: 7,
      match,
    } as DailyFritzPersistedSnapshot;

    const session = resolveDailyFritzMatchSession({
      dailyFritzPackage: startPackage(),
      winningScore: 60,
      persistedSnapshot: persisted,
      preGameDrawEligible: false,
    });

    expect(session.cursor.handIndex).toBe(2);
    expect(session.cursor.revision).toBe(7);
    expect(session.cursor.gameNumber).toBe(1);
    expect(session.match).toBe(match);
    expect(isCoherentDailyFritzSession(session)).toBe(true);
  });

  it('uses server package cursor when no persisted snapshot exists', () => {
    const session = resolveDailyFritzMatchSession({
      dailyFritzPackage: startPackage({ current_hand_index: 0, authority_revision: 3 }),
      winningScore: 60,
      persistedSnapshot: null,
      preGameDrawEligible: false,
    });

    expect(session.cursor.revision).toBe(3);
    expect(session.cursor.handIndex).toBe(0);
    expect(session.match.handNumber).toBe(1);
    expect(isCoherentDailyFritzSession(session)).toBe(true);
  });
});
