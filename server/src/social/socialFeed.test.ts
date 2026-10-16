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

describe('per-user feed routes keep internal ids private to non-owners', () => {
  const rowFor = (userId: string) => ({
    id: 'a1', user_id: userId, type: 'win', created_at: '2026-10-08T00:00:00.000Z',
    metadata: { mode: 'bot', score: 20, source_match_id: 'private-match-id' },
  });
  const run = async (path: string, params: Record<string, string>) => {
    const res = { body: null as unknown, json(v: unknown) { this.body = v; return this; } };
    await routes.get(path)!({ params }, res);
    return res.body as { feed: Array<{ metadata: Record<string, unknown> }> };
  };

  it("/feed/user/:userId strips internal metadata from another player's rows", async () => {
    mockAuth.mockResolvedValue('viewer');
    mockFetch.mockResolvedValueOnce([rowFor('target')]).mockResolvedValueOnce([{ id: 'target', username: 'ada' }]);
    const body = await run('/feed/user/:userId', { userId: 'target' });
    expect(body.feed[0]!.metadata).toEqual({ mode: 'bot', score: 20 });
  });

  it('all three routes apply the same whitelist to non-owner rows, and malformed metadata cannot bypass it', async () => {
    const hostile = [
      null,
      'source_match_id=private',
      ['mode', 'score'],
      42,
      { mode: 'bot', __proto__: { source_match_id: 'inherited-private' }, constructor: 'x' },
      JSON.parse('{"mode":"bot","__proto__":{"source_match_id":"proto-private"},"score":20,"internal_match_id":"m"}'),
    ];
    for (const metadata of hostile) {
      const row = { id: 'a1', user_id: 'target', type: 'win', created_at: '2026-10-08T00:00:00.000Z', metadata };
      const out: Array<Record<string, unknown>> = [];

      mockFetch.mockReset(); mockAuth.mockResolvedValue('viewer');
      mockFetch.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ id: 'target', username: 'ada' }]);
      out.push((await run('/feed/user/:userId', { userId: 'target' })).feed[0]!.metadata);

      mockFetch.mockReset(); mockAuth.mockResolvedValue('viewer');
      const { getFriendIds } = await import('./socialAuth');
      (getFriendIds as ReturnType<typeof vi.fn>).mockResolvedValue(['target']);
      mockFetch.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ id: 'target', username: 'ada' }]);
      out.push((await run('/feed', {})).feed[0]!.metadata);

      mockFetch.mockReset();
      mockFetch.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ id: 'target', username: 'ada' }]);
      const res = { body: null as unknown, setHeader() {}, json(v: unknown) { this.body = v; return this; } };
      await routes.get('/feed/global')!({}, res);
      out.push((res.body as { feed: Array<{ metadata: Record<string, unknown> }> }).feed[0]!.metadata);

      expect(out[1]).toEqual(out[0]);
      expect(out[2]).toEqual(out[0]);
      expect(JSON.stringify(out[0])).not.toMatch(/private|internal_match_id|inherited/);
      expect(Object.keys(out[0]).every((k) => ['mode', 'score'].includes(k))).toBe(true);
    }
  });

  it('/feed/user/:userId leaves the viewer\'s own rows intact', async () => {
    mockAuth.mockResolvedValue('viewer');
    mockFetch.mockResolvedValueOnce([rowFor('viewer')]).mockResolvedValueOnce([{ id: 'viewer', username: 'me' }]);
    const body = await run('/feed/user/:userId', { userId: 'viewer' });
    expect(body.feed[0]!.metadata).toHaveProperty('source_match_id');
  });
});
