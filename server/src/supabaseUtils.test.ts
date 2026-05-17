import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('supabaseFetch', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_KEY', 'service-key');
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('times out hung Supabase requests', async () => {
    const { supabaseFetch } = await import('./supabaseUtils');
    await expect(supabaseFetch('/rest/v1/profiles?limit=1', { timeoutMs: 30 })).rejects.toThrow(
      /timed out after 30ms/,
    );
  });

  it('classifies timeout errors', async () => {
    const { isSupabaseTimeoutError } = await import('./supabaseUtils');
    expect(isSupabaseTimeoutError(new Error('Supabase request timed out after 15000ms: /rest/v1/x'))).toBe(
      true,
    );
    expect(isSupabaseTimeoutError(new Error('other'))).toBe(false);
  });
});
