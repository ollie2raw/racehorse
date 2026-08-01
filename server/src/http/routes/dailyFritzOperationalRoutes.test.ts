import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const { listEventsMock, listMetricsMock } = vi.hoisted(() => ({
  listEventsMock: vi.fn(),
  listMetricsMock: vi.fn(),
}));

vi.mock('../stores/dailyFritzEventStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzEventStore')>(
    '../stores/dailyFritzEventStore',
  );
  return {
    ...actual,
    listDailyFritzEvents: listEventsMock,
    listDailyFritzPersistedMetrics: listMetricsMock,
  };
});

import { registerDailyFritzRoutes } from './dailyFritz';

type Handler = (req: any, res: any) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
  };
  registerDailyFritzRoutes(app as unknown as Application);

  return async function request(
    method: 'GET' | 'POST',
    path: string,
    input: { adminSecret?: string; params?: Record<string, string>; query?: Record<string, string> } = {},
  ) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let body: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { body = value; return res; },
    };
    await handler({
      headers: input.adminSecret ? { 'x-admin-secret': input.adminSecret } : {},
      params: input.params ?? {},
      query: input.query ?? {},
      method,
      path,
      get(name: string) { return name.toLowerCase() === 'x-admin-secret' ? input.adminSecret : undefined; },
    }, res);
    return { status, body };
  };
}

describe('Daily Fritz operational routes', () => {
  afterEach(() => {
    delete process.env.ADMIN_SECRET;
    listEventsMock.mockReset();
    listMetricsMock.mockReset();
  });

  it('protects operational metrics and event timelines with the admin secret', async () => {
    process.env.ADMIN_SECRET = 'test-admin-secret';
    listMetricsMock.mockResolvedValue([
      { eventType: 'hand_verified', verifierCode: null, total: 4 },
    ]);
    listEventsMock.mockResolvedValue([
      { id: 'event-1', attemptId: 'attempt-1', eventType: 'hand_verified' },
    ]);
    const request = makeHarness();

    await expect(request('GET', '/api/daily-fritz/metrics')).resolves.toMatchObject({ status: 401 });
    await expect(request('GET', '/api/daily-fritz/events/:attemptId', {
      adminSecret: 'test-admin-secret',
      params: { attemptId: 'attempt-1' },
    })).resolves.toMatchObject({
      status: 200,
      body: { ok: true, attempt_id: 'attempt-1', events: [{ id: 'event-1' }] },
    });
    expect(listEventsMock).toHaveBeenCalledWith('attempt-1', 200);
  });

  it('returns runtime metrics plus persisted metrics when the journal is reachable', async () => {
    process.env.ADMIN_SECRET = 'test-admin-secret';
    listMetricsMock.mockResolvedValue([
      { eventType: 'attempt_completed', verifierCode: null, total: 2 },
    ]);
    const request = makeHarness();
    const response = await request('GET', '/api/daily-fritz/metrics', {
      adminSecret: 'test-admin-secret',
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      persisted_metrics: [{ eventType: 'attempt_completed', total: 2 }],
    });
    expect(listMetricsMock).toHaveBeenCalledTimes(1);
  });
});
