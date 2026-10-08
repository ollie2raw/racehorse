import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Router } from 'express';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
vi.mock('./socialAuth', () => ({ requireAuth: vi.fn(), getFriendIds: vi.fn() }));

import { supabaseFetch } from '../supabaseUtils';
import { requireAuth } from './socialAuth';
import { registerSocialFeedRoutes } from './socialFeed';

type Handler = (req: unknown, res: unknown) => Promise<void>;
const routes = new Map<string, Handler>();
registerSocialFeedRoutes({
  get(path: string, handler: Handler) { routes.set(path, handler); },
} as unknown as Router);

const mockFetch = supabaseFetch as ReturnType<typeof vi.fn>;
const mockAuth = requireAuth as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
  mockAuth.mockReset();
});

describe('public global activity feed', () => {
  it('serves recent results without auth and removes internal metadata', async () => {
    mockFetch
      .mockResolvedValueOnce([{
        id: 'activity-1', user_id: 'player-1', type: 'loss',
        metadata: {
          opponent_username: 'Fritz', mode: 'bot', score: 20,
          source_match_id: 'private-match-id', future_private_field: 'secret',
        },
        created_at: '2026-10-08T00:00:00.000Z',
      }])
      .mockResolvedValueOnce([{ id: 'player-1', username: 'ada' }]);

    const res = {
      body: null as unknown,
      headers: {} as Record<string, string>,
      setHeader(name: string, value: string) { this.headers[name] = value; },
      json(value: unknown) { this.body = value; return this; },
    };
    await routes.get('/feed/global')!({}, res);

    expect(mockAuth).not.toHaveBeenCalled();
    expect(String(mockFetch.mock.calls[0][0])).toContain('order=created_at.desc&limit=50');
    expect(res.headers['Cache-Control']).toBe('public, max-age=15');
    expect(res.body).toEqual({
      ok: true,
      feed: [{
        id: 'activity-1', user_id: 'player-1', username: 'ada', type: 'loss',
        metadata: { opponent_username: 'Fritz', mode: 'bot', score: 20 },
        created_at: '2026-10-08T00:00:00.000Z',
      }],
    });
  });
});
