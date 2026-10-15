import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseFetch } from '../supabaseUtils';
import { recordMatchStart, MatchStartPersistError } from './persistence';
import type { QueuedPlayer } from './types';
vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
const fetchMock = vi.mocked(supabaseFetch);
const players = { a: { userId: 'a', socketId: 'sa', username: 'A', rating: 1000, isSim: false },
  b: { userId: 'b', socketId: 'sb', username: 'B', rating: 1000, isSim: false } } as unknown as { a: QueuedPlayer; b: QueuedPlayer };
afterEach(() => { vi.useRealTimers(); fetchMock.mockReset(); });

describe('match-start lost-response retry', () => {
  it('proves a committed insert on retry without creating another match or overwriting it', async () => {
    vi.useFakeTimers();
    const rows = new Map<string, unknown>();
    let attempts = 0;
    fetchMock.mockImplementation(async (path, init) => {
      const row = JSON.parse(String(init?.body));
      attempts += 1;
      if (rows.has(row.id)) {
        // Model PostgREST's duplicate handling. The former bare INSERT throws.
        if (!path.includes('on_conflict=id') || !(init?.headers as Record<string, string>).Prefer.includes('ignore-duplicates')) {
          throw new Error('23505 duplicate key');
        }
        return undefined as never;
      }
      rows.set(row.id, row);
      throw new Error('Supabase request timed out after 15000ms'); // commit happened, response was lost
    });
    const pending = recordMatchStart({ ...players, roomCode: 'MMLOST' });
    await vi.advanceTimersByTimeAsync(400);
    const record = await pending;
    expect(attempts).toBe(2);
    expect(rows.size).toBe(1);
    expect(rows.has(record.id)).toBe(true);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).id)).toEqual([record.id, record.id]);
  });

  it('retains the four-attempt ceiling when the database never commits', async () => {
    vi.useFakeTimers();
    fetchMock.mockRejectedValue(new Error('database unavailable'));
    const check = expect(recordMatchStart({ ...players, roomCode: 'MMDOWN' })).rejects.toBeInstanceOf(MatchStartPersistError);
    await vi.advanceTimersByTimeAsync(4400);
    await check;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
