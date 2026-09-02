import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../supabaseUtils';
import { recordPublicOnlineMatch } from './recordPublicMatch';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

const input = {
  roomCode: 'ROOM1',
  roomMatchId: 'match-abc',
  winnerUserId: 'w1',
  loserUserId: 'l1',
  winnerScore: 61,
  loserScore: 30,
};

beforeEach(() => mockFetch.mockReset());

describe('recordPublicOnlineMatch — MP-G4 idempotency', () => {
  it('SELECT fast-path: returns early when a row already exists, no insert', async () => {
    mockFetch.mockResolvedValueOnce([{ id: 'existing' }]); // the SELECT
    await recordPublicOnlineMatch(input);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/rest/v1/matches?');
  });

  it('insert carries resolution=ignore-duplicates so a concurrent retry cannot double-write', async () => {
    mockFetch.mockResolvedValueOnce([]); // SELECT: none
    mockFetch.mockResolvedValueOnce(undefined); // POST
    await recordPublicOnlineMatch(input);

    const post = mockFetch.mock.calls.find(
      ([path]: [string]) => path === '/rest/v1/matches',
    );
    expect(post).toBeTruthy();
    expect(post![1].method).toBe('POST');
    expect(post![1].headers.Prefer).toContain('resolution=ignore-duplicates');
    const body = JSON.parse(post![1].body);
    expect(body.metadata.roomMatchId).toBe('match-abc');
  });
});
