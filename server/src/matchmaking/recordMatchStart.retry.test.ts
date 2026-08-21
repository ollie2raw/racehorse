/**
 * M2 — recordMatchStart retries then throws (no swallow).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_OVER_PERSIST_MAX_ATTEMPTS } from '../multiplayer/gameOverPersistPolicy';
import { MatchStartPersistError, recordMatchStart } from './persistence';
import type { QueuedPlayer } from './types';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';

function player(overrides: Partial<QueuedPlayer> = {}): QueuedPlayer {
  return {
    socketId: 'sock-a',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    username: 'A',
    rating: 800,
    joinedAtMs: Date.now(),
    isSim: false,
    ...overrides,
  };
}

describe('recordMatchStart persistence (M2)', () => {
  beforeEach(() => {
    vi.mocked(supabaseFetch).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries then throws MatchStartPersistError when insert never succeeds', async () => {
    vi.useFakeTimers();
    vi.mocked(supabaseFetch).mockRejectedValue(new Error('db down'));

    const pending = recordMatchStart({
      roomCode: 'MMFAIL',
      a: player(),
      b: player({
        socketId: 'sock-b',
        userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        username: 'B',
      }),
    });

    const assertion = expect(pending).rejects.toBeInstanceOf(MatchStartPersistError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(supabaseFetch).toHaveBeenCalledTimes(GAME_OVER_PERSIST_MAX_ATTEMPTS);
  });

  it('succeeds on a later retry without throwing', async () => {
    vi.useFakeTimers();
    vi.mocked(supabaseFetch)
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce([]);

    const pending = recordMatchStart({
      roomCode: 'MMRETRY',
      a: player(),
      b: player({
        socketId: 'sock-b',
        userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        username: 'B',
      }),
    });

    const done = pending.then((record) => record);
    await vi.runAllTimersAsync();
    const record = await done;
    expect(record.status).toBe('in_progress');
    expect(record.roomCode).toBe('MMRETRY');
    expect(supabaseFetch).toHaveBeenCalledTimes(3);
  });

  it('sim matches skip DB and still return a local record', async () => {
    const record = await recordMatchStart({
      roomCode: 'MMSIM',
      a: player({ isSim: true, userId: 'sim:a' }),
      b: player({ socketId: 'sock-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
    });
    expect(record.isSim).toBe(true);
    expect(supabaseFetch).not.toHaveBeenCalled();
  });
});
