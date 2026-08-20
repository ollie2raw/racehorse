// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recoverPrivateMatchResult } from './terminalRoomArchiveRecovery';

afterEach(() => {
  vi.unstubAllGlobals();
});

const resultBody = {
  ok: true,
  result: {
    matchId: '11111111-1111-4111-8111-111111111111',
    roomCode: 'ROOM3',
    terminalStatus: 'completed',
    archivedAt: '2026-08-19T00:10:00.000Z',
    you: { seatId: 'seat-a', userId: 'a', username: 'Oliver' },
    opponent: { seatId: 'seat-b', userId: 'b', username: 'Riley' },
    outcome: 'win',
    yourScore: 60,
    opponentScore: 42,
    ranking: {
      eligible: true,
      applied: true,
      skipReason: null,
      message: null,
      ratingBefore: 1500,
      ratingAfter: 1512,
      ratingDelta: 12,
    },
  },
};

describe('recoverPrivateMatchResult', () => {
  it('loads GET /api/private-match/result by room code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultBody,
    });
    vi.stubGlobal('fetch', fetchMock);

    const recovered = await recoverPrivateMatchResult({
      serverUrl: 'http://localhost:3001/',
      roomCode: 'room3',
      authToken: 'token-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/private-match/result?roomCode=ROOM3',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token-1',
        },
      }),
    );
    expect(recovered).toEqual({ kind: 'result', result: resultBody.result });
  });

  it('prefers matchId when the terminal join payload includes one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resultBody,
    });
    vi.stubGlobal('fetch', fetchMock);

    await recoverPrivateMatchResult({
      serverUrl: 'http://localhost:3001',
      roomCode: 'ROOM3',
      matchId: '11111111-1111-4111-8111-111111111111',
      authToken: 'token-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/private-match/result?matchId=11111111-1111-4111-8111-111111111111',
      expect.anything(),
    );
  });

  it('maps endpoint status codes to recovery kinds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(
      recoverPrivateMatchResult({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room4',
        authToken: 'expired',
      }),
    ).resolves.toEqual({ kind: 'unauthorized', roomCode: 'ROOM4' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(
      recoverPrivateMatchResult({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room4',
        authToken: 'token-1',
      }),
    ).resolves.toEqual({ kind: 'forbidden', roomCode: 'ROOM4' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(
      recoverPrivateMatchResult({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room4',
        authToken: 'token-1',
      }),
    ).resolves.toEqual({ kind: 'absent', roomCode: 'ROOM4' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(
      recoverPrivateMatchResult({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room4',
        authToken: 'token-1',
      }),
    ).resolves.toEqual({ kind: 'syncing', roomCode: 'ROOM4' });
  });

  it('returns unauthorized without fetching when auth is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      recoverPrivateMatchResult({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room5',
        authToken: null,
      }),
    ).resolves.toEqual({ kind: 'unauthorized', roomCode: 'ROOM5' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats network failure as syncing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(
      recoverPrivateMatchResult({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room6',
        authToken: 'token-1',
      }),
    ).resolves.toEqual({ kind: 'syncing', roomCode: 'ROOM6' });
  });
});
