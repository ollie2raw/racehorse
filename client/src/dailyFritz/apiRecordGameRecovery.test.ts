// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const { apiPostMock, apiGetMock } = vi.hoisted(() => ({
  apiPostMock: vi.fn(),
  apiGetMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  apiPost: apiPostMock,
  apiGet: apiGetMock,
}));

import {
  DAILY_FRITZ_MISSING_GAME_RECEIPTS_MESSAGE,
  DailyFritzAuthorityRecoveryError,
  recordDailyFritzGame,
} from './api';

describe('Daily Fritz record-game recovery policy', () => {
  afterEach(() => {
    apiPostMock.mockReset();
    apiGetMock.mockReset();
  });

  it('maps the missing prior game receipt 409 to an authority recovery error', async () => {
    apiPostMock.mockResolvedValue({
      data: null,
      error: DAILY_FRITZ_MISSING_GAME_RECEIPTS_MESSAGE,
      errorCode: null,
      errorData: null,
      status: 409,
    });

    await expect(recordDailyFritzGame({
      attemptId: 'attempt-1',
      verifiedMatchId: 'match-1',
      runDate: '2026-08-20',
      gameNumber: 2,
      transcript: null,
      playerScore: 64,
      fritzScore: 51,
      movesUsed: 48,
      handsPlayed: 8,
    })).rejects.toMatchObject({
      name: 'DailyFritzAuthorityRecoveryError',
      verifierCode: 'missing_game_receipts',
      status: 409,
    } satisfies Partial<DailyFritzAuthorityRecoveryError>);
  });
});
