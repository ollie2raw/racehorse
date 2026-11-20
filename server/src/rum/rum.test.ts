import express from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logCalls = vi.hoisted(() => ({ all: [] as unknown[][] }));
vi.mock('../logger', () => {
  const record = (...args: unknown[]) => { logCalls.all.push(args); };
  const fake: Record<string, unknown> = { info: record, warn: record, error: record, debug: record, trace: record, fatal: record };
  fake.child = () => fake;
  return { logger: fake, childLogger: () => fake };
});
const fetchMock = vi.hoisted(() => ({ calls: [] as Array<{ path: string; init?: RequestInit }>, fail: false }));
vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    fetchMock.calls.push({ path, init });
    if (fetchMock.fail) throw new Error('boom');
    return undefined;
  }),
}));
vi.mock('../platform/processLifecycle', () => ({ processInterval: vi.fn() }));

import { MIN_GROUP_REPORTS, RUM_METRICS, RumAggregator, parseBeacon, type RumBeacon } from './rumAggregator';
import { appendRows, publishDueHours, resetRumHourlyForTests, runRetention, RUM_RETENTION_MS } from './rumHourly';
import { registerRumRoutes } from './registerRumRoutes';
import { aggregator } from './rumHourly';

const beacon = (over: Partial<RumBeacon> = {}, m: RumBeacon['m'] = { 'nav.start_to_match.pvf': [1, 200, 260], inp: [1, 90, 90] }): RumBeacon => ({
  v: 1, app: 'abc1234', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g', m, ...over,
});

describe('parseBeacon', () => {
  it('accepts the documented shape and returns only known fields', () => {
    const parsed = parseBeacon(beacon());
    expect(parsed).toEqual(beacon());
  });

  it.each([
    ['an unknown top-level key (could carry an identifier)', { ...beacon(), uid: 'x' }],
    ['a wrong version', { ...beacon(), v: 2 }],
    ['an unknown metric', beacon({}, { 'nav.other': [1, 1, 1] } as never)],
    ['a metric with the wrong shape', { ...beacon(), m: { inp: [1, 2] } }],
    ['a non-integer', { ...beacon(), m: { inp: [1, 2.5, 3] } }],
    ['a median above the max', { ...beacon(), m: { inp: [1, 500, 100] } }],
    ['a time over ten minutes', { ...beacon(), m: { inp: [1, 700_000, 700_000] } }],
    ['a negative time', { ...beacon(), m: { inp: [1, -1, 5] } }],
    ['no metrics', { ...beacon(), m: {} }],
    ['an unknown platform', { ...beacon(), plat: 'tv' }],
    ['an app id with spaces', { ...beacon(), app: 'a b' }],
    ['an array', []],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(parseBeacon(value)).toBeNull();
  });
});

describe('RumAggregator', () => {
  let nowMs = Date.UTC(2026, 10, 16, 10, 5);
  const fresh = () => new RumAggregator(() => nowMs);
  beforeEach(() => { nowMs = Date.UTC(2026, 10, 16, 10, 5); });

  it('publishes nothing until the hour has ended', () => {
    const agg = fresh();
    for (let i = 0; i < 6; i += 1) agg.ingest(beacon());
    expect(agg.rollover()).toEqual([]);
  });

  it(`publishes a group with ${MIN_GROUP_REPORTS} or more summaries, with bucketed percentiles`, () => {
    const agg = fresh();
    for (const ms of [100, 100, 100, 100, 300, 300]) agg.ingest(beacon({}, { 'nav.start_to_match.pvf': [1, ms, ms] }));
    nowMs += 3_600_000;
    const [hour] = agg.rollover();
    expect(hour!.hour).toBe('2026-11-16T10:00:00.000Z');
    const all = hour!.rows.find((r) => r.group === 'all' && r.metric === 'nav.start_to_match.pvf')!;
    expect(all).toMatchObject({ reports: 6, n: 6, p50: 100, max: 300 });
    expect(all.p95).toBe(300);
    expect(hour!.rows.map((r) => r.group)).toEqual(expect.arrayContaining(['plat:web', 'form:phone', 'scr:s', 'mem:4', 'net:4g']));
  });

  it('folds groups under the minimum into "other" for their dimension, and never publishes them alone', () => {
    const agg = fresh();
    for (let i = 0; i < 6; i += 1) agg.ingest(beacon({ plat: 'web', form: 'desktop' }));
    // three iOS phones and two Android phones: each platform is under 5, together they make 5
    for (let i = 0; i < 3; i += 1) agg.ingest(beacon({ plat: 'ios', form: 'phone' }));
    for (let i = 0; i < 2; i += 1) agg.ingest(beacon({ plat: 'android', form: 'phone' }));
    nowMs += 3_600_000;
    const [hour] = agg.rollover();
    const groups = new Set(hour!.rows.map((r) => r.group));
    expect(groups.has('plat:ios')).toBe(false);
    expect(groups.has('plat:android')).toBe(false);
    expect(groups.has('other:plat')).toBe(true);
    expect(groups.has('plat:web')).toBe(true);
    expect(hour!.rows.find((r) => r.group === 'other:plat')!.reports).toBe(5);
    for (const row of hour!.rows) expect(row.reports).toBeGreaterThanOrEqual(1);
  });

  it('publishes no row at all when the whole hour is under the minimum, and carries it into the next hour', () => {
    const agg = fresh();
    for (let i = 0; i < 3; i += 1) agg.ingest(beacon());
    nowMs += 3_600_000;
    const [first] = agg.rollover();
    expect(first!.rows).toEqual([]);
    expect(first!.withheldGroups).toBeGreaterThan(0);
    for (let i = 0; i < 2; i += 1) agg.ingest(beacon());
    nowMs += 3_600_000;
    const [second] = agg.rollover();
    expect(second!.rows.find((r) => r.group === 'all')!.reports).toBe(5);
  });

  it('every published row describes at least the minimum number of summaries, so a rarely reported metric is withheld', () => {
    const agg = fresh();
    const plats = ['web', 'web', 'web', 'ios', 'android', 'web', 'web', 'ios'] as const;
    plats.forEach((plat, i) => agg.ingest(beacon({ plat }, { inp: [2, 80, 120], ...(i < 3 ? { 'mp.hand_ready_ack': [1, 300, 300] as [number, number, number] } : {}) })));
    nowMs += 3_600_000;
    const [hour] = agg.rollover();
    expect(hour!.rows.length).toBeGreaterThan(0);
    for (const row of hour!.rows) expect(row.reports).toBeGreaterThanOrEqual(MIN_GROUP_REPORTS);
    // 8 summaries reported inp; only 3 reported hand_ready_ack: that metric must not appear anywhere
    expect(hour!.rows.some((r) => r.metric === 'mp.hand_ready_ack')).toBe(false);
    expect(hour!.rows.some((r) => r.metric === 'inp' && r.group === 'all')).toBe(true);
  });

  it('keeps no individual summary: the aggregator holds only histograms', () => {
    const agg = fresh();
    agg.ingest(beacon({ app: 'secretapp1' }));
    const dump = JSON.stringify(agg, (_k, v) => (v instanceof Map ? Object.fromEntries(v) : v));
    expect(dump).not.toContain('secretapp1');
    expect(dump).not.toContain('abc1234');
  });
});

describe('the hourly publisher', () => {
  let nowMs = Date.UTC(2026, 10, 16, 10, 5);
  beforeEach(() => {
    nowMs = Date.UTC(2026, 10, 16, 10, 5);
    logCalls.all.length = 0; fetchMock.calls.length = 0; fetchMock.fail = false;
    delete process.env.RUM_SUPABASE_APPEND_ENABLED;
    resetRumHourlyForTests();
  });
  afterEach(() => { delete process.env.RUM_SUPABASE_APPEND_ENABLED; });

  const filled = () => {
    const agg = new RumAggregator(() => nowMs);
    for (let i = 0; i < 6; i += 1) agg.ingest(beacon());
    nowMs += 3_600_000;
    return agg;
  };

  it('writes one log line per hour and touches no database by default', async () => {
    const published = await publishDueHours(filled(), nowMs);
    expect(published).toHaveLength(1);
    const lines = logCalls.all.filter((args) => args[1] === 'rum hourly summary');
    expect(lines).toHaveLength(1);
    expect(fetchMock.calls).toEqual([]);
  });

  it('appends rows (merge-duplicates, no identifier column) only when RUM_SUPABASE_APPEND_ENABLED=true', async () => {
    process.env.RUM_SUPABASE_APPEND_ENABLED = 'true';
    await publishDueHours(filled(), nowMs);
    const post = fetchMock.calls.find((c) => c.init?.method === 'POST')!;
    expect(post.path).toContain('/rest/v1/rum_hourly');
    const rows = JSON.parse(String(post.init!.body)) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]!).sort()).toEqual(['grp', 'hour', 'max', 'metric', 'n', 'p50', 'p75', 'p95', 'reports']);
    expect(rows.every((r) => (r.reports as number) >= MIN_GROUP_REPORTS)).toBe(true);
  });

  it('a failed append is a warning, not an error to the caller', async () => {
    process.env.RUM_SUPABASE_APPEND_ENABLED = 'true';
    fetchMock.fail = true;
    await expect(publishDueHours(filled(), nowMs)).resolves.toHaveLength(1);
    expect(logCalls.all.some((args) => args[1] === 'rum_hourly append failed (the totals are in the log line)')).toBe(true);
  });

  it('deletes rows older than 12 months, once a day, only when the append is on', async () => {
    await runRetention(nowMs);
    expect(fetchMock.calls).toEqual([]);
    process.env.RUM_SUPABASE_APPEND_ENABLED = 'true';
    await runRetention(nowMs);
    const del = fetchMock.calls.find((c) => c.init?.method === 'DELETE')!;
    expect(del.path).toContain('/rest/v1/rum_hourly?hour=lt.');
    expect(decodeURIComponent(del.path)).toContain(new Date(nowMs - RUM_RETENTION_MS).toISOString());
    expect(RUM_RETENTION_MS).toBe(365 * 24 * 3_600_000);
    await runRetention(nowMs + 3_600_000);
    expect(fetchMock.calls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(1); // not again within the day
    await runRetention(nowMs + 24 * 3_600_000);
    expect(fetchMock.calls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(2);
  });

  it('keeps deleting expired rows after the append is switched off when RUM_RETENTION_ENABLED=true', async () => {
    delete process.env.RUM_SUPABASE_APPEND_ENABLED;
    process.env.RUM_RETENTION_ENABLED = 'true';
    try {
      await runRetention(nowMs);
      expect(fetchMock.calls.filter((c) => c.init?.method === 'DELETE')).toHaveLength(1);
      await publishDueHours(filled(), nowMs + 25 * 3_600_000);
      expect(fetchMock.calls.filter((c) => c.init?.method === 'POST')).toEqual([]); // still no append
    } finally {
      delete process.env.RUM_RETENTION_ENABLED;
    }
  });

  it('appendRows does nothing for an hour with no rows', async () => {
    process.env.RUM_SUPABASE_APPEND_ENABLED = 'true';
    await appendRows({ hour: '2026-11-16T10:00:00.000Z', rows: [], reports: 2, withheldGroups: 1 });
    expect(fetchMock.calls).toEqual([]);
  });
});

describe('the routes', () => {
  let server: ReturnType<ReturnType<typeof express>['listen']>;
  let base = '';
  beforeEach(async () => {
    logCalls.all.length = 0;
    delete process.env.RUM_SUMMARY_TOKEN; delete process.env.RUM_INGEST_ENABLED;
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    registerRumRoutes(app);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); delete process.env.RUM_SUMMARY_TOKEN; delete process.env.RUM_INGEST_ENABLED; });

  const post = (body: string, headers: Record<string, string> = { 'content-type': 'text/plain;charset=UTF-8' }) => fetch(`${base}/api/rum`, { method: 'POST', body, headers });

  it('takes a text/plain beacon (no CORS preflight needed) with 204 and keeps nothing but totals', async () => {
    const before = aggregator.ingested;
    const res = await post(JSON.stringify(beacon()));
    expect(res.status).toBe(204);
    expect(aggregator.ingested).toBe(before + 1);
  });

  it('answers 400 to anything off-schema, 413 to a large body, without logging', async () => {
    expect((await post('{"v":1}')).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ ...beacon(), uid: 'x' }))).status).toBe(400);
    expect((await post('x'.repeat(5000))).status).toBe(413);
    expect(logCalls.all).toEqual([]);
  });

  it('never logs a request: no line mentions an address, a user agent, or the body', async () => {
    await post(JSON.stringify(beacon()), { 'content-type': 'text/plain', 'user-agent': 'TestAgent/9.9', 'x-forwarded-for': '203.0.113.7' });
    await post('garbage', { 'content-type': 'text/plain', 'user-agent': 'TestAgent/9.9' });
    expect(JSON.stringify(logCalls.all)).not.toMatch(/TestAgent|203\.0\.113|127\.0\.0\.1|nav\.start_to_match/);
    expect(logCalls.all).toEqual([]);
  });

  it('drops summaries and still answers 204 when RUM_INGEST_ENABLED=false', async () => {
    process.env.RUM_INGEST_ENABLED = 'false';
    const before = aggregator.ingested;
    expect((await post(JSON.stringify(beacon()))).status).toBe(204);
    expect(aggregator.ingested).toBe(before);
  });

  it('the summary is 404 without a configured token, 401 with a wrong one, and the totals with the right one', async () => {
    expect((await fetch(`${base}/api/rum/summary`)).status).toBe(404);
    process.env.RUM_SUMMARY_TOKEN = 'correct-horse-battery';
    expect((await fetch(`${base}/api/rum/summary`)).status).toBe(401);
    expect((await fetch(`${base}/api/rum/summary`, { headers: { authorization: 'Bearer wrong-horse-battery!' } })).status).toBe(401);
    const ok = await fetch(`${base}/api/rum/summary`, { headers: { authorization: 'Bearer correct-horse-battery' } });
    expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json())).toEqual(['current', 'published']);
  });
});

describe('the privacy claims that live outside the route', () => {
  it('the server does not trace POST /api/rum (a transaction would carry the request address)', () => {
    const index = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
    // isRumRequest is case-insensitive like Express routing (audit D5; see rumSentryExclusion.test.ts).
    expect(index).toMatch(/ignoreIncomingRequests:\s*\(urlPath\)\s*=>\s*isRumRequest\(urlPath\)/);
  });
  it('nothing in src/rum reads the request address, user agent or cookies, or logs a request', () => {
    for (const file of ['registerRumRoutes.ts', 'rumAggregator.ts', 'rumHourly.ts']) {
      const text = readFileSync(resolve(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(text, file).not.toMatch(/req\.ip|req\.ips|remoteAddress|x-forwarded-for|user-agent|req\.headers|req\.cookies|req\.get\((?!'authorization')/i);
    }
    const routes = readFileSync(resolve(__dirname, 'registerRumRoutes.ts'), 'utf8');
    expect(routes).not.toMatch(/log\.|console\.|childLogger/);
  });
});

describe('the metric list', () => {
  it('is the documented list', () => {
    expect([...RUM_METRICS]).toEqual([
      'nav.home_to_hub', 'nav.hub_to_setup', 'nav.start_to_match.pvf', 'nav.start_to_match.daily', 'nav.private_to_room.mp',
      'match.first_playable.pvf', 'match.first_playable.daily', 'match.first_playable.mp',
      'hand.end_to_playable.solo', 'hand.end_to_playable.mp', 'mp.hand_ready_ack', 'mp.room_join_ack', 'inp',
    ]);
  });
});
