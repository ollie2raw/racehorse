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
});
