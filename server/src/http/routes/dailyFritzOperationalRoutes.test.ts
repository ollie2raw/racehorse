import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const {
  authUserMock,
  getAttemptByIdMock,
  listEventsMock,
  listMetricsMock,
  recordEventMock,
} = vi.hoisted(() => ({
  authUserMock: vi.fn(),
  getAttemptByIdMock: vi.fn(),
  listEventsMock: vi.fn(),
  listMetricsMock: vi.fn(),
  recordEventMock: vi.fn(),
}));

vi.mock('../../platform/auth/supabaseAuth', () => ({
  getAuthenticatedUserId: authUserMock,
}));

vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>(
    '../stores/dailyFritzStore',
  );
  return {
    ...actual,
    getDailyFritzAttemptById: getAttemptByIdMock,
  };
});

vi.mock('../stores/dailyFritzEventStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzEventStore')>(
    '../stores/dailyFritzEventStore',
  );
  return {
    ...actual,
    listDailyFritzEvents: listEventsMock,
    listDailyFritzPersistedMetrics: listMetricsMock,
    recordDailyFritzEvent: recordEventMock,
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
    input: {
      adminSecret?: string;
      body?: Record<string, unknown>;
      params?: Record<string, string>;
      query?: Record<string, string>;
    } = {},
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
      body: input.body ?? {},
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
    recordEventMock.mockReset();
    getAttemptByIdMock.mockReset();
    authUserMock.mockReset();
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

  it('accepts only authenticated, allowlisted client telemetry with an idempotent identity', async () => {
    authUserMock.mockResolvedValue('user-1');
    getAttemptByIdMock.mockResolvedValue({
      id: 'attempt-1',
      runDate: '2026-08-01',
      challengeId: 'daily-fritz:2026-08-01:v1',
      revision: 7,
    });
    recordEventMock.mockResolvedValue(undefined);
    const request = makeHarness();
    const body = {
      event_type: 'recovery_succeeded',
      event_id: 'attempt-1:recovery_succeeded:resume-1',
      attempt_id: 'attempt-1',
      session_id: 'session-1',
      client_release: 'test-release',
      duration_ms: 1234,
      payload: { recovery_reason: 'refresh' },
    };

    await expect(request('POST', '/api/daily-fritz/telemetry', { body })).resolves.toMatchObject({
      status: 202,
      body: { ok: true },
    });
    expect(recordEventMock).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: 'attempt-1',
      userId: 'user-1',
      eventType: 'recovery_succeeded',
      idempotencyKey: 'client:user-1:attempt-1:recovery_succeeded:resume-1',
      challengeId: 'daily-fritz:2026-08-01:v1',
      authorityRevision: 7,
      source: 'client',
    }));

    await request('POST', '/api/daily-fritz/telemetry', { body });
    expect(recordEventMock.mock.calls[1]?.[0].idempotencyKey)
      .toBe(recordEventMock.mock.calls[0]?.[0].idempotencyKey);
  });

  it('rejects authority events and attempts not owned by the authenticated user', async () => {
    authUserMock.mockResolvedValue('user-1');
    getAttemptByIdMock.mockResolvedValue(null);
    const request = makeHarness();

    await expect(request('POST', '/api/daily-fritz/telemetry', {
      body: { event_type: 'attempt_completed', event_id: 'client-event-123' },
    })).resolves.toMatchObject({ status: 400 });
    await expect(request('POST', '/api/daily-fritz/telemetry', {
      body: {
        event_type: 'first_move',
        event_id: 'client-event-456',
        attempt_id: 'someone-elses-attempt',
      },
    })).resolves.toMatchObject({ status: 404 });
    expect(recordEventMock).not.toHaveBeenCalled();
  });
});
