import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  supabaseFetchMock,
  processRatingPeriodMock,
  writeForfeitActivityMock,
  logInfoMock,
} = vi.hoisted(() => ({
  supabaseFetchMock: vi.fn(),
  processRatingPeriodMock: vi.fn(),
  writeForfeitActivityMock: vi.fn(),
  logInfoMock: vi.fn(),
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => supabaseFetchMock(...args),
}));

vi.mock('../ranking/periodService', () => ({
  processRatingPeriod: (...args: unknown[]) => processRatingPeriodMock(...args),
}));

vi.mock('../social/activityWriter', () => ({
  writeForfeitActivity: (...args: unknown[]) => writeForfeitActivityMock(...args),
}));

vi.mock('../logger', () => ({
  childLogger: () => ({ info: logInfoMock, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { recordPendingFritzDisconnectLoss } from './fritzMatchLifecycle';

describe('recordPendingFritzDisconnectLoss', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes Glicko using the real server-derived scores when verifiedScores is present — never a synthesized 0/60', async () => {
    supabaseFetchMock.mockImplementation(async (path: string) => {
      if (path.includes('/rest/v1/profiles')) return [{ id: 'u1', glicko_rating: 1500, glicko_rd: 200 }];
      if (path.includes('/rest/v1/ranked_games')) return [{ id: 'row-1' }];
      return [];
    });

    await recordPendingFritzDisconnectLoss('u1', 'elite', { roomCode: 'ROOM1' }, { youScore: 23, botScore: 41 });

    const rankedGameCall = supabaseFetchMock.mock.calls.find(([path]) => path === '/rest/v1/ranked_games');
    expect(rankedGameCall).toBeTruthy();
    const body = JSON.parse(rankedGameCall![1].body as string);
    expect(body.player_score).toBe(23);
    expect(body.opponent_score).toBe(41);
    expect(processRatingPeriodMock).toHaveBeenCalledWith('u1');
  });

  it('writes NO Glicko at all when no verified score is available — the abandon/stale-cleanup path is left unranked, not synthesized', async () => {
    await recordPendingFritzDisconnectLoss('u1', 'elite', { roomCode: 'ROOM1' }, null);

    const rankedGameCall = supabaseFetchMock.mock.calls.find(([path]) => path === '/rest/v1/ranked_games');
    expect(rankedGameCall).toBeUndefined();
    expect(processRatingPeriodMock).not.toHaveBeenCalled();
    expect(logInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      expect.stringContaining('unranked'),
    );
  });

  it('also stays unranked when verifiedScores param is simply omitted (default)', async () => {
    await recordPendingFritzDisconnectLoss('u1', 'elite', { roomCode: 'ROOM1' });

    expect(supabaseFetchMock).not.toHaveBeenCalledWith('/rest/v1/ranked_games', expect.anything());
    expect(processRatingPeriodMock).not.toHaveBeenCalled();
  });

  // --- RK-1 (HARDENING_PLAN §8.3): idempotent insert ---------------------

  it('routes the ranked_games insert through the idempotent on_conflict path using an explicit verifiedMatchId, and applies the rating on a genuinely new row', async () => {
    supabaseFetchMock.mockImplementation(async (path: string) => {
      if (path.includes('/rest/v1/profiles')) return [{ id: 'u1', glicko_rating: 1500, glicko_rd: 200 }];
      if (path.includes('/rest/v1/ranked_games')) return [{ id: 'row-1', source_match_id: 'bot-match-pending:pending-1:forfeit' }];
      return [];
    });

    await recordPendingFritzDisconnectLoss(
      'u1',
      'elite',
      { roomCode: 'ROOM1', verifiedMatchId: 'bot-match-pending:pending-1:forfeit' },
      { youScore: 10, botScore: 60 },
    );

    const rankedGameCall = supabaseFetchMock.mock.calls.find(([path]) =>
      String(path).startsWith('/rest/v1/ranked_games'),
    );
    expect(rankedGameCall).toBeTruthy();
    const [path, init] = rankedGameCall!;
    // on_conflict + ignore-duplicates proves this went through
    // insertRankedGameIdempotent, not a bare POST.
    expect(path).toBe('/rest/v1/ranked_games?on_conflict=player_id,source_match_id');
    expect(init.headers).toMatchObject({ Prefer: 'return=representation,resolution=ignore-duplicates' });
    const body = JSON.parse(init.body as string);
    expect(body.source_match_id).toBe('bot-match-pending:pending-1:forfeit');
    expect(processRatingPeriodMock).toHaveBeenCalledWith('u1');
  });

  it('a duplicate sourceMatchId (same forfeit event recorded twice) is a no-op — no second rating application', async () => {
    supabaseFetchMock.mockImplementation(async (path: string) => {
      if (path.includes('/rest/v1/profiles')) return [{ id: 'u1', glicko_rating: 1500, glicko_rd: 200 }];
      // ignore-duplicates on a conflicting source_match_id → PostgREST
      // returns an empty representation array, not an error.
      if (path.includes('/rest/v1/ranked_games')) return [];
      return [];
    });

    await recordPendingFritzDisconnectLoss(
      'u1',
      'elite',
      { roomCode: 'ROOM1', verifiedMatchId: 'bot-match-pending:pending-1:forfeit' },
      { youScore: 10, botScore: 60 },
    );

    expect(processRatingPeriodMock).not.toHaveBeenCalled();
    expect(logInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      expect.stringContaining('already recorded'),
    );
  });
});
