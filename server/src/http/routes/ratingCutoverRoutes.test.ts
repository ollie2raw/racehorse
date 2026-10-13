import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const { statusMock, setMock } = vi.hoisted(() => ({ statusMock: vi.fn(), setMock: vi.fn() }));
vi.mock('../../ranking/ratingCutoverGate', () => ({
  getRatingCutoverStatus: (...a: unknown[]) => statusMock(...a),
  setRatingCutoverQuiesced: (...a: unknown[]) => setMock(...a),
}));

import { registerRatingCutoverRoutes } from './ratingCutoverRoutes';

type Handler = (req: unknown, res: unknown) => Promise<void>;

function harness() {
  const routes = new Map<string, Handler>();
  registerRatingCutoverRoutes({
    get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
    post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
  } as unknown as Application);
  return async (key: string, secret: string | undefined, body: unknown = {}) => {
    let code = 200;
    let payload: unknown;
    const headers: Record<string, string> = {};
    const res = {
      status(c: number) { code = c; return res; },
      json(v: unknown) { payload = v; return res; },
      setHeader(k: string, v: string) { headers[k] = v; },
    };
    await routes.get(key)!({ get: (n: string) => (n.toLowerCase() === 'x-admin-secret' ? secret : undefined), body }, res);
    return { code, payload, headers };
  };
}

describe('rating cutover operator routes', () => {
  const original = process.env.ADMIN_SECRET;
  beforeEach(() => {
    process.env.ADMIN_SECRET = 'correct-horse-battery';
    statusMock.mockReset().mockResolvedValue({ readyForExpand: true });
    setMock.mockReset().mockResolvedValue({});
  });
  afterEach(() => { process.env.ADMIN_SECRET = original; });

  it.each([
    ['GET /api/ops/rating-cutover/status', undefined],
    ['GET /api/ops/rating-cutover/status', 'wrong'],
    ['POST /api/ops/rating-cutover/quiesce', undefined],
    ['POST /api/ops/rating-cutover/quiesce', 'wrong'],
  ])('%s rejects secret %s and changes nothing', async (key, secret) => {
    const r = await harness()(key, secret, { enabled: true });
    expect(r.code).toBe(401);
    expect(setMock).not.toHaveBeenCalled();
    expect(statusMock).not.toHaveBeenCalled();
    expect(JSON.stringify(r.payload)).not.toContain('correct-horse');
  });

  it('rejects all access when ADMIN_SECRET is unset (no empty-secret bypass)', async () => {
    delete process.env.ADMIN_SECRET;
    const request = harness();
    expect((await request('POST /api/ops/rating-cutover/quiesce', '', { enabled: true })).code).toBe(401);
    expect((await request('GET /api/ops/rating-cutover/status', undefined)).code).toBe(401);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('toggles with the secret, validates the body, and returns no-store status', async () => {
    const request = harness();
    expect((await request('POST /api/ops/rating-cutover/quiesce', 'correct-horse-battery', { enabled: 'yes' })).code).toBe(400);
    const ok = await request('POST /api/ops/rating-cutover/quiesce', 'correct-horse-battery', { enabled: true, reason: 'cutover' });
    expect(ok.code).toBe(200);
    expect(setMock).toHaveBeenCalledWith(true, 'cutover');
    expect(ok.headers['Cache-Control']).toBe('no-store');
    expect(ok.payload).toEqual({ readyForExpand: true });
  });

  it('reports 503 (not success) when the durable fence cannot be changed', async () => {
    setMock.mockRejectedValue(new Error('db down'));
    const r = await harness()('POST /api/ops/rating-cutover/quiesce', 'correct-horse-battery', { enabled: true });
    expect(r.code).toBe(503);
  });
});
