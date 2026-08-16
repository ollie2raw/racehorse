import type { User } from '@supabase/supabase-js';

export const E2E_DEV_USER_ID_KEY = 'racehorse_e2e_user_id';
export const E2E_DEV_BEARER_KEY = 'racehorse_e2e_bearer';
export const E2E_DEV_BEARER_TOKEN = 'e2e-daily-fritz';

export function readE2eDevAuth(): { user: User; token: string } | null {
  if (typeof window === 'undefined') return null;
  if (!import.meta.env.DEV) return null;
  try {
    const userId = window.localStorage.getItem(E2E_DEV_USER_ID_KEY)?.trim();
    const token = window.localStorage.getItem(E2E_DEV_BEARER_KEY)?.trim();
    if (!userId || token !== E2E_DEV_BEARER_TOKEN) return null;
    return {
      token,
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'e2e-daily-fritz@racehorse.test',
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z',
      } as User,
    };
  } catch {
    return null;
  }
}
