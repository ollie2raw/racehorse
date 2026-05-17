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

const validTournamentId = '22222222-2222-4222-8222-222222222222';

describe('scheduled tournament express route ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/tournaments/me hits the /me handler, not :id', async () => {
    const { request } = makeHarness();
    const response = await request('GET', '/api/tournaments/me');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, registrations: [], activeAssignedMatch: null });
    expect(mocks.fetchTournamentById).not.toHaveBeenCalled();
    expect(mocks.fetchBracketView).not.toHaveBeenCalled();
  });

  it('GET /api/tournaments/not-a-uuid returns 400 invalid_tournament_id', async () => {
    const { request } = makeHarness();
    const response = await request('GET', '/api/tournaments/:id', {
      params: { id: 'not-a-uuid' },
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ ok: false, error: 'invalid_tournament_id' });
    expect(mocks.fetchTournamentById).not.toHaveBeenCalled();
  });

  it('dynamic tournament routes reject invalid IDs before Supabase is called', async () => {
    const { request } = makeHarness();
    const invalidId = 'not-a-uuid';

    const bracket = await request('GET', '/api/tournaments/:id/bracket', { params: { id: invalidId } });
    const result = await request('GET', '/api/tournaments/:id/result', { params: { id: invalidId } });
    const byId = await request('GET', '/api/tournaments/:id', { params: { id: invalidId } });

    for (const response of [bracket, result, byId]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ ok: false, error: 'invalid_tournament_id' });
    }
    expect(mocks.fetchTournamentById).not.toHaveBeenCalled();
    expect(mocks.fetchBracketView).not.toHaveBeenCalled();
  });

  it('GET /api/tournaments/:id accepts a valid UUID and queries persistence', async () => {
    const { request } = makeHarness();
    mocks.fetchTournamentById.mockResolvedValue({ id: validTournamentId, status: 'upcoming' });

    const response = await request('GET', '/api/tournaments/:id', { params: { id: validTournamentId } });

    expect(response.status).toBe(200);
    expect(mocks.fetchTournamentById).toHaveBeenCalledWith(validTournamentId);
  });
});

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

  it('/api/tournaments/me returns activeAssignedMatch recovery payload with roomCode', async () => {
    const { request } = makeHarness();
    mocks.supabaseFetch.mockResolvedValue({ id: validUserId });
    mocks.fetchRegistrationsForUser.mockResolvedValue([]);
    mocks.fetchActiveAssignedMatchForUser.mockResolvedValue({
      match: {
        id: 'match-1',
        tournament_id: 'tour-1',
        round: 1,
        match_number: 1,
        player1_id: validUserId,
        player2_id: 'bot:fritz:tour-1:1',
        winner_id: null,
        room_code: 'T128FFFR1M1',
        status: 'in_progress',
        ready_at: new Date('2026-05-16T00:00:00Z').toISOString(),
        ready_deadline_at: new Date('2026-05-16T00:02:00Z').toISOString(),
        started_at: null,
        completed_at: null,
        player1_joined_at: null,
        player2_joined_at: new Date('2026-05-16T00:00:00Z').toISOString(),
        winner_source: null,
        status_reason: null,
        forfeit_user_id: null,
        no_show_user_id: null,
        bot_tier: 'elite',
        player1_score: null,
        player2_score: null,
      },
      tournament: { id: 'tour-1', status: 'in_progress' },
      opponentUsername: 'Elite Fritz',
    });

    const response = await request('GET', '/api/tournaments/me', {
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      registrations: [],
      activeAssignedMatch: {
        matchId: 'match-1',
        tournamentId: 'tour-1',
        round: 1,
        roomCode: 'T128FFFR1M1',
        opponentId: 'bot:fritz:tour-1:1',
        opponentUsername: 'Elite Fritz',
        matchStatus: 'ready',
        readyDeadlineAt: expect.any(String),
      },
    });
  });

  it('/api/tournaments/me returns ready activeAssignedMatch before deadline', async () => {
    const { request } = makeHarness();
    mocks.supabaseFetch.mockResolvedValue({ id: validUserId });
    mocks.fetchRegistrationsForUser.mockResolvedValue([]);
    mocks.fetchActiveAssignedMatchForUser.mockResolvedValue({
      match: {
        id: 'match-ready',
        tournament_id: 'tour-1',
        round: 1,
        match_number: 1,
        player1_id: validUserId,
        player2_id: 'bot:fritz:tour-1:1',
        winner_id: null,
        room_code: 'TREADYR1M1',
        status: 'ready',
        ready_at: new Date('2026-05-16T00:00:00Z').toISOString(),
        ready_deadline_at: new Date(Date.now() + 60_000).toISOString(),
        started_at: null,
        completed_at: null,
        player1_joined_at: null,
        player2_joined_at: null,
        winner_source: null,
        status_reason: null,
        forfeit_user_id: null,
        no_show_user_id: null,
        bot_tier: 'standard',
        player1_score: null,
        player2_score: null,
      },
      tournament: { id: 'tour-1', status: 'in_progress' },
      opponentUsername: 'Fritz',
    });

    const response = await request('GET', '/api/tournaments/me', {
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.status).toBe(200);
    expect(response.body.activeAssignedMatch).toEqual(
      expect.objectContaining({
        matchId: 'match-ready',
        matchStatus: 'ready',
        roomCode: 'TREADYR1M1',
      }),
    );
  });

  it('/api/tournaments/me does not return completed matches as activeAssignedMatch', async () => {
    const { request } = makeHarness();
    mocks.supabaseFetch.mockResolvedValue({ id: validUserId });
    mocks.fetchRegistrationsForUser.mockResolvedValue([
      {
        id: 'reg-1',
        tournament_id: 'tour-1',
        user_id: validUserId,
        registered_at: new Date('2026-05-16T00:00:00Z').toISOString(),
        seed: 1,
        placement: null,
        status: 'eliminated',
      },
    ]);
    mocks.fetchActiveAssignedMatchForUser.mockResolvedValue({
      match: {
        id: 'match-done',
        tournament_id: 'tour-1',
        round: 1,
        match_number: 1,
        player1_id: validUserId,
        player2_id: 'bot:fritz:tour-1:1',
        winner_id: 'bot:fritz:tour-1:1',
        room_code: 'TDONER1M1',
        status: 'completed',
        ready_at: null,
        ready_deadline_at: null,
        started_at: null,
        completed_at: new Date('2026-05-16T00:02:00Z').toISOString(),
        player1_joined_at: null,
        player2_joined_at: new Date('2026-05-16T00:00:00Z').toISOString(),
        winner_source: 'no_show',
        status_reason: 'player1_no_show',
        forfeit_user_id: null,
        no_show_user_id: validUserId,
        bot_tier: 'standard',
        player1_score: 0,
        player2_score: 30,
      },
      tournament: { id: 'tour-1', status: 'in_progress' },
      opponentUsername: 'Fritz',
    });

    const response = await request('GET', '/api/tournaments/me', {
      headers: { authorization: 'Bearer valid-token' },
    });

    expect(response.status).toBe(200);
    expect(response.body.activeAssignedMatch).toBeNull();
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

  it('register rejects invalid tournament id before userId checks', async () => {
    const { request } = makeHarness();
    const response = await request('POST', '/api/tournaments/:id/register', {
      params: { id: 'not-a-uuid' },
      body: { userId: validUserId },
    });

    expect(response).toEqual({ status: 400, body: { ok: false, error: 'invalid_tournament_id' } });
    expect(mocks.fetchTournamentById).not.toHaveBeenCalled();
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it('register rejects missing or empty userId cleanly', async () => {
    const { request } = makeHarness();
    const missing = await request('POST', '/api/tournaments/:id/register', {
      params: { id: validTournamentId },
      body: {},
    });
    const empty = await request('POST', '/api/tournaments/:id/register', {
      params: { id: validTournamentId },
      body: { userId: '   ' },
    });

    expect(missing).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(empty).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(mocks.fetchTournamentById).not.toHaveBeenCalled();
    expect(mocks.insertRegistration).not.toHaveBeenCalled();
  });

  it('withdraw rejects invalid tournament id before userId checks', async () => {
    const { request } = makeHarness();
    const response = await request('DELETE', '/api/tournaments/:id/register', {
      params: { id: 'me' },
      body: { userId: validUserId },
    });

    expect(response).toEqual({ status: 400, body: { ok: false, error: 'invalid_tournament_id' } });
    expect(mocks.withdrawRegistration).not.toHaveBeenCalled();
  });

  it('withdraw rejects missing or empty userId cleanly', async () => {
    const { request } = makeHarness();
    const missing = await request('DELETE', '/api/tournaments/:id/register', {
      params: { id: validTournamentId },
      body: {},
    });
    const empty = await request('DELETE', '/api/tournaments/:id/register', {
      params: { id: validTournamentId },
      body: { userId: '' },
    });

    expect(missing).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(empty).toEqual({ status: 400, body: { ok: false, error: 'missing_userId' } });
    expect(mocks.withdrawRegistration).not.toHaveBeenCalled();
  });
});
