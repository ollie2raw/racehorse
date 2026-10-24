import { afterAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Application } from 'express';

// The fence is exercised through a stubbed fetch, but supabaseFetch still needs a non-empty URL and key to build the request.
// Inert placeholders are enough (nothing leaves the process); declared here so the test never depends on an ambient server/.env.
// Must run before the config module is first imported (hoisted), like ratingCutoverGate.test.ts.
const restoreInertEnv = vi.hoisted(() => {
  const set: string[] = [];
  for (const [key, value] of [['SUPABASE_URL', 'http://127.0.0.1:54321'], ['SUPABASE_SERVICE_KEY', 'inert-test-service-key']] as const) {
    if (!process.env[key]) { process.env[key] = value; set.push(key); }
  }
  // Remove only what this file added, so it cannot mask a different test that wrongly relies on ambient env.
  return () => { for (const key of set) delete process.env[key]; };
});

import { handleFenceRequest, jsonResponse, newFenceStore } from '../../../test/support/cutoverFenceStub';
import { registerRankingRoutes, type RankingRouteDeps } from './ranking';
import { getRatingCutoverStatus, setRatingCutoverQuiesced, resetRatingCutoverGateForTests, setLegacyRatingWritersEnforcedForTests } from '../../ranking/ratingCutoverGate';
let store = newFenceStore();
beforeEach(() => { resetRatingCutoverGateForTests(); setLegacyRatingWritersEnforcedForTests(true); store = newFenceStore(); vi.stubGlobal('fetch', vi.fn(async (url, init) => handleFenceRequest(store, String(url), init) ?? jsonResponse([], 404))); });
afterEach(() => vi.unstubAllGlobals());
it('admin rating processing is rejected before work while closed, and counted until its admitted work settles', async () => {
  let route!: (req: unknown, res: unknown) => Promise<void>;
  const app = { get() {}, post(_path: string, callback: typeof route) { route = callback; } };
  let release!: () => void; let entered!: () => void;
  const observed = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const work = vi.fn(async () => { entered(); await held; return {}; });
  registerRankingRoutes(app as unknown as Application, { isAdminSecret: () => true, processRatingPeriod: work } as unknown as RankingRouteDeps);
  const request = { params: { userId: '11111111-1111-4111-8111-111111111111' }, get: () => 'local-only' };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
  const running = route(request, res); await observed;
  await setRatingCutoverQuiesced(true, null);
  expect(await getRatingCutoverStatus()).toMatchObject({ completionsInFlight: 1, readyForExpand: false });
  release(); await running; expect((await getRatingCutoverStatus()).readyForExpand).toBe(true);
  await route(request, res); expect(res.status).toHaveBeenCalledWith(503); expect(work).toHaveBeenCalledTimes(1);
});
afterAll(restoreInertEnv);
