/**
 * Regression guard for CODE_QUALITY_PLAN.md §CQ9.1.6.4: the `/ready`
 * `dailyPuzzleGeneration` check must NOT be able to flip `/ready`'s overall `ok`
 * to false (it was `dailyPuzzleLadder` and it *did* gate the 503 — a retired
 * feature's content lag could mark the prod instance unhealthy).
 *
 * These tests fail against the pre-change (gated) code: with
 * `&& dailyPuzzleGeneration.ok` still in the `ok` expression, "503s /ready when
 * the generation pipeline is behind" would pass and this file's opposite
 * assertion would fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { captureExceptionMock, supabaseFetchMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  supabaseFetchMock: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('../../supabaseUtils', () => ({
  supabaseFetch: supabaseFetchMock,
}));
vi.mock('../gracefulShutdown', () => ({
  isGracefulShutdownInProgress: () => false,
}));
vi.mock('../gameCoreConsistency', () => ({
  gameCoreReadyReport: () => ({ consistent: true }),
}));

import { registerHealthRoutes, type HealthRouteDeps } from './registerHealthRoutes';
import type { Application } from 'express';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

const TODAY = '2026-09-05';

function makeHarness(overrides: Partial<HealthRouteDeps> = {}) {
  const routes = new Map<string, Handler>();
  const app = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post() {},
  };

  const deps: HealthRouteDeps = {
    app: app as unknown as Application,
    io: { sockets: { sockets: { size: 0 } } } as unknown as HealthRouteDeps['io'],
    getRoomRuntimeStats: () => ({ roomCount: 0, gamesInProgress: 0 }),
    getPacificDateKey: () => TODAY,
    getFurthestPublishedDailyPuzzleDate: async () => '2027-09-01', // healthy: ~1yr out
    getRoomMatchLogsPersistenceAvailability: () => true,
    probeRoomMatchLogsTable: async () => true,
    isRoomMatchLogsPersistenceAvailable: () => true,
    getDailyFritzEventsPersistenceAvailability: () => true,
    probeDailyFritzEventsPersistence: async () => true,
    isDailyFritzTransactionalAuthorityEnabled: () => false,
    getDailyFritzAuthoritySchemaAvailability: () => true,
    probeDailyFritzAuthoritySchema: async () => true,
    ...overrides,
  };
  registerHealthRoutes(deps);

  return async function request(method: 'GET', path: string) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let body: Record<string, unknown> = {};
    const res = {
      setHeader() { return res; },
      status(code: number) { status = code; return res; },
      json(value: unknown) { body = value as Record<string, unknown>; return res; },
    };
    await handler({ headers: {}, params: {}, query: {}, body: {}, method, path }, res);
    return { status, body };
  };
}

describe('GET /ready — dailyPuzzleGeneration is observed but not gating', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'test-key';
    supabaseFetchMock.mockReset().mockResolvedValue(undefined); // getSupabaseReadiness → ok
    captureExceptionMock.mockReset();
  });
  afterEach(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
  });

  it('reports dailyPuzzleGeneration.ok = true and 200 when the pipeline is healthy', async () => {
    const request = makeHarness();
    const { status, body } = await request('GET', '/ready');

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const checks = body.checks as Record<string, { ok: boolean }>;
    expect(checks.dailyPuzzleGeneration.ok).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('does NOT 503 /ready when the generation pipeline is behind (the coupling being removed)', async () => {
    const request = makeHarness({
      // furthest published date only 5 days out — well inside the 30-day horizon
      getFurthestPublishedDailyPuzzleDate: async () => '2026-09-10',
    });
    const { status, body } = await request('GET', '/ready');

    const checks = body.checks as Record<string, { ok: boolean; shouldAlert: boolean }>;
    expect(checks.dailyPuzzleGeneration.ok).toBe(false);
    expect(checks.dailyPuzzleGeneration.shouldAlert).toBe(true);

    // The whole point: a behind pipeline is surfaced + alerted, but /ready stays green.
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT 503 /ready even when daily_puzzles has zero published rows', async () => {
    const request = makeHarness({
      getFurthestPublishedDailyPuzzleDate: async () => null,
    });
    const { status, body } = await request('GET', '/ready');

    const checks = body.checks as Record<string, { ok: boolean }>;
    expect(checks.dailyPuzzleGeneration.ok).toBe(false);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('still 503s /ready for a real readiness failure (supabase probe down)', async () => {
    supabaseFetchMock.mockReset().mockRejectedValue(new Error('db unreachable'));
    const request = makeHarness();
    const { status, body } = await request('GET', '/ready');

    expect(status).toBe(503);
    expect(body.ok).toBe(false);
  });

  it('does not probe or alert when required env is missing', async () => {
    delete process.env.SUPABASE_URL;
    const probe = vi.fn(async () => '2027-09-01');
    const request = makeHarness({ getFurthestPublishedDailyPuzzleDate: probe });
    const { status } = await request('GET', '/ready');

    expect(status).toBe(503); // missing_required_env, via supabase.ok = false
    expect(probe).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
