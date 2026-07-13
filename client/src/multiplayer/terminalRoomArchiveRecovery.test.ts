import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildTerminalArchiveFallbackNotice,
  buildRecoveredTerminalMatchNotice,
  fetchRecoveredTerminalMatchNotice,
  recoverTerminalMatchArchive,
} from './terminalRoomArchiveRecovery';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildRecoveredTerminalMatchNotice', () => {
  it('formats a completed archived room as a recoverable terminal result', () => {
    const notice = buildRecoveredTerminalMatchNotice({
      matchId: 'match-1',
      roomCode: 'room1',
      status: 'completed',
      participants: [
        { id: 'seat-a', username: 'Oliver' },
        { id: 'seat-b', username: 'Riley' },
      ],
      summary: {
        winnerId: 'seat-a',
        scores: {
          'seat-a': 60,
          'seat-b': 42,
        },
      },
    });

    expect(notice).toEqual({
      context: 'multiplayer',
      title: 'Match completed',
      detail: 'Your saved room ROOM1 finished while you were away. Final score: Oliver 60 - Riley 42.',
    });
  });

  it('formats an abandoned archived room as a terminal notice', () => {
    const notice = buildRecoveredTerminalMatchNotice({
      matchId: 'match-2',
      roomCode: 'room2',
      status: 'abandoned',
      participants: [],
      summary: null,
    });

    expect(notice).toEqual({
      context: 'multiplayer',
      title: 'Match ended',
      detail: 'Your saved room ROOM2 was abandoned while you were away.',
    });
  });

  it('loads an archived terminal result by room code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        log: {
          matchId: 'match-1',
          roomCode: 'ROOM3',
          status: 'completed',
          participants: [
            { id: 'seat-a', username: 'Oliver' },
            { id: 'seat-b', username: 'Riley' },
          ],
          summary: {
            scores: {
              'seat-a': 60,
              'seat-b': 42,
            },
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const notice = await fetchRecoveredTerminalMatchNotice({
      serverUrl: 'http://localhost:3001/',
      roomCode: 'room3',
      authToken: 'token-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/api/room-events/by-room/ROOM3',
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer token-1',
        },
      }),
    );
    expect(notice?.title).toBe('Match completed');
    expect(notice?.detail).toContain('Oliver 60 - Riley 42');
  });

  it('distinguishes missing archive from temporary archive failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    await expect(
      recoverTerminalMatchArchive({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room4',
        authToken: 'token-1',
      }),
    ).resolves.toEqual({ status: 'absent' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    await expect(
      recoverTerminalMatchArchive({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room4',
        authToken: 'token-1',
      }),
    ).resolves.toEqual({ status: 'temporarily_unavailable', error: 'HTTP 500' });
  });

  it('returns unauthorized when auth is missing or expired', async () => {
    await expect(
      recoverTerminalMatchArchive({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room5',
        authToken: null,
      }),
    ).resolves.toEqual({ status: 'unauthorized' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    await expect(
      recoverTerminalMatchArchive({
        serverUrl: 'http://localhost:3001',
        roomCode: 'room5',
        authToken: 'expired',
      }),
    ).resolves.toEqual({ status: 'unauthorized' });
  });

  it('treats archive timeout/network failure as temporarily unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await recoverTerminalMatchArchive({
      serverUrl: 'http://localhost:3001',
      roomCode: 'room6',
      authToken: 'token-1',
    });

    expect(result).toEqual({ status: 'temporarily_unavailable', error: 'network down' });
  });

  it('builds degraded terminal notices without claiming the room is merely unavailable', () => {
    expect(buildTerminalArchiveFallbackNotice('temporarily_unavailable', 'room7')).toEqual({
      context: 'multiplayer',
      title: 'Result still syncing',
      detail:
        'Your saved room ROOM7 has ended, but the archived result is temporarily unavailable. Return home and retry Multiplayer in a moment.',
    });
    expect(buildTerminalArchiveFallbackNotice('unauthorized', 'room8').title).toBe(
      'Sign in to recover result',
    );
  });
});
