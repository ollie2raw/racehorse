import { afterEach, describe, expect, it, vi } from 'vitest';

const { listHealthSummaryMock } = vi.hoisted(() => ({
  listHealthSummaryMock: vi.fn(),
}));

vi.mock('../stores/dailyFritzHealthSummary', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzHealthSummary')>(
    '../stores/dailyFritzHealthSummary',
  );
  return {
    ...actual,
    listDailyFritzHealthSummary: listHealthSummaryMock,
    formatDailyFritzRunDatePacific: () => '2026-08-19',
    previousDailyFritzRunDate: (runDate: string) => {
      if (runDate === '2026-08-19') return '2026-08-18';
      return '2026-08-17';
    },
  };
});

import { registerDailyFritzRoutes } from './dailyFritz';
import type { Application } from 'express';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

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
      params: {},
      query: input.query ?? {},
      body: {},
      method,
      path,
      get(name: string) { return name.toLowerCase() === 'x-admin-secret' ? input.adminSecret : undefined; },
    }, res);
    return { status, body };
  };
}

describe('GET /api/daily-fritz/health', () => {
  afterEach(() => {
    delete process.env.ADMIN_SECRET;
    listHealthSummaryMock.mockReset();
  });

  it('requires the admin secret', async () => {
    process.env.ADMIN_SECRET = 'test-admin-secret';
    const request = makeHarness();
    await expect(request('GET', '/api/daily-fritz/health')).resolves.toMatchObject({ status: 401 });
  });

  it('returns today vs yesterday health with status heuristic', async () => {
    process.env.ADMIN_SECRET = 'test-admin-secret';
    listHealthSummaryMock.mockImplementation(async (runDate: string) => ({
      metrics: {
        runDate,
        attemptsStarted: runDate === '2026-08-19' ? 120 : 100,
        attemptsCompleted: runDate === '2026-08-19' ? 80 : 75,
        completionRate: runDate === '2026-08-19' ? 0.667 : 0.75,
        verificationFailed: 2,
        handVerified: 90,
        verificationFailureRate: 0.022,
        requestFailed: 1,
        legacyUnverifiedCompletions: 4,
        unrankedCompletionRate: 0.05,
        recoveryStarted: 1,
        recoveryFailed: 0,
        firstMoveCount: 110,
      },
      topFailures: [{ verifierCode: 'stale_revision', total: 2 }],
    }));
    const request = makeHarness();
    const response = await request('GET', '/api/daily-fritz/health', {
      adminSecret: 'test-admin-secret',
      query: { run_date: '2026-08-19' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      run_date: '2026-08-19',
      compared_to: '2026-08-18',
      status: 'healthy',
      today: { attemptsStarted: 120, completionRate: 0.667 },
      yesterday: { attemptsStarted: 100, completionRate: 0.75 },
      top_failures: [{ verifierCode: 'stale_revision', total: 2 }],
    });
    expect(listHealthSummaryMock).toHaveBeenCalledWith('2026-08-19');
    expect(listHealthSummaryMock).toHaveBeenCalledWith('2026-08-18');
  });
});
