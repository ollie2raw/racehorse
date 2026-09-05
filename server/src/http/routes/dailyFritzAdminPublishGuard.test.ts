/**
 * Guardrail #7 (ENGINEERING_GUARDRAILS.md §7) — the admin regenerate/invalidate
 * routes must not blind-publish a Daily Fritz challenge under current version
 * constants against a frozen row. Behavioural coverage for the two call sites
 * INV-19 pins structurally.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'express';

const {
  isAdminSecretMock,
  getRunMock,
  upsertRunMock,
  getPublishedMock,
  publishMock,
  invalidateMock,
} = vi.hoisted(() => ({
  isAdminSecretMock: vi.fn(() => true),
  getRunMock: vi.fn(),
  upsertRunMock: vi.fn(),
  getPublishedMock: vi.fn(),
  publishMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('../../platform/auth/adminSecret', () => ({ isAdminSecret: isAdminSecretMock }));

vi.mock('../stores/dailyFritzStore', async () => {
  const actual = await vi.importActual<typeof import('../stores/dailyFritzStore')>('../stores/dailyFritzStore');
  return { ...actual, getDailyFritzRun: getRunMock, upsertDailyFritzRun: upsertRunMock };
});

vi.mock('../stores/dailyFritzPublishedChallengeStore', () => ({
  getDailyFritzPublishedChallenge: getPublishedMock,
  publishDailyFritzChallenge: publishMock,
  invalidateDailyFritzPublishedChallenge: invalidateMock,
}));

vi.mock('./dailyFritzVerificationGlue', async () => {
  const actual = await vi.importActual<typeof import('./dailyFritzVerificationGlue')>('./dailyFritzVerificationGlue');
  return { ...actual, DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED: true };
});

import { registerDailyFritzAdminRoutes } from './dailyFritzAdminRoutes';

type Handler = (req: unknown, res: unknown) => unknown | Promise<unknown>;

function makeHarness() {
  const routes = new Map<string, Handler>();
  const app = { get() {}, post(path: string, h: Handler) { routes.set(path, h); } };
  registerDailyFritzAdminRoutes(app as unknown as Application);
  return async (path: string, body: Record<string, unknown>) => {
    const handler = routes.get(path);
    if (!handler) throw new Error(`no route ${path}`);
    let status = 200;
    let json: unknown;
    const res = { status(c: number) { status = c; return res; }, json(v: unknown) { json = v; return res; } };
    await handler({ headers: { 'x-admin-secret': 's' }, get: () => 's', body, params: {}, query: {} }, res);
    return { status, body: json as Record<string, unknown> };
  };
}

const GEN_BODY = { run_date: '2026-12-01', fritz_tier: 'elite', deal_size: 7, winning_score: 60 };

describe('daily-fritz admin routes — Guardrail #7 publish guard', () => {
  const request = makeHarness();

  beforeEach(() => {
    vi.clearAllMocks();
    isAdminSecretMock.mockReturnValue(true);
  });
  afterEach(() => vi.clearAllMocks());

  it('/generate 409s (not 500s) when a published challenge already exists for the date', async () => {
    getRunMock.mockResolvedValue(null);
    getPublishedMock.mockResolvedValue({ challengeId: 'daily-fritz:2026-12-01:r2:s1', status: 'live' });

    const res = await request('/api/daily-fritz/generate', GEN_BODY);

    expect(res.status).toBe(409);
    expect(publishMock).not.toHaveBeenCalled();
    expect(upsertRunMock).not.toHaveBeenCalled();
  });

  it('/generate still publishes when nothing exists for the date', async () => {
    getRunMock.mockResolvedValue(null);
    getPublishedMock.mockResolvedValue(null);
    upsertRunMock.mockImplementation(async (r) => r);
    publishMock.mockResolvedValue({ challengeId: 'x', contentDigest: 'd' });

    const res = await request('/api/daily-fritz/generate', GEN_BODY);

    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it('/invalidate reuses an existing published row instead of re-publishing it', async () => {
    getRunMock.mockResolvedValue({
      runDate: '2026-12-01', fritzTier: 'elite', dealSize: 7, winningScore: 60,
      seed: 's', status: 'live', handDeals: [], generatedAt: '2026-11-30T07:00:00.000Z',
      invalidatedAt: null, metadata: {},
    });
    getPublishedMock.mockResolvedValue({ challengeId: 'daily-fritz:2026-12-01:r2:s1', status: 'live' });
    invalidateMock.mockResolvedValue({ challengeId: 'daily-fritz:2026-12-01:r2:s1', status: 'invalidated' });

    const res = await request('/api/daily-fritz/invalidate', { run_date: '2026-12-01', reason: 'test' });

    expect(res.status).toBe(200);
    expect(publishMock).not.toHaveBeenCalled();
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });

  it('/invalidate materialises the row only when none exists yet', async () => {
    getRunMock.mockResolvedValue({
      runDate: '2026-12-01', fritzTier: 'elite', dealSize: 7, winningScore: 60,
      seed: 's', status: 'live', handDeals: [], generatedAt: '2026-11-30T07:00:00.000Z',
      invalidatedAt: null, metadata: {},
    });
    getPublishedMock.mockResolvedValue(null);
    publishMock.mockResolvedValue({ challengeId: 'x', contentDigest: 'd' });
    invalidateMock.mockResolvedValue({ challengeId: 'x', status: 'invalidated' });

    const res = await request('/api/daily-fritz/invalidate', { run_date: '2026-12-01', reason: 'test' });

    expect(res.status).toBe(200);
    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledTimes(1);
  });
});
