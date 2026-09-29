import { Preferences } from '@capacitor/preferences';
import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Supabase session storage backed by Capacitor Preferences (UserDefaults on iOS,
 * SharedPreferences) instead of localStorage. Only used inside the native
 * shell: iOS WebKit's storage for a plain web context (including "Add to
 * Home Screen" standalone mode) is not guaranteed durable across relaunches,
 * and there is no service worker protecting it — Preferences persists
 * outside that container.
 */
export const capacitorAuthStorage: SupportedStorage = {
  async getItem(key: string) {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async setItem(key: string, value: string) {
    await Preferences.set({ key, value });
  },
  async removeItem(key: string) {
    await Preferences.remove({ key });
  },
};
