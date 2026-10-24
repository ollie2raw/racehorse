import { beforeEach, expect, it, vi } from 'vitest';
import type { Router } from 'express';
import { registerSocialProfileRoutes } from './socialProfile';
import { supabaseFetch } from '../supabaseUtils';
vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
vi.mock('./socialAuth', () => ({ requireAuth: vi.fn(async () => 'viewer') }));
vi.mock('../http/stores/puzzleStatsStore', () => ({ listPuzzleRushDayResultsForUser: vi.fn(async () => []), listLegacyDailyPuzzleDayResultsForUser: vi.fn(async () => []) }));
const fetch = vi.mocked(supabaseFetch);
beforeEach(() => { fetch.mockReset(); });
it.each([
  ['Fritz-only', 3, [], [{ player_score: 10, opponent_score: 60 }, { player_score: 30, opponent_score: 60 }, { player_score: 40, opponent_score: 60 }], 0, 0, 0, 3],
  ['PvP-only', 1, [{ winner_user_id: 'target', loser_user_id: 'other' }], [], 1, 0, 0, 0],
  ['mixed', 2, [{ winner_user_id: 'other', loser_user_id: 'target' }], [{ player_score: 60, opponent_score: 30 }], 0, 1, 1, 0],
  ['new', 0, [], [], 0, 0, 0, 0],
] as const)('keeps %s public rating activity and human/Fritz records separate', async (_name, rated, human, fritz, wins, losses, fritzWins, fritzLosses) => {
  fetch.mockImplementation(async (path) => {
    if (path.startsWith('/rest/v1/profiles?username=')) return [{ id: 'target', username: 'target', ranked_games_played: rated }];
    if (path.startsWith('/rest/v1/profiles?')) return [];
    if (path.startsWith('/rest/v1/matches?')) return human;
    if (path.startsWith('/rest/v1/ranked_games?')) return fritz;
    if (path.startsWith('/rest/v1/friends?')) return [];
    throw new Error(`Unexpected query ${path}`);
  });
  let handler!: (req: unknown, res: unknown) => Promise<void>;
  registerSocialProfileRoutes({ get: (_path: string, callback: typeof handler) => { handler = callback; } } as unknown as Router);
  const json = vi.fn();
  await handler({ params: { username: 'target' } }, { status: vi.fn().mockReturnThis(), json });
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ ranked_games_played: rated, wins, losses, fritz_wins: fritzWins, fritz_losses: fritzLosses }));
  expect(fetch.mock.calls.some(([path]) => path.includes('/daily_fritz_attempts'))).toBe(false);
  expect(fetch.mock.calls.find(([path]) => path.includes('/ranked_games'))?.[0]).toContain('rating_after=not.is.null');
});
