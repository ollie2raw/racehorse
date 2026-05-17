import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTournamentRoutes } from './routes';

const validUserId = '11111111-1111-4111-8111-111111111111';

const mocks = vi.hoisted(() => ({
  supabaseFetch: vi.fn(),
  fetchRegistrationsForUser: vi.fn(),
  fetchActiveAssignedMatchForUser: vi.fn(),
  fetchUpcomingTournaments: vi.fn(),
  fetchTournamentById: vi.fn(),
  fetchBracketView: vi.fn(),
  fetchActiveRegistration: vi.fn(),
  fetchRegistrations: vi.fn(),
  fetchRegistrationsWithProfile: vi.fn(),
  insertRegistration: vi.fn(),
  withdrawRegistration: vi.fn(),
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...args),
}));

vi.mock('./persistence', async () => {
  const actual = await vi.importActual<typeof import('./persistence')>('./persistence');
  return {
    ...actual,
    fetchUpcomingTournaments: (...args: unknown[]) => mocks.fetchUpcomingTournaments(...args),
    fetchTournamentById: (...args: unknown[]) => mocks.fetchTournamentById(...args),
    fetchBracketView: (...args: unknown[]) => mocks.fetchBracketView(...args),
    fetchActiveAssignedMatchForUser: (...args: unknown[]) => mocks.fetchActiveAssignedMatchForUser(...args),
    fetchRegistrationsForUser: (...args: unknown[]) => mocks.fetchRegistrationsForUser(...args),
    fetchActiveRegistration: (...args: unknown[]) => mocks.fetchActiveRegistration(...args),
    fetchRegistrations: (...args: unknown[]) => mocks.fetchRegistrations(...args),
    fetchRegistrationsWithProfile: (...args: unknown[]) => mocks.fetchRegistrationsWithProfile(...args),
    insertRegistration: (...args: unknown[]) => mocks.insertRegistration(...args),
    withdrawRegistration: (...args: unknown[]) => mocks.withdrawRegistration(...args),
  };
});

type Method = 'GET' | 'POST' | 'DELETE';
type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => { routes.set(`GET ${path}`, handler); },
    post: (path: string, handler: RouteHandler) => { routes.set(`POST ${path}`, handler); },
    delete: (path: string, handler: RouteHandler) => { routes.set(`DELETE ${path}`, handler); },
  };
  registerTournamentRoutes(app as any);

  return {
    async request(
      method: Method,
      path: string,
      req: { headers?: Record<string, string>; body?: unknown; query?: unknown; params?: unknown } = {},
    ): Promise<{ status: number; body: any }> {
      const handler = routes.get(`${method} ${path}`);
      if (!handler) throw new Error(`missing route: ${method} ${path}`);
      let statusCode = 200;
      let responseBody: any;
      const res = {
        status: vi.fn((code: number) => {
          statusCode = code;
          return res;
        }),
        json: vi.fn((body: unknown) => {
          responseBody = body;
          return res;
        }),
      };

      await handler(
        {
          headers: req.headers ?? {},
          body: req.body ?? {},
          query: req.query ?? {},
          params: req.params ?? {},
        },
        res,
      );

      return { status: statusCode, body: responseBody };
    },
  };
}

describe('scheduled tournament routes auth/user guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('/api/tournaments/me without auth returns anonymous empty state without Supabase UUID queries', async () => {
    const { request } = makeHarness();
    const response = await request('GET', '/api/tournaments/me');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, registrations: [], activeAssignedMatch: null });
    expect(mocks.fetchRegistrationsForUser).not.toHaveBeenCalled();
    expect(mocks.fetchActiveAssignedMatchForUser).not.toHaveBeenCalled();
  });

  it('/api/tournaments/me with a valid auth user returns registrations', async () => {
    const { request } = makeHarness();
    const registration = {
      id: 'reg-1',
      tournament_id: 'tour-1',
      user_id: validUserId,
      registered_at: new Date('2026-05-16T00:00:00Z').toISOString(),
      seed: null,
      placement: null,
      status: 'registered',
    };
    mocks.supabaseFetch.mockResolvedValue({ id: validUserId });
    mocks.fetchRegistrationsForUser.mockResolvedValue([registration]);
    mocks.fetchActiveAssignedMatchForUser.mockResolvedValue(null);

    const response = await request('GET', '/api/tournaments/me', {
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      registrations: [registration],
      activeAssignedMatch: null,
    });
    expect(mocks.fetchRegistrationsForUser).toHaveBeenCalledWith(validUserId);
  });

  it('register rejects missing or empty userId cleanly', async () => {
    const { request } = makeHarness();
    const missing = await request('POST', '/api/tournaments/:id/register', {
      params: { id: 'tour-1' },
      body: {},
    });
    const empty = await request('POST', '/api/tournaments/:id/register', {
      params: { id: 'tour-1' },
      body: { userId: '   ' },
    });

    expect(missing).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(empty).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(mocks.fetchTournamentById).not.toHaveBeenCalled();
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it('withdraw rejects missing or empty userId cleanly', async () => {
    const { request } = makeHarness();
    const missing = await request('DELETE', '/api/tournaments/:id/register', {
      params: { id: 'tour-1' },
      body: {},
    });
    const empty = await request('DELETE', '/api/tournaments/:id/register', {
      params: { id: 'tour-1' },
      body: { userId: '' },
    });

    expect(missing).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(empty).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(mocks.withdrawRegistration).not.toHaveBeenCalled();
  });
});
