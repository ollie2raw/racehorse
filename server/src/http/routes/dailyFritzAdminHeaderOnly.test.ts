/**
 * AU-6 (HARDENING_PLAN §6.3): the three GET admin endpoints accept the admin
 * secret ONLY via the `x-admin-secret` header. The former `?admin_key=` query
 * fallback leaked the secret into access logs / history / Referer and is gone.
 */
import { afterEach, describe, expect, it } from 'vitest';
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
    method: 'GET',
    path: string,
    input: { headerSecret?: string; query?: Record<string, string> } = {},
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
      headers: input.headerSecret ? { 'x-admin-secret': input.headerSecret } : {},
      params: { attemptId: 'a1' },
      query: input.query ?? {},
      body: {},
      method,
      path,
      get(name: string) {
        return name.toLowerCase() === 'x-admin-secret' ? input.headerSecret : undefined;
      },
    }, res);
    return { status, body };
  };
}

const GET_ENDPOINTS = [
  '/api/daily-fritz/metrics',
  '/api/daily-fritz/health',
  '/api/daily-fritz/events/:attemptId',
];

describe('daily-fritz GET admin endpoints — header-only secret (AU-6)', () => {
  afterEach(() => { delete process.env.ADMIN_SECRET; });

  for (const path of GET_ENDPOINTS) {
    it(`${path}: rejects ?admin_key= query param with 401`, async () => {
      process.env.ADMIN_SECRET = 'the-secret';
      const request = makeHarness();
      const response = await request('GET', path, { query: { admin_key: 'the-secret' } });
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it(`${path}: a wrong header secret is still 401 (header path intact)`, async () => {
      process.env.ADMIN_SECRET = 'the-secret';
      const request = makeHarness();
      const response = await request('GET', path, { headerSecret: 'wrong' });
      expect(response.status).toBe(401);
    });
  }
});
