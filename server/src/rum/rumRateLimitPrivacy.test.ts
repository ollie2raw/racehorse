/**
 * Privacy contract for POST /api/rum (legalContent: "our application does not record that address with these measurements",
 * "briefly, in memory"): the rate limiter in front of the route must not write the caller's address to the logs when it
 * trips, and must not hold addresses past their window. Regression tests for audit findings D1 and D2
 * (docs/audit-parts/D-rum.md); the audit's own repros skipped the limiter or pinned the bug.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
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

import { registerRumRoutes } from './registerRumRoutes';
import { isRumRequest } from './isRumRequest';
import { InMemoryRateLimiter, createRateLimitMiddleware } from '../rateLimit';

const ADDRESS = '203.0.113.7';
const beacon = () => ({ v: 1, app: 'abc1234', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g', m: { inp: [1, 90, 90] } });

async function hammer(base: string, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await fetch(`${base}/api/rum`, {
      method: 'POST',
      body: JSON.stringify(beacon()),
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-forwarded-for': ADDRESS },
    });
    statuses.push(res.status);
  }
  return statuses;
}

describe('D1: tripping a limiter on POST /api/rum never logs the caller address', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base = '';
  const mount = (opts: { ingest: boolean; apiLimiter: boolean }) => {
    const app = express();
    app.set('trust proxy', 'loopback');
    app.use(express.json({ limit: '2mb' }));
    const limiter = new InMemoryRateLimiter({ windowMs: 5 * 60_000, max: 600 });
    // As index.ts wires it: the global /api limiter sees every /api request first (rate-limited at 5 here), then the route's own.
    if (opts.apiLimiter) {
      app.use('/api', createRateLimitMiddleware(limiter, { windowMs: 5 * 60_000, max: 5 }, 'rest:api', undefined, {
        logClientAddress: (req) => !isRumRequest(req.originalUrl),
      }));
    }
    registerRumRoutes(app, {
      ingest: createRateLimitMiddleware(limiter, { windowMs: 10 * 60_000, max: opts.apiLimiter ? 1000 : 5 }, 'rest:rum', undefined, { logClientAddress: false }),
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  beforeEach(() => { logCalls.all.length = 0; });
  afterEach(() => { server.close(); });

  it('the route limiter (rest:rum) logs the scope only', async () => {
    mount({ ingest: true, apiLimiter: false });
    const statuses = await hammer(base, 8);
    expect(statuses).toContain(429);
    expect(logCalls.all.some((args) => JSON.stringify(args).includes('rest:rum'))).toBe(true);
    expect(JSON.stringify(logCalls.all)).not.toContain(ADDRESS);
  });

  it('the global /api limiter (rest:api) also logs no address when the request is a RUM beacon', async () => {
    mount({ ingest: true, apiLimiter: true });
    const statuses = await hammer(base, 8);
    expect(statuses).toContain(429);
    expect(JSON.stringify(logCalls.all)).not.toContain(ADDRESS);
  });

  it('other routes keep the AU-3 verification line (address logged) by default', async () => {
    const app = express();
    app.set('trust proxy', 'loopback');
    const limiter = new InMemoryRateLimiter({ windowMs: 60_000, max: 600 });
    app.get('/api/other', createRateLimitMiddleware(limiter, { windowMs: 60_000, max: 1 }, 'rest:other'), (_req, res) => { res.json({ ok: true }); });
    server = app.listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/other`;
    await fetch(url, { headers: { 'x-forwarded-for': ADDRESS } });
    const second = await fetch(url, { headers: { 'x-forwarded-for': ADDRESS } });
    expect(second.status).toBe(429);
    expect(JSON.stringify(logCalls.all)).toContain(ADDRESS);
  });

  it('index.ts wires both RUM limiters quiet, and the global /api limiter skips RUM requests', () => {
    // index.ts cannot be imported in a unit test (it boots the server); this pins the wiring text instead.
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/'rest:rum', undefined, \{ logClientAddress: false \}/);
    expect(source).toMatch(/'rest:rum-summary', undefined, \{ logClientAddress: false \}/);
    expect(source).toMatch(/'rest:api', undefined, \{\s*logClientAddress: \(req\) => !isRumRequest\(req\.originalUrl\)/);
  });
});

describe('isRumRequest', () => {
  it.each([
    ['/api/rum', true],
    ['/API/RUM', true],
    ['/api/rum?x=1', true],
    ['/api/rum/summary', true],
    ['/api/rumble', false],
    ['/api/other/rum', false],
    ['/rum', false],
  ])('%s -> %s', (url, expected) => {
    expect(isRumRequest(url)).toBe(expected);
  });
});

describe('D2: InMemoryRateLimiter holds an address only while its window is open (bounded memory)', () => {
  it('sweeps expired buckets: 10 000 one-off addresses are gone a window later', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1_000, max: 30 });
    for (let i = 0; i < 10_000; i += 1) limiter.take(`rest:rum:ip:2001:db8::${i.toString(16)}`, { windowMs: 1_000, max: 30 }, 0);
    expect(limiter.size).toBe(10_000);
    limiter.take('rest:rum:ip:198.51.100.1', { windowMs: 1_000, max: 30 }, 86_400_000);
    expect(limiter.size).toBe(1);
  });

  it('does not sweep more often than the interval (a busy limiter stays O(1) per call)', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 1_000, max: 30 }, { sweepIntervalMs: 60_000 });
    limiter.take('a', undefined, 0);
    limiter.take('b', undefined, 5_000); // 'a' expired at 1 000 but the next sweep is not due until 60 000
    expect(limiter.size).toBe(2);
    limiter.take('c', undefined, 60_000);
    expect(limiter.size).toBe(1);
  });

  it('caps the number of live buckets when keys rotate inside one window', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 600_000, max: 30 }, { maxKeys: 1_000 });
    for (let i = 0; i < 50_000; i += 1) limiter.take(`k${i}`, undefined, 1);
    expect(limiter.size).toBeLessThanOrEqual(1_000);
  });

  it('never blocks anyone by evicting: a dropped bucket just starts a fresh count', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 600_000, max: 2 }, { maxKeys: 10 });
    for (let i = 0; i < 100; i += 1) expect(limiter.take(`k${i}`, undefined, 1).allowed).toBe(true);
  });

  it('still limits a key inside its window while others are swept', () => {
    const limiter = new InMemoryRateLimiter({ windowMs: 10_000, max: 2 });
    expect(limiter.take('x', undefined, 0).allowed).toBe(true);
    expect(limiter.take('x', undefined, 5_000).allowed).toBe(true);
    expect(limiter.take('x', undefined, 6_000).allowed).toBe(false);
  });
});
