import { describe, it, expect, vi, beforeEach } from 'vitest';

let currentUserId: string | null = 'user-0';
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: currentUserId ? { user: { id: currentUserId } } : null } }),
    },
  },
}));

const apiGet = vi.fn();
vi.mock('../api/client', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

import { fetchPublicProfile } from './socialApi';
import { clearCachedSession } from '../auth/sessionToken';

let n = 0;
beforeEach(() => {
  n += 1;
  currentUserId = `viewer-${n}`;
  clearCachedSession();
  apiGet.mockReset();
});

describe('fetchPublicProfile — P1-4 gate copy', () => {
  it('a 401 reads as a sign-in gate, never "session expired"', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'Sign in to continue.', errorCode: 'auth_required', status: 401 });
    const result = await fetchPublicProfile(`nobody-${n}`);
    expect(result.profile).toBeNull();
    expect(result.error).toBe('Sign in to view player profiles.');
    expect(result.error).not.toMatch(/session expired/i);
  });

  it('a 404 reads as a distinct not-found, naming the username', async () => {
    apiGet.mockResolvedValue({ data: null, error: 'Player not found.', status: 404 });
    const result = await fetchPublicProfile(`Ghostuser${n}`);
    expect(result.error).toContain(`ghostuser${n}`);
    expect(result.error).toMatch(/couldn.t find/i);
  });
});
