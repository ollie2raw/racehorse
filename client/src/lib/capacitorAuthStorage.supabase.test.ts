// @vitest-environment node
/** The REAL supabase-js client over the secure adapter: login persists, relaunch restores, logout clears, legacy migrates. */
import { createClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeAuthStorage, type KeyValueStore, type LegacyStore } from './capacitorAuthStorage';

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }));
vi.mock('@capacitor/preferences', () => ({ Preferences: {} }));

const URL_ = 'https://fisfadjqllojdzibcdfx.supabase.co';
const KEY = 'sb-fisfadjqllojdzibcdfx-auth-token';
const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (sub: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', aud: 'authenticated', exp: 4102444800, iat: 1 })}.${'x'.repeat(43)}`;
const userOf = (id: string) => ({ id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.test`, app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });

class Store implements LegacyStore {
  data = new Map<string, string>();
  async get({ key }: { key: string }) { return { value: this.data.get(key) ?? null }; }
  async set({ key, value }: { key: string; value: string }) { this.data.set(key, value); }
  async remove({ key }: { key: string }) { this.data.delete(key); }
  async keys() { return { keys: [...this.data.keys()] }; }
}

function client(secure: Store, legacy: Store) {
  return createClient(URL_, 'anon-key', {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: createNativeAuthStorage(secure as KeyValueStore, legacy) },
  });
}

afterEach(() => vi.unstubAllGlobals());

function stubNetwork(userId: string) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(userOf(userId)), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(null, { status: 204 }); // logout
  }));
}

describe('real supabase-js client over the Keychain adapter', () => {
  it('login persists to secure storage, a relaunch restores it, logout clears it; Preferences never holds it', async () => {
    stubNetwork('A');
    const secure = new Store();
    const legacy = new Store();
    const first = client(secure, legacy);
    const set = await first.auth.setSession({ access_token: jwt('A'), refresh_token: 'refresh-A' });
    expect(set.error).toBeNull();
    expect(secure.data.has(KEY)).toBe(true);
    expect(legacy.data.size).toBe(0);

    const relaunched = client(secure, legacy);
    const { data } = await relaunched.auth.getSession();
    expect(data.session?.user.id).toBe('A');

    await relaunched.auth.signOut();
    expect(secure.data.has(KEY)).toBe(false);
    expect((await client(secure, legacy).auth.getSession()).data.session).toBeNull();
  });

  it('an existing install\'s Preferences session logs in once, moves to secure storage and leaves Preferences empty', async () => {
    stubNetwork('A');
    const seed = new Store();
    await client(seed, new Store()).auth.setSession({ access_token: jwt('A'), refresh_token: 'refresh-A' });
    const legacy = new Store();
    legacy.data.set(KEY, seed.data.get(KEY) as string); // what the previous build left in UserDefaults
    const secure = new Store();

    const { data } = await client(secure, legacy).auth.getSession();
    expect(data.session?.user.id).toBe('A');
    expect(secure.data.get(KEY)).toBe(seed.data.get(KEY));
    expect(legacy.data.size).toBe(0);
  });

  it('account switch A -> B through the real client leaves only B anywhere', async () => {
    const secure = new Store();
    const legacy = new Store();
    stubNetwork('A');
    const app = client(secure, legacy);
    await app.auth.setSession({ access_token: jwt('A'), refresh_token: 'refresh-A' });
    await app.auth.signOut();
    stubNetwork('B');
    await app.auth.setSession({ access_token: jwt('B'), refresh_token: 'refresh-B' });
    const stored = JSON.stringify([...secure.data, ...legacy.data]);
    expect(stored).toContain('refresh-B');
    expect(stored).not.toContain('refresh-A');
    expect((await client(secure, legacy).auth.getSession()).data.session?.user.id).toBe('B');
  });
});
