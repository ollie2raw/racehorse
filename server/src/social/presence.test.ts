import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

import { supabaseFetch } from '../supabaseUtils';
import { upsertPresence, getPresenceBatch } from './presence';

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;

beforeEach(() => { mockFetch.mockReset(); });

describe('upsertPresence', () => {
  it('calls supabaseFetch with merge-duplicates Prefer header', async () => {
    mockFetch.mockResolvedValue({});
    await upsertPresence('user-1', 'online');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [path, init] = mockFetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(path).toBe('/rest/v1/player_presence');
    expect(init.method).toBe('POST');
    expect(init.headers['Prefer']).toContain('merge-duplicates');
    const body = JSON.parse(init.body);
    expect(body.user_id).toBe('user-1');
    expect(body.status).toBe('online');
  });

  it('includes current_mode when provided', async () => {
    mockFetch.mockResolvedValue({});
    await upsertPresence('user-1', 'in_game', 'multiplayer');
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.current_mode).toBe('multiplayer');
  });

  it('sets current_mode to null when not provided', async () => {
    mockFetch.mockResolvedValue({});
    await upsertPresence('user-1', 'offline');
    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.current_mode).toBeNull();
  });
});

describe('getPresenceBatch', () => {
  it('returns empty map for empty input without calling fetch', async () => {
    const result = await getPresenceBatch([]);
    expect(result.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps user_id to status from fetched rows', async () => {
    mockFetch.mockResolvedValue([
      { user_id: 'u1', status: 'online', current_mode: null },
      { user_id: 'u2', status: 'in_game', current_mode: 'multiplayer' },
    ]);
    const result = await getPresenceBatch(['u1', 'u2']);
    expect(result.get('u1')).toEqual({ status: 'online', current_mode: null });
    expect(result.get('u2')).toEqual({ status: 'in_game', current_mode: 'multiplayer' });
  });

  it('returns empty map when fetch returns no rows', async () => {
    mockFetch.mockResolvedValue([]);
    const result = await getPresenceBatch(['u1']);
    expect(result.size).toBe(0);
  });
});
