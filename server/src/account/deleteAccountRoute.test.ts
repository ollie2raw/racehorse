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

import { registerAccountRoutes } from './routes';
import type { Router } from 'express';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const router = {
    get(path: string, handler: Handler) { routes.set(`GET ${path}`, handler); },
    post(path: string, handler: Handler) { routes.set(`POST ${path}`, handler); },
    delete(path: string, handler: Handler) { routes.set(`DELETE ${path}`, handler); },
  };
  registerAccountRoutes(router as unknown as Router);

  return async function request(method: 'DELETE', path: string, body: unknown = {}) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`Missing route ${method} ${path}`);
    let status = 200;
    let payload: unknown;
    const res = {
      status(code: number) { status = code; return res; },
      json(value: unknown) { payload = value; return res; },
    };
    await handler({ headers: {}, params: {}, query: {}, body, method, path }, res);
    return { status, body: payload as Record<string, unknown> };
  };
}

const USER_ID = '11111111-1111-1111-1111-111111111111';

/** The profile lookup the route does before it will accept the confirmation. */
const profileRow = [{ username: 'oliver' }];

describe('DELETE /api/account', () => {
  beforeEach(() => {
    supabaseFetchMock.mockReset();
    requireAuthMock.mockReset();
    requireAuthMock.mockResolvedValue(USER_ID);
  });

  it('refuses an unauthenticated caller and deletes nothing', async () => {
    // requireAuth has already written 401 to the response by the time it
    // resolves null; the route's job is to stop.
    requireAuthMock.mockResolvedValue(null);
    const request = makeHarness();

    await request('DELETE', '/', { confirm: 'oliver' });

    expect(supabaseFetchMock).not.toHaveBeenCalled();
  });

  it('deletes the auth user when the typed handle matches', async () => {
    supabaseFetchMock.mockResolvedValueOnce(profileRow).mockResolvedValueOnce(undefined);
    const request = makeHarness();

    const response = await request('DELETE', '/', { confirm: 'oliver' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    // Deleting the auth user is what cascades; deleting the profile row alone
    // would leave a sign-in-able account with no profile.
    expect(supabaseFetchMock).toHaveBeenLastCalledWith(
      `/auth/v1/admin/users/${USER_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('accepts the handle however the user cased or padded it', async () => {
    supabaseFetchMock.mockResolvedValueOnce(profileRow).mockResolvedValueOnce(undefined);
    const request = makeHarness();

    const response = await request('DELETE', '/', { confirm: '  OLIVER ' });

    expect(response.status).toBe(200);
  });

  it('refuses a confirmation that does not match, and deletes nothing', async () => {
    supabaseFetchMock.mockResolvedValueOnce(profileRow);
    const request = makeHarness();

    const response = await request('DELETE', '/', { confirm: 'olivia' });

    expect(response.status).toBe(400);
    expect(supabaseFetchMock).toHaveBeenCalledTimes(1);
    expect(supabaseFetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/auth/v1/admin/users/'),
      expect.anything(),
    );
  });

  it('refuses a missing confirmation', async () => {
    supabaseFetchMock.mockResolvedValueOnce(profileRow);
    const request = makeHarness();

    const response = await request('DELETE', '/', {});

    expect(response.status).toBe(400);
    expect(supabaseFetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed delete rather than telling the user it worked', async () => {
    supabaseFetchMock
      .mockResolvedValueOnce(profileRow)
      .mockRejectedValueOnce(new Error('supabase unavailable'));
    const request = makeHarness();

    const response = await request('DELETE', '/', { confirm: 'oliver' });

    expect(response.status).toBe(500);
    expect(response.body.ok).toBeUndefined();
  });

  it('404s when the account has no profile row to confirm against', async () => {
    supabaseFetchMock.mockResolvedValueOnce([]);
    const request = makeHarness();

    const response = await request('DELETE', '/', { confirm: 'oliver' });

    expect(response.status).toBe(404);
    expect(supabaseFetchMock).toHaveBeenCalledTimes(1);
  });
});
