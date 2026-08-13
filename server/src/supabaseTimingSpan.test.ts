/**
 * Phase 3 item 3.1: supabaseFetch emits Sentry performance spans and timing logs.
 *
 * Confirms a slow/failing call produces a visible span — not just that the
 * wrapper code exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('./config', () => ({
  config: {
    supabaseUrl: 'https://test.supabase.co',
    supabasePoolerUrl: null,
    supabaseServiceKey: 'key',
  },
}));

vi.mock('@sentry/node', () => ({
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  withScope: vi.fn((fn: (scope: unknown) => void) => fn({ setTag: vi.fn(), setContext: vi.fn() })),
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import { supabaseFetch, resetCircuitBreaker } from './supabaseUtils';

const mockStartSpan = vi.mocked(Sentry.startSpan);

beforeEach(() => {
  resetCircuitBreaker();
  mockFetch.mockReset();
  mockStartSpan.mockClear();
});

describe('supabaseFetch Sentry span (item 3.1)', () => {
  it('calls Sentry.startSpan for every request', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' } as unknown as Response);
    await supabaseFetch('/rest/v1/profiles?limit=1');
    expect(mockStartSpan).toHaveBeenCalledOnce();
  });

  it('passes op=db.query and path attribute to the span', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '[]' } as unknown as Response);
    await supabaseFetch('/rest/v1/profiles?limit=1');
    const [spanOpts] = mockStartSpan.mock.calls[0] as [{ op: string; attributes: { path: string } }];
    expect(spanOpts.op).toBe('db.query');
    expect(spanOpts.attributes.path).toBe('/rest/v1/profiles?limit=1');
  });

  it('still calls startSpan even on a failing request', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'error' } as unknown as Response);
    await expect(supabaseFetch('/rest/v1/test')).rejects.toThrow('Supabase request failed');
    expect(mockStartSpan).toHaveBeenCalledOnce();
  });

  it('emits timing console.warn for slow calls (mocked via spy)', async () => {
    // Simulate a slow call by making startSpan invoke fn but we intercept console.warn
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Make fetch fail so the finally block logs it
    mockFetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'slow error' } as unknown as Response);
    await expect(supabaseFetch('/rest/v1/slow')).rejects.toThrow();
    // The finally block emits a warning when the call fails
    expect(warnSpy).toHaveBeenCalledWith(
      '[supabase] slow/failed query',
      expect.objectContaining({ path: '/rest/v1/slow', failed: true }),
    );
    warnSpy.mockRestore();
  });

  it('sets span name based on HTTP method', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, text: async () => '{}' } as unknown as Response);
    await supabaseFetch('/rest/v1/test', { method: 'POST', body: '{}' });
    const [spanOpts] = mockStartSpan.mock.calls[0] as [{ name: string }];
    expect(spanOpts.name).toBe('supabase.post');
  });
});
