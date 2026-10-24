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

  it.each([200, 503])('keeps the deadline active while a %s response body stalls', async (status) => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return {
        ok: status === 200,
        status,
        text: () => new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
      } as Response;
    }));
    const { supabaseFetch } = await import('./supabaseUtils');
    await expect(supabaseFetch('/rest/v1/ranked_games', { timeoutMs: 30 })).rejects.toThrow('timed out after 30ms');
    expect(signal?.aborted).toBe(true);
    // An expired call must not hold a scheduler forever; the next call can succeed.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')));
    expect(await supabaseFetch('/rest/v1/ranked_games', { timeoutMs: 30 })).toEqual([]);
  });

  it('releases the body deadline after a successful response', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response('[{"id":"ok"}]');
    }));
    const { supabaseFetch } = await import('./supabaseUtils');
    expect(await supabaseFetch('/rest/v1/profiles', { timeoutMs: 30 })).toEqual([{ id: 'ok' }]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signal?.aborted).toBe(false);
  });

  it('classifies timeout errors', async () => {
    const { isSupabaseTimeoutError } = await import('./supabaseUtils');
    expect(isSupabaseTimeoutError(new Error('Supabase request timed out after 15000ms: /rest/v1/x'))).toBe(
      true,
    );
    expect(isSupabaseTimeoutError(new Error('other'))).toBe(false);
  });
});
