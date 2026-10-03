import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseFetch: vi.fn(async () => []),
  startTournamentScheduler: vi.fn(),
  recoverTournamentMatches: vi.fn(async () => undefined),
}));

vi.mock('../supabaseUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../supabaseUtils')>()),
  supabaseFetch: (...args: unknown[]) => mocks.supabaseFetch(...(args as [])),
}));
vi.mock('./scheduler', () => ({ startTournamentScheduler: mocks.startTournamentScheduler }));
vi.mock('./recovery', () => ({ recoverTournamentMatches: mocks.recoverTournamentMatches }));

import { registerTournamentRoutes } from './routes';
import { registerTournamentSocketHandlers } from './socketHandlers';
import { isTournamentsEnabled } from './tournamentsFeature';

type Handler = (req: unknown, res: unknown) => unknown;

function harness() {
  const routes = new Map<string, Handler>();
  const app = {
    get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
    post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
    delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
  };
  registerTournamentRoutes(app as never);
  return async (method: string, path: string) => {
    let status = 200;
    let body: unknown;
    const res = {
      status: (code: number) => { status = code; return res; },
      json: (value: unknown) => { body = value; return res; },
    };
    await routes.get(`${method} ${path}`)!({ headers: { authorization: 'Bearer t' }, params: { id: 'x' }, query: {}, body: {} }, res);
    return { status, body: body as Record<string, unknown> };
  };
}

describe('tournaments switched off (default)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.supabaseFetch.mockClear();
  });

  it('is off unless TOURNAMENTS_ENABLED is exactly "true"', () => {
    for (const value of [undefined, '', 'false', '1', 'TRUE']) {
      vi.stubEnv('TOURNAMENTS_ENABLED', value);
      expect(isTournamentsEnabled()).toBe(false);
    }
    vi.stubEnv('TOURNAMENTS_ENABLED', 'true');
    expect(isTournamentsEnabled()).toBe(true);
  });

  it('answers every route without touching Supabase; refuses register/withdraw', async () => {
    vi.stubEnv('TOURNAMENTS_ENABLED', undefined);
    const request = harness();
    expect(await request('GET', '/api/tournaments/upcoming')).toEqual({ status: 200, body: { ok: true, disabled: true, tournaments: [] } });
    const me = await request('GET', '/api/tournaments/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ ok: true, disabled: true, registrations: [], activeAssignedMatch: null, countdown: null });
    expect((await request('GET', '/api/tournaments/my')).body).toMatchObject({ ok: true, registrations: [] });
    expect((await request('GET', '/api/tournaments/history')).body).toMatchObject({ ok: true, history: [] });
    for (const [method, path] of [
      ['GET', '/api/tournaments/:id/bracket'],
      ['GET', '/api/tournaments/:id'],
      ['GET', '/api/tournaments/:id/result'],
      ['POST', '/api/tournaments/:id/register'],
      ['DELETE', '/api/tournaments/:id/register'],
    ] as const) {
      const response = await request(method, path);
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({ ok: false, error: 'tournaments_disabled' });
    }
    expect(mocks.supabaseFetch).not.toHaveBeenCalled();
  });

  it('socket register/withdraw/get_bracket ack tournaments_disabled without a query', async () => {
    vi.stubEnv('TOURNAMENTS_ENABLED', undefined);
    const handlers = new Map<string, (payload: unknown, ack: (r: unknown) => void) => unknown>();
    const socket = { on: (event: string, handler: never) => handlers.set(event, handler), data: {} };
    registerTournamentSocketHandlers({} as never, socket as never);
    for (const event of ['tournament:register', 'tournament:withdraw', 'tournament:get_bracket']) {
      const ack = vi.fn();
      await handlers.get(event)!({ tournamentId: 'x' }, ack);
      expect(ack).toHaveBeenCalledWith(expect.objectContaining({ error: 'tournaments_disabled' }));
    }
    expect(mocks.supabaseFetch).not.toHaveBeenCalled();
  });

  it('boot starts no scheduler (so no seeding) and no recovery', async () => {
    vi.stubEnv('TOURNAMENTS_ENABLED', undefined);
    vi.useFakeTimers();
    try {
      const { bootstrapScheduledTournamentInfrastructure } = await import('./index');
      const app = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
      bootstrapScheduledTournamentInfrastructure({} as never, app as never);
      vi.advanceTimersByTime(10_000);
      expect(mocks.startTournamentScheduler).not.toHaveBeenCalled();
      expect(mocks.recoverTournamentMatches).not.toHaveBeenCalled();
      expect(app.get).toHaveBeenCalled(); // routes still answer
    } finally {
      vi.useRealTimers();
    }
  });
});
