import { describe, expect, it } from 'vitest';
import { withoutBlockedPlayers } from './blockedFeed';
import { selectReportableOpponent } from './reportableOpponent';
import { REPORT_CATEGORIES } from './moderationTypes';

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';

describe('withoutBlockedPlayers', () => {
  const feed = [
    { id: '1', user_id: THEM },
    { id: '2', user_id: ME },
    { id: '3', user_id: 'someone' },
  ];

  it('drops only items by blocked players', () => {
    expect(withoutBlockedPlayers(feed, [THEM]).map((i) => i.id)).toEqual(['2', '3']);
  });

  it('leaves the feed alone with no blocks (or signed out)', () => {
    expect(withoutBlockedPlayers(feed, [])).toEqual(feed);
    expect(withoutBlockedPlayers(feed, null)).toEqual(feed);
  });
});

describe('selectReportableOpponent', () => {
  const players = [
    { id: 'seat-me', username: 'me', userId: ME },
    { id: 'seat-them', username: 'rival', userId: THEM },
  ];

  it('returns the other signed-in human', () => {
    expect(selectReportableOpponent(players, 'seat-me', ME)).toEqual({ userId: THEM, username: 'rival' });
  });

  it('is null for a signed-out viewer, a guest or a bot opponent', () => {
    expect(selectReportableOpponent(players, 'seat-me', null)).toBeNull();
    expect(selectReportableOpponent([players[0], { id: 'seat-g', username: 'Guest', userId: null }], 'seat-me', ME)).toBeNull();
    expect(selectReportableOpponent([players[0], { id: 'seat-b', username: 'Fritz', userId: 'bot:fritz' }], 'seat-me', ME)).toBeNull();
  });
});

describe('report categories', () => {
  it('match the server vocabulary exactly', () => {
    expect(REPORT_CATEGORIES.map((c) => c.value)).toEqual(['inappropriate_username', 'harassment', 'cheating', 'other']);
  });
});
