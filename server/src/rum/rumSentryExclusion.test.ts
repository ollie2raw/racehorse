/**
 * Audit D5: Sentry tracing was excluded for `/api/rum` with a case-sensitive startsWith, but Express matches the route
 * case-insensitively, so POST /API/RUM was ingested AND traced (20% sample), and a transaction carries the caller's address,
 * which the privacy text says our application does not record with these measurements.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../logger', () => {
  const noop = () => undefined;
  const fake: Record<string, unknown> = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop };
  fake.child = () => fake;
  return { logger: fake, childLogger: () => fake };
});
vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn(async () => undefined) }));

import { registerRumRoutes } from './registerRumRoutes';
import { isRumRequest } from './isRumRequest';

const beacon = { v: 1, app: 'abc1234', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g', m: { inp: [1, 90, 90] } };

describe('every path form Express routes to the RUM handler is excluded from Sentry tracing', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base = '';
  beforeEach(() => {
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    registerRumRoutes(app, {});
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); });

  it.each(['/api/rum', '/API/RUM', '/Api/Rum', '/api/rum/', '/api/rum?x=1'])('%s: handled by the route AND excluded from tracing', async (p) => {
    const res = await fetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(beacon), headers: { 'content-type': 'text/plain;charset=UTF-8' } });
    expect(res.status).toBe(204); // the route ingested it, so the request is a RUM request ...
    expect(isRumRequest(p)).toBe(true); // ... and the Sentry predicate must agree
  });

  it('does not exclude look-alike paths', () => {
    for (const p of ['/api/rumble', '/api/other/rum', '/rum', '/api']) expect(isRumRequest(p)).toBe(false);
  });

  it('index.ts hands Sentry the shared predicate, not a case-sensitive startsWith', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/ignoreIncomingRequests: \(urlPath\) => isRumRequest\(urlPath\)/);
    expect(source).not.toMatch(/ignoreIncomingRequests:[^\n]*startsWith/);
  });
});
