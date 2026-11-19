/**
 * AUDIT 2026-11-17 (docs/audit-parts/D-rum.md): reproductions for the RUM beacon (#525). `it.fails` = asserts the behavior the
 * privacy text / PR description promises, and today's code does not do it (suite stays green; flip to `it` once fixed).
 * Plain `it` = documents current behavior that an audit finding relies on.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logCalls = vi.hoisted(() => ({ all: [] as unknown[][] }));
vi.mock('../logger', () => {
  const record = (...args: unknown[]) => { logCalls.all.push(args); };
  const fake: Record<string, unknown> = { info: record, warn: record, error: record, debug: record, trace: record, fatal: record };
  fake.child = () => fake;
  return { logger: fake, childLogger: () => fake };
});
vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn(async () => undefined) }));

import { RumAggregator, type RumBeacon } from './rumAggregator';
import { registerRumRoutes } from './registerRumRoutes';
import { aggregator } from './rumHourly';
import { InMemoryRateLimiter, createRateLimitMiddleware } from '../rateLimit';

const beacon = (over: Partial<RumBeacon> = {}, m: RumBeacon['m'] = { inp: [1, 90, 90] }): RumBeacon => ({
  v: 1, app: 'abc1234', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g', m, ...over,
});

describe('AUDIT D1: the rate limiter in front of POST /api/rum logs the client address when it trips', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base = '';
  beforeEach(async () => {
    logCalls.all.length = 0;
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json({ limit: '2mb' }));
    // Wired exactly as index.ts:438 + :893 (the PR's own route tests mount the route WITHOUT the limiter).
    const limiter = new InMemoryRateLimiter({ windowMs: 5 * 60_000, max: 600 });
    registerRumRoutes(app, { ingest: createRateLimitMiddleware(limiter, { windowMs: 10 * 60_000, max: 30 }, 'rest:rum') });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); });

  it.fails('"our application does not record that address with these measurements": no log line carries the address of a RUM request', async () => {
    for (let i = 0; i < 31; i += 1) {
      await fetch(`${base}/api/rum`, {
        method: 'POST',
        body: JSON.stringify(beacon()),
        headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-forwarded-for': '203.0.113.7' },
      });
    }
    // Today: request 31 gets a 429 and rateLimit.ts:140 logs { scope: 'rest:rum', key: 'rest:rum:ip:203.0.113.7', keyIp, reqIp, peer, xffRaw }.
    expect(JSON.stringify(logCalls.all)).not.toMatch(/203\.0\.113\.7/);
  });
});

describe('AUDIT D2: InMemoryRateLimiter never evicts expired buckets (IP-keyed entries live for the process lifetime)', () => {
  it('buckets for addresses that never return are kept after their window ends', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1_000, max: 30 });
    for (let i = 0; i < 10_000; i += 1) limiter.take(`rest:rum:ip:2001:db8::${i.toString(16)}`, { windowMs: 1_000, max: 30 }, 0);
    // One more request a day later from a new address: nothing sweeps the 10,000 expired entries.
    limiter.take('rest:rum:ip:2001:db8::ffff:1', { windowMs: 1_000, max: 30 }, 86_400_000);
    expect((limiter as unknown as { buckets: Map<string, unknown> }).buckets.size).toBe(10_001);
  });
});

describe('AUDIT D3: the five-summary floor can be undone by differencing two published rows', () => {
  it.fails('a withheld group (1 iOS summary) leaves no exact trace in the published totals', () => {
    let nowMs = Date.UTC(2026, 10, 16, 10, 5);
    const agg = new RumAggregator(() => nowMs);
    for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'web' }, { inp: [1, 90, 120] }));
    // The only iOS visitor this hour, with a distinctive slowest tap.
    agg.ingest(beacon({ plat: 'ios' }, { inp: [1, 90, 4321] }));
    nowMs += 3_600_000;
    const [hour] = agg.rollover();
    const row = (group: string) => hour!.rows.find((r) => r.group === group && r.metric === 'inp');
    expect(row('plat:ios')).toBeUndefined(); // the floor holds for the group's own row...
    const all = row('all')!;
    const web = row('plat:web')!;
    // ...but 'all' minus 'plat:web' gives the iOS group's report count (1) and 'all'.max is that single summary's exact max.
    const leaked = all.reports - web.reports === 1 && all.max === 4321;
    expect(leaked).toBe(false);
  });
});

describe('AUDIT D4: the 2 KB body cap does not hold for an application/json body (the global express.json runs first)', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base = '';
  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: '2mb' })); // index.ts:385, registered before the RUM route
    registerRumRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); });

  it.fails('a 1 MB body is refused as too large (413), as the PR says', async () => {
    const big = JSON.stringify({ pad: 'x'.repeat(1_000_000) });
    const res = await fetch(`${base}/api/rum`, { method: 'POST', body: big, headers: { 'content-type': 'application/json' } });
    // Today: the global parser reads and parses the whole 1 MB, the route then sees a non-string body and answers 400.
    expect(res.status).toBe(413);
  });

  it('a VALID beacon sent as application/json is rejected 400 (only text/plain bodies are ever read)', async () => {
    const res = await fetch(`${base}/api/rum`, { method: 'POST', body: JSON.stringify(beacon()), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(400);
  });
});

describe('AUDIT D5: Express routes are case-insensitive, the Sentry tracing exclusion is not', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base = '';
  beforeEach(async () => {
    const app = express();
    registerRumRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); });

  it('POST /API/RUM is ingested, but the predicate copied from index.ts:23 would trace it', async () => {
    const ignore = (urlPath: string) => urlPath.startsWith('/api/rum'); // verbatim from index.ts:23
    const before = aggregator.preview().reports;
    const res = await fetch(`${base}/API/RUM`, { method: 'POST', body: JSON.stringify(beacon()), headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(204);
    expect(aggregator.preview().reports).toBe(before + 1);
    expect(ignore('/API/RUM')).toBe(false);
  });
});
