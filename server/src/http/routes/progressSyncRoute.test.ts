import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const { authUserMock, loadMock, mergeMock } = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  loadMock: vi.fn(),
  mergeMock: vi.fn(),
}));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn(), startSpan: vi.fn((_o: unknown, cb: () => unknown) => cb()) }));
vi.mock('../../platform/auth/supabaseAuth', () => ({ getAuthenticatedUserId: authUserMock }));
vi.mock('../../playerProgress', async () => {
  const actual = await vi.importActual<typeof import('../../playerProgress')>('../../playerProgress');
  return { ...actual, loadJourneyProgress: loadMock, mergeStoredJourneyProgress: mergeMock };
});

import { registerProgressSyncRoutes, resetProgressSyncWarningThrottleForTests } from './progressSyncRoute';

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function harness() {
  const routes = new Map<string, Handler>();
  // Routes carry a rate-limit middleware ahead of the handler; the handler is last.
  const register = (method: string) => (path: string, ...handlers: Handler[]) => routes.set(`${method} ${path}`, handlers[handlers.length - 1]!);
  registerProgressSyncRoutes({ get: register('GET'), post: register('POST') } as unknown as Application);
  return async (method: 'GET' | 'POST', body?: unknown) => {
    const handler = routes.get(`${method} /api/progress/journey`);
    if (!handler) throw new Error(`Missing route ${method}`);
    let status = 200;
    let payload: any;
    const headers: Record<string, string> = {};
    const res = {
      headersSent: false,
      locals: {},
      getHeader: () => undefined,
      setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
      status(code: number) { status = code; return res; },
      json(value: unknown) { payload = value; return res; },
    };
    await handler({ headers: {}, query: {}, params: {}, body }, res);
    return { status, body: payload, headers };
  };
}

const USER = '11111111-1111-4111-8111-111111111111';
const good = { chapters: { chapter_1: { completedNodeIds: ['n1'], completedAt: null, completionCelebrated: false } } };

describe('GET and POST /api/progress/journey', () => {
  beforeEach(() => {
    vi.stubEnv('PROGRESS_SYNC_ENABLED', 'true');
    authUserMock.mockResolvedValue(USER);
    resetProgressSyncWarningThrottleForTests();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('is "not enabled" while the flag is off, and touches neither auth nor the table', async () => {
    vi.stubEnv('PROGRESS_SYNC_ENABLED', '');
    const call = harness();
    for (const method of ['GET', 'POST'] as const) {
      const res = await call(method, { progress: good });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: false, reason: 'disabled' });
    }
    expect(authUserMock).not.toHaveBeenCalled();
    expect(loadMock).not.toHaveBeenCalled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('refuses a signed-out request', async () => {
    authUserMock.mockResolvedValue(null);
    const call = harness();
    expect((await call('GET')).status).toBe(401);
    expect((await call('POST', { progress: good })).status).toBe(401);
    expect(loadMock).not.toHaveBeenCalled();
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('GET answers with the stored progress, or null, never cached', async () => {
    const call = harness();
    loadMock.mockResolvedValueOnce(null);
    expect((await call('GET')).body).toEqual({ enabled: true, progress: null });
    loadMock.mockResolvedValueOnce(good);
    const res = await call('GET');
    expect(res.body).toEqual({ enabled: true, progress: good });
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(loadMock).toHaveBeenCalledWith(USER);
  });

  it('POST merges for the signed-in user only and answers with the union', async () => {
    const call = harness();
    const merged = { chapters: { chapter_1: { completedNodeIds: ['n1', 'n2'], completedAt: null, completionCelebrated: false } } };
    mergeMock.mockResolvedValue(merged);
    const res = await call('POST', { progress: good, userId: 'someone-else' });
    expect(res).toMatchObject({ status: 200, body: { enabled: true, progress: merged } });
    expect(mergeMock).toHaveBeenCalledWith(USER, good);
  });

  it.each([[undefined], [{}], [{ progress: 'x' }], [{ progress: { chapters: { c: { completedNodeIds: ['bad id'] } } } }]])('POST rejects a malformed body %#', async (body) => {
    const res = await harness()('POST', body);
    expect(res.status).toBe(400);
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it('answers "not enabled / unavailable" when the table has not been created, on both routes', async () => {
    const call = harness();
    const missing = new Error('Supabase request failed: 404 {"code":"PGRST205","message":"Could not find the table \'public.player_progress\' in the schema cache"}');
    loadMock.mockRejectedValue(missing);
    mergeMock.mockRejectedValue(missing);
    expect((await call('GET')).body).toEqual({ enabled: false, reason: 'unavailable' });
    const post = await call('POST', { progress: good });
    expect(post).toMatchObject({ status: 200, body: { enabled: false, reason: 'unavailable' } });
  });

  it('a real failure is a server error, not a quiet "unavailable"', async () => {
    const call = harness();
    loadMock.mockRejectedValue(new Error('Supabase request failed: 500 boom'));
    mergeMock.mockRejectedValue(new Error('progress_write_conflict'));
    expect((await call('GET')).status).toBe(500);
    expect((await call('POST', { progress: good })).status).toBe(500);
  });
});
