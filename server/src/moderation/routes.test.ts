import { beforeEach, describe, expect, it, vi } from 'vitest';

const { supabaseFetchMock, requireAuthMock } = vi.hoisted(() => ({
  supabaseFetchMock: vi.fn(),
  requireAuthMock: vi.fn(),
}));

vi.mock('../supabaseUtils', async () => {
  const actual = await vi.importActual<typeof import('../supabaseUtils')>('../supabaseUtils');
  return { ...actual, supabaseFetch: supabaseFetchMock };
});

vi.mock('../social/socialAuth', async () => {
  const actual = await vi.importActual<typeof import('../social/socialAuth')>('../social/socialAuth');
  return { ...actual, requireAuth: requireAuthMock };
});

import type { Router } from 'express';
import { registerModerationRoutes } from './routes';
import { MAX_REPORTS_PER_REPORTER_PER_DAY } from './moderationPolicy';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

const routes = new Map<string, Handler>();
registerModerationRoutes({
  get(path: string, h: Handler) { routes.set(`GET ${path}`, h); },
  post(path: string, h: Handler) { routes.set(`POST ${path}`, h); },
  delete(path: string, h: Handler) { routes.set(`DELETE ${path}`, h); },
} as unknown as Router);

async function call(key: string, req: { body?: unknown; params?: Record<string, string> } = {}) {
  const handler = routes.get(key);
  if (!handler) throw new Error(`missing route ${key}`);
  let status = 200;
  let body: unknown;
  const res = {
    status(code: number) { status = code; return res; },
    json(value: unknown) { body = value; return res; },
  };
  await handler({ headers: {}, params: req.params ?? {}, query: {}, body: req.body ?? {} }, res);
  return { status, body: body as Record<string, unknown> };
}

const ME = '11111111-1111-4111-8111-111111111111';
const THEM = '22222222-2222-4222-8222-222222222222';
const SOMEONE_ELSE = '33333333-3333-4333-8333-333333333333';

/** Route fetches by path, so tests don't depend on call order. */
function stubDb(opts: { profileExists?: boolean; reportsToday?: number } = {}) {
  supabaseFetchMock.mockImplementation(async (path: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (path.startsWith('/rest/v1/profiles')) return opts.profileExists === false ? [] : [{ id: THEM }];
    if (path.startsWith('/rest/v1/user_reports') && method === 'GET') {
      return Array.from({ length: opts.reportsToday ?? 0 }, (_, i) => ({ id: `r${i}` }));
    }
    if (path.startsWith('/rest/v1/user_blocks') && method === 'GET') {
      return [{ blocker_user_id: ME, blocked_user_id: THEM }];
    }
    return undefined;
  });
}

function writes(table: string) {
  return supabaseFetchMock.mock.calls.filter(
    ([path, init]) => String(path).startsWith(`/rest/v1/${table}`) && (init as { method?: string } | undefined)?.method,
  );
}

beforeEach(() => {
  supabaseFetchMock.mockReset();
  requireAuthMock.mockReset();
  requireAuthMock.mockResolvedValue(ME);
});

describe('POST /reports', () => {
  it('stores a report from the authenticated user with a predefined category', async () => {
    stubDb();
    const res = await call('POST /reports', { body: { reportedUserId: THEM, category: 'harassment', source: 'live_match' } });

    expect(res.status).toBe(200);
    const [[path, init]] = writes('user_reports');
    expect(path).toBe('/rest/v1/user_reports?on_conflict=reporter_user_id,reported_user_id,category');
    expect((init as { headers: Record<string, string> }).headers.Prefer).toContain('ignore-duplicates');
    expect(JSON.parse((init as { body: string }).body)).toEqual({
      reporter_user_id: ME,
      reported_user_id: THEM,
      category: 'harassment',
      source: 'live_match',
    });
  });

  it('takes the reporter from the token, never the body (no spoofing)', async () => {
    stubDb();
    await call('POST /reports', {
      body: { reportedUserId: THEM, category: 'cheating', source: 'profile', reporterUserId: SOMEONE_ELSE, reporter_user_id: SOMEONE_ELSE },
    });
    const [[, init]] = writes('user_reports');
    expect(JSON.parse((init as { body: string }).body).reporter_user_id).toBe(ME);
  });

  it('refuses unauthenticated callers', async () => {
    requireAuthMock.mockResolvedValue(null);
    stubDb();
    await call('POST /reports', { body: { reportedUserId: THEM, category: 'other', source: 'profile' } });
    expect(supabaseFetchMock).not.toHaveBeenCalled();
  });

  it('rejects self-reports', async () => {
    stubDb();
    const res = await call('POST /reports', { body: { reportedUserId: ME, category: 'other', source: 'profile' } });
    expect(res.status).toBe(400);
    expect(writes('user_reports')).toHaveLength(0);
  });

  it('accepts only predefined categories and sources, and no free text', async () => {
    stubDb();
    for (const body of [
      { reportedUserId: THEM, category: 'spam', source: 'profile' },
      { reportedUserId: THEM, category: 'he said something awful', source: 'profile' },
      { reportedUserId: THEM, category: 'harassment', source: 'chat' },
      { reportedUserId: 'not-a-uuid', category: 'harassment', source: 'profile' },
    ]) {
      expect((await call('POST /reports', { body })).status).toBe(400);
    }
    expect(writes('user_reports')).toHaveLength(0);
  });

  it('does not store extra body fields such as typed text', async () => {
    stubDb();
    await call('POST /reports', { body: { reportedUserId: THEM, category: 'other', source: 'profile', details: 'typed text', email: 'a@b.c' } });
    const stored = JSON.parse((writes('user_reports')[0][1] as { body: string }).body);
    expect(Object.keys(stored).sort()).toEqual(['category', 'reported_user_id', 'reporter_user_id', 'source']);
  });

  it('404s for an unknown player', async () => {
    stubDb({ profileExists: false });
    const res = await call('POST /reports', { body: { reportedUserId: THEM, category: 'other', source: 'profile' } });
    expect(res.status).toBe(404);
  });

  it('rate-limits a reporter after the daily cap', async () => {
    stubDb({ reportsToday: MAX_REPORTS_PER_REPORTER_PER_DAY });
    const res = await call('POST /reports', { body: { reportedUserId: THEM, category: 'other', source: 'profile' } });
    expect(res.status).toBe(429);
    expect(writes('user_reports')).toHaveLength(0);
  });

  it('exposes no way to read reports', () => {
    expect([...routes.keys()].filter((k) => k.includes('report'))).toEqual(['POST /reports']);
  });
});

describe('blocks', () => {
  it('lists only the caller’s own blocks', async () => {
    stubDb();
    const res = await call('GET /blocks');
    expect(res.body).toEqual({ ok: true, blockedUserIds: [THEM] });
    const [path] = supabaseFetchMock.mock.calls.find(([p]) => String(p).startsWith('/rest/v1/user_blocks'))!;
    expect(path).toContain(`blocker_user_id=eq.${ME}`);
    expect(path).not.toContain('blocked_user_id.eq');
  });

  it('blocks idempotently and removes any friendship between the pair', async () => {
    stubDb();
    const res = await call('POST /blocks/:userId', { params: { userId: THEM } });
    expect(res.status).toBe(200);

    const [[blockPath, blockInit]] = writes('user_blocks');
    expect(blockPath).toBe('/rest/v1/user_blocks?on_conflict=blocker_user_id,blocked_user_id');
    expect(JSON.parse((blockInit as { body: string }).body)).toEqual({ blocker_user_id: ME, blocked_user_id: THEM });

    const [[friendsPath, friendsInit]] = writes('friends');
    expect((friendsInit as { method: string }).method).toBe('DELETE');
    expect(friendsPath).toContain(`and(user_id.eq.${ME},friend_user_id.eq.${THEM})`);
    expect(friendsPath).toContain(`and(user_id.eq.${THEM},friend_user_id.eq.${ME})`);
  });

  it('rejects self-blocks', async () => {
    stubDb();
    const res = await call('POST /blocks/:userId', { params: { userId: ME } });
    expect(res.status).toBe(400);
    expect(writes('user_blocks')).toHaveLength(0);
  });

  it('unblock removes only the caller’s own block', async () => {
    stubDb();
    const res = await call('DELETE /blocks/:userId', { params: { userId: THEM } });
    expect(res.status).toBe(200);
    const [[path, init]] = writes('user_blocks');
    expect((init as { method: string }).method).toBe('DELETE');
    expect(path).toBe(`/rest/v1/user_blocks?blocker_user_id=eq.${ME}&blocked_user_id=eq.${THEM}`);
  });
});
