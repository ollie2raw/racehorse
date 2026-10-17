import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { SupportedStorage } from '@supabase/supabase-js';

/**
 * Supabase session storage for the native iOS shell: the iOS Keychain (see packages/capacitor-keychain-storage).
 *
 * Everything the auth client persists is credential-bearing (the session JSON with access + refresh token, the PKCE
 * code verifier, the optional separate user object), so ALL of it lives in the Keychain. It used to live in Capacitor
 * Preferences (UserDefaults: plaintext plist, included in device backups). Existing installs are migrated lazily, once.
 *
 * Invariants:
 * - The Keychain is the only authority. Legacy Preferences is read only to migrate, and for a key whose migration failed.
 * - A legacy value is deleted only after the secure copy has been written AND read back identical, so a failed write can
 *   never destroy the only valid session. A newer secure value always wins over a stale legacy one.
 * - Nothing here logs; values never leave this module except back to the auth client.
 * - Only `sb-*` legacy keys (the auth client's own) are touched; unrelated Preferences are left alone.
 *
 * The plain web build (playracehorse.com / PWA) does not use this module.
 */
export interface KeyValueStore {
  get(options: { key: string }): Promise<{ value: string | null }>;
  set(options: { key: string; value: string }): Promise<void>;
  remove(options: { key: string }): Promise<void>;
}
export interface LegacyStore extends KeyValueStore {
  keys(): Promise<{ keys: string[] }>;
}

export const KeychainStorage = registerPlugin<KeyValueStore>('KeychainStorage');

const LEGACY_AUTH_KEY_PREFIX = 'sb-';

export function createNativeAuthStorage(secure: KeyValueStore, legacy: LegacyStore): SupportedStorage {
  /** Keys whose legacy value could not be migrated this launch; reads fall back to legacy only for these. */
  const unmigrated = new Set<string>();
  /** Keys whose secure copy is verified but whose legacy delete failed: a stale copy that is never read, deleted when possible. */
  const staleLegacy = new Set<string>();
  let migration: Promise<void> | null = null;

  async function migrateKey(key: string): Promise<void> {
    const { value } = await legacy.get({ key });
    if (value == null || value === '') {
      await legacy.remove({ key });
      return;
    }
    const existing = await secure.get({ key });
    if (existing.value == null) {
      await secure.set({ key, value });
      const readBack = await secure.get({ key });
      if (readBack.value !== value) throw new Error('secure write could not be verified');
    }
    // Secure now holds this key (either just written and verified, or already newer): the legacy copy is redundant.
    try {
      await legacy.remove({ key });
    } catch {
      staleLegacy.add(key);
    }
  }

  function migrateLegacy(): Promise<void> {
    migration ??= (async () => {
      let keys: string[];
      try {
        keys = (await legacy.keys()).keys.filter((k) => k.startsWith(LEGACY_AUTH_KEY_PREFIX));
      } catch {
        return; // nothing readable to migrate; retried on the next launch
      }
      for (const key of keys) {
        try {
          await migrateKey(key);
        } catch {
          unmigrated.add(key); // legacy value left intact; retried on the next launch
        }
      }
    })();
    return migration;
  }

  return {
    async getItem(key: string) {
      await migrateLegacy();
      const { value } = await secure.get({ key });
      if (value == null) {
        if (!unmigrated.has(key)) return null;
        return (await legacy.get({ key })).value ?? null;
      }
      try {
        JSON.parse(value); // every auth-client value is JSON
      } catch {
        await secure.remove({ key }); // corrupted: behave as signed out rather than crash the auth client
        return null;
      }
      return value;
    },
    async setItem(key: string, value: string) {
      await migrateLegacy();
      await secure.set({ key, value });
      // Secure is now the single authority; drop any legacy copy. Best-effort here: the write that matters succeeded.
      if (unmigrated.delete(key) || staleLegacy.has(key)) {
        try {
          await legacy.remove({ key });
          staleLegacy.delete(key);
        } catch {
          staleLegacy.add(key);
        }
      }
    },
    async removeItem(key: string) {
      await migrateLegacy();
      unmigrated.delete(key);
      staleLegacy.delete(key);
      const results = await Promise.allSettled([secure.remove({ key }), legacy.remove({ key })]);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    },
  };
}

export const capacitorAuthStorage: SupportedStorage = createNativeAuthStorage(KeychainStorage, Preferences);
