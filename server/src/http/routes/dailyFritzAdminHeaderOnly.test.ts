/**
 * AU-6 (HARDENING_PLAN §6.3): the daily-fritz admin endpoints accept the
 * admin secret ONLY via the `x-admin-secret` header. The former
 * `?admin_key=` query fallback leaked the secret into access logs / history
 * / Referer and is gone.
 *
 * §13.1.6 (HARDENING_PLAN.md, System 13) extended this to the three POST
 * routes (generate/invalidate/reset-attempt) that had never been migrated
 * off a `req.body?.adminKey` check — an inconsistency, not itself exploited,
 * but worth closing before ADMIN_SECRET is ever set in prod. `ranking.ts`'s
 * `/api/ranking/process/:userId` and `botMatches.ts`'s
 * `/bot-matches/cleanup-stale` got the same fix but have no existing test
 * harness to extend — not forcing one, consistent with how migration-only
 * fixes elsewhere in this plan are handled.
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
    method: 'GET' | 'POST',
    path: string,
    input: { headerSecret?: string; query?: Record<string, string>; body?: Record<string, unknown> } = {},
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
      body: input.body ?? {},
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

const POST_ENDPOINTS = [
  '/api/daily-fritz/generate',
  '/api/daily-fritz/invalidate',
  '/api/daily-fritz/reset-attempt',
];

describe('daily-fritz POST admin endpoints — migrated to header-only secret (§13.1.6)', () => {
  afterEach(() => { delete process.env.ADMIN_SECRET; });

  for (const path of POST_ENDPOINTS) {
    it(`${path}: a correct secret in the body (the old accepted shape) is now rejected — 403, forbidden`, async () => {
      process.env.ADMIN_SECRET = 'the-secret';
      const request = makeHarness();
      const response = await request('POST', path, { body: { adminKey: 'the-secret' } });
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it(`${path}: the correct secret via the x-admin-secret header is accepted (passes the admin check)`, async () => {
      process.env.ADMIN_SECRET = 'the-secret';
      const request = makeHarness();
      const response = await request('POST', path, { headerSecret: 'the-secret' });
      // Past the admin gate, each route 400s on its own missing business
      // fields (run_date, etc.) — never 403/Forbidden. That's what proves
      // the header path is the one actually being checked.
      expect(response.status).not.toBe(403);
      expect(response.body).not.toEqual({ error: 'Forbidden' });
    });
  }
});
