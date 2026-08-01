import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: null }));
vi.mock('../lib/gameServerUrl', () => ({ resolveGameServerUrl: () => 'http://test' }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { apiGet, apiPost, getAuthHeaders } = await import('./client');

beforeEach(() => mockFetch.mockReset());

describe('getAuthHeaders', () => {
  it('omits auth header when no supabase session', async () => {
    const { headers } = await getAuthHeaders();
    expect(headers['Authorization']).toBeUndefined();
  });

  it('includes Content-Type by default', async () => {
    const { headers } = await getAuthHeaders();
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('apiGet', () => {
  it('calls fetch with resolved server url', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await apiGet('/api/test', { auth: false });
    expect(mockFetch.mock.calls[0][0]).toBe('http://test/api/test');
  });

  it('returns error on non-ok response without throwing', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));
    const result = await apiGet('/api/test', { auth: false });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
    expect(result.status).toBe(401);
  });

  it('returns network error without throwing', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await apiGet('/api/test', { auth: false });
    expect(result.data).toBeNull();
    expect(result.error).toBe('Network error');
  });
});

describe('apiPost request correlation', () => {
  it('forwards caller-provided headers without dropping JSON headers', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await apiPost('/api/daily-fritz/next-hand', { attempt_id: 'a' }, {
      headers: { 'x-racehorse-request-id': 'request-1' },
    });

    expect(mockFetch.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'x-racehorse-request-id': 'request-1',
    });
  });
});
