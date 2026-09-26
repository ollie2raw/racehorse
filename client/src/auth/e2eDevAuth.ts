import type { User } from '@supabase/supabase-js';

export const E2E_DEV_USER_ID_KEY = 'racehorse_e2e_user_id';
export const E2E_DEV_BEARER_KEY = 'racehorse_e2e_bearer';
export const E2E_DEV_BEARER_TOKEN = 'e2e-daily-fritz';
export const MOBILE_VISUAL_IDENTITY_KEY = 'racehorse_mobile_visual_identity_v1';

export type MobileVisualIdentity = {
  userId: string;
  username: string;
  rating: number;
  friends: Array<{ id: string; userId: string; username: string; online: boolean }>;
};

/** Data only for the existing dev E2E principal; no alternate auth path. */
export function readMobileVisualIdentity(userId: string): MobileVisualIdentity | null {
  if (!import.meta.env.DEV || import.meta.env.PROD || typeof window === 'undefined') return null;
  if (readE2eDevAuth()?.user.id !== userId) return null;
  try {
    const raw = window.localStorage.getItem(MOBILE_VISUAL_IDENTITY_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const identity = value as Partial<MobileVisualIdentity>;
    if (identity.userId !== userId || typeof identity.username !== 'string' ||
      !/^[a-z0-9_]{3,32}$/.test(identity.username) ||
      typeof identity.rating !== 'number' || !Number.isFinite(identity.rating) ||
      !Array.isArray(identity.friends) ||
      !identity.friends.every((friend) => friend && typeof friend.id === 'string' &&
        typeof friend.userId === 'string' && typeof friend.username === 'string' &&
        typeof friend.online === 'boolean')) return null;
    return identity as MobileVisualIdentity;
  } catch {
    return null;
  }
}

export function readE2eDevAuth(): { user: User; token: string } | null {
  if (typeof window === 'undefined') return null;
  if (!import.meta.env.DEV || import.meta.env.PROD) return null;
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
