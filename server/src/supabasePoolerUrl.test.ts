/**
 * Phase 3 item 3.3: SUPABASE_POOLER_URL routes supabaseFetch through the pooler.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@sentry/node', () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  withScope: vi.fn((fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setContext: vi.fn() })),
  captureException: vi.fn(),
}));

// We need to test with pooler URL set — use module isolation via vi.doMock in tests
describe('SUPABASE_POOLER_URL routing (item 3.3)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' } as unknown as Response);
  });

  it('uses SUPABASE_URL when SUPABASE_POOLER_URL is not set', async () => {
    vi.doMock('./config', () => ({
      config: { supabaseUrl: 'https://orig.supabase.co', supabasePoolerUrl: null, supabaseServiceKey: 'k' },
    }));
    const { supabaseFetch, resetCircuitBreaker } = await import('./supabaseUtils?v=no-pooler');
    resetCircuitBreaker();
    await supabaseFetch('/rest/v1/test');
    const [calledUrl] = mockFetch.mock.calls[0] as [URL];
    expect(calledUrl.origin).toBe('https://orig.supabase.co');
    vi.doUnmock('./config');
  });

  it('uses SUPABASE_POOLER_URL when set, overriding SUPABASE_URL', async () => {
    vi.doMock('./config', () => ({
      config: {
        supabaseUrl: 'https://orig.supabase.co',
        supabasePoolerUrl: 'https://pooler.supabase.com',
        supabaseServiceKey: 'k',
      },
    }));
    const { supabaseFetch, resetCircuitBreaker } = await import('./supabaseUtils?v=with-pooler');
    resetCircuitBreaker();
    await supabaseFetch('/rest/v1/test');
    const [calledUrl] = mockFetch.mock.calls[0] as [URL];
    expect(calledUrl.origin).toBe('https://pooler.supabase.com');
    vi.doUnmock('./config');
  });
});
