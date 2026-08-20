// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS,
  flushDailyFritzCheckpointOnUnload,
} from './dailyFritzCheckpointUnload';

vi.mock('../lib/gameServerUrl', () => ({ resolveGameServerUrl: () => 'http://test-server' }));

describe('flushDailyFritzCheckpointOnUnload', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses sendBeacon with access_token in the JSON body', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });

    const sent = flushDailyFritzCheckpointOnUnload({
      attemptId: 'attempt-1',
      verifiedMatchId: 'verified-1',
      checkpoint: { checkpointRevision: 3 },
      accessToken: 'token-abc',
    });

    expect(sent).toBe(true);
    expect(sendBeacon).toHaveBeenCalledWith(
      'http://test-server/api/daily-fritz/checkpoint',
      expect.any(Blob),
    );
  });

  it('falls back to keepalive fetch when sendBeacon is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const sent = flushDailyFritzCheckpointOnUnload({
      attemptId: 'attempt-1',
      verifiedMatchId: 'verified-1',
      checkpoint: { checkpointRevision: 2 },
      accessToken: 'token-abc',
    });

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test-server/api/daily-fritz/checkpoint',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
        headers: expect.objectContaining({
          Authorization: 'Bearer token-abc',
        }),
      }),
    );
  });
});

describe('DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS', () => {
  it('is within the requested 500-800ms window', () => {
    expect(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
    expect(DAILY_FRITZ_CHECKPOINT_SYNC_DEBOUNCE_MS).toBeLessThanOrEqual(800);
  });
});
