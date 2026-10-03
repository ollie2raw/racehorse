import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config')>();
  return {
    ...actual,
    config: { ...actual.config, supabaseUrl: 'https://example.supabase.co', supabaseServiceKey: 'service-key', supabasePoolerUrl: '' },
  };
});
import { buildResourceUsageLine } from './resourceUsageLog';
import { supabaseUsageCaller, takeSupabaseUsage, supabaseFetch } from '../../supabaseUtils';

describe('resource usage log', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('names callers by method and table or rpc, without the query string', () => {
    expect(supabaseUsageCaller('GET', '/rest/v1/scheduled_tournaments?select=*&limit=200')).toBe('GET scheduled_tournaments');
    expect(supabaseUsageCaller('POST', '/rest/v1/rpc/list_claimable_review_completion_jobs?select=id')).toBe('POST rpc/list_claimable_review_completion_jobs');
  });

  it('counts requests and bytes per caller in supabaseFetch, and resets on take', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[{"id":1}]', { status: 200, headers: { 'content-length': '10' } })));
    takeSupabaseUsage();
    await supabaseFetch('/rest/v1/profiles?select=id');
    await supabaseFetch('/rest/v1/profiles?select=id');
    const usage = takeSupabaseUsage();
    expect(usage.get('GET profiles')).toEqual({ requests: 2, bodyBytes: 20, wireBytes: 20 });
    expect(takeSupabaseUsage().size).toBe(0);
  });

  it('builds one line: totals, top callers by bytes, CPU % of one core, memory MB', () => {
    const usage = new Map([
      ['GET a', { requests: 10, bodyBytes: 100, wireBytes: 50 }],
      ['GET b', { requests: 1, bodyBytes: 5_000, wireBytes: 800 }],
    ]);
    const line = buildResourceUsageLine({
      windowMs: 3_600_000,
      usage,
      cpu: { user: 30_000_000, system: 6_000_000 },
      memory: { rss: 200 * 1048576, heapTotal: 0, heapUsed: 80 * 1048576, external: 4 * 1048576, arrayBuffers: 0 },
    });
    expect(line.supabase.total).toEqual({ requests: 11, bodyBytes: 5_100, wireBytes: 850 });
    expect(line.supabase.top[0]!.caller).toBe('GET b');
    expect(line.cpu).toEqual({ userMs: 30_000, systemMs: 6_000, percentOfOneCore: 1 });
    expect(line.memory).toEqual({ rssMb: 200, heapUsedMb: 80, externalMb: 4 });
  });
});
