import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTournamentRoutes } from './routes';
import { takeServerNow } from './serverNow.testkit';

/**
 * A guest (a Supabase anonymous session, docs/guest-play-design.md decision 4) is signed in but may not take part in tournaments until they make an
 * account. Enforced here in the server, not just hidden in the app: the route is what a hand-made request would hit.
 */

beforeEach(() => {
  vi.stubEnv('TOURNAMENTS_ENABLED', 'true');
  vi.stubEnv('FRITZ_CUP_ENABLED', 'true');
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const USER = '11111111-1111-4111-8111-111111111111';
const TOURNAMENT = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  isGuest: false,
  verified: true,
  registerForTournament: vi.fn(),
  guestChecks: vi.fn(),
}));

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn(async () => ({})), isSupabaseTimeoutError: () => false }));
vi.mock('../platform/auth/supabaseAuth', () => ({
  verifyBearerToken: async () => (mocks.verified ? USER : null),
  isGuestBearerToken: async () => {
    mocks.guestChecks();
    return mocks.isGuest;
  },
}));
vi.mock('./persistence', async () => {
  const actual = await vi.importActual<typeof import('./persistence')>('./persistence');
  return { ...actual, registerForTournament: (...args: unknown[]) => mocks.registerForTournament(...args) };
});

type RouteHandler = (req: any, res: any) => unknown | Promise<unknown>;

function harness() {
  const routes = new Map<string, RouteHandler>();
  const app = {
    get: (path: string, handler: RouteHandler) => routes.set(`GET ${path}`, handler),
    post: (path: string, handler: RouteHandler) => routes.set(`POST ${path}`, handler),
    delete: (path: string, handler: RouteHandler) => routes.set(`DELETE ${path}`, handler),
  };
  registerTournamentRoutes(app as any);
  return async (method: 'POST' | 'DELETE', path: string, req: { headers?: Record<string, string>; params?: unknown; body?: unknown } = {}) => {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`missing route: ${method} ${path}`);
    let status = 200;
    let body: any;
    const res = {
      setHeader: vi.fn(),
      set: vi.fn(),
      status: vi.fn((code: number) => {
        status = code;
        return res;
      }),
      json: vi.fn((payload: unknown) => {
        body = takeServerNow(payload);
        return res;
      }),
    };
    await handler({ headers: req.headers ?? {}, body: req.body ?? {}, query: {}, params: req.params ?? {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, connection: { remoteAddress: '127.0.0.1' } }, res);
    return { status, body };
  };
}

const AUTHED = { authorization: 'Bearer token' };

beforeEach(() => {
  mocks.isGuest = false;
  mocks.verified = true;
  mocks.registerForTournament.mockReset();
  mocks.registerForTournament.mockResolvedValue({ already_registered: false });
  mocks.guestChecks.mockReset();
});

describe('registering for a tournament', () => {
  it('refuses a guest with 403 account_required, before touching the database', async () => {
    mocks.isGuest = true;
    const { status, body } = await harness()('POST', '/api/tournaments/:id/register', { headers: AUTHED, params: { id: TOURNAMENT } });
    expect(status).toBe(403);
    expect(body).toEqual({ ok: false, error: 'account_required' });
    expect(mocks.registerForTournament).not.toHaveBeenCalled();
  });

  it('lets a permanent account register as before', async () => {
    const { status, body } = await harness()('POST', '/api/tournaments/:id/register', { headers: AUTHED, params: { id: TOURNAMENT } });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mocks.registerForTournament).toHaveBeenCalledWith(TOURNAMENT, USER);
  });

  it('still says not_authenticated (401), not account_required, to someone who is not signed in at all', async () => {
    mocks.verified = false;
    mocks.isGuest = true; // would be a guest if it verified; it does not
    const { status, body } = await harness()('POST', '/api/tournaments/:id/register', { headers: AUTHED, params: { id: TOURNAMENT } });
    expect(status).toBe(401);
    expect(body).toEqual({ ok: false, error: 'not_authenticated' });
  });

  it('says not_authenticated for a request with no token, and never asks whether it is a guest', async () => {
    const { status, body } = await harness()('POST', '/api/tournaments/:id/register', { headers: {}, params: { id: TOURNAMENT } });
    expect(status).toBe(401);
    expect(body.error).toBe('not_authenticated');
    expect(mocks.guestChecks).not.toHaveBeenCalled();
  });
});

describe('starting a Fritz Cup', () => {
  it('refuses a guest with 403 account_required', async () => {
    mocks.isGuest = true;
    const { status, body } = await harness()('POST', '/api/tournaments/fritz-cup', { headers: AUTHED });
    expect(status).toBe(403);
    expect(body).toEqual({ ok: false, error: 'account_required' });
  });

  it('does not stop a permanent account at the guest check (it goes on to the route\'s own handling)', async () => {
    const { status, body } = await harness()('POST', '/api/tournaments/fritz-cup', { headers: AUTHED });
    expect(body?.error).not.toBe('account_required');
    expect(status).not.toBe(403);
  });
});

describe('what a guest may still do', () => {
  it('can withdraw a registration they cannot have (no guest check on the way out)', async () => {
    mocks.isGuest = true;
    await harness()('DELETE', '/api/tournaments/:id/register', { headers: AUTHED, params: { id: TOURNAMENT } }).catch(() => undefined);
    expect(mocks.guestChecks).not.toHaveBeenCalled();
  });
});
