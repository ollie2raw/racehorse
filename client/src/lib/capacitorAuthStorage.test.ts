// @vitest-environment node
/**
 * Native auth-session storage: Keychain is the single authority, legacy Preferences is migrated away safely.
 * "Relaunch" = a new adapter instance over the SAME stores (the stores model the OS; the adapter models one app process).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNativeAuthStorage, type KeyValueStore, type LegacyStore } from './capacitorAuthStorage';

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }));
vi.mock('@capacitor/preferences', () => ({ Preferences: {} }));

const SESSION_KEY = 'sb-fisfadjqllojdzibcdfx-auth-token';
const VERIFIER_KEY = `${SESSION_KEY}-code-verifier`;
const sessionOf = (user: string, refresh = 'r1') =>
  JSON.stringify({ access_token: `access-${user}`, refresh_token: `${refresh}-${user}`, user: { id: user }, expires_at: 4102444800 });

class FakeStore implements LegacyStore {
  data = new Map<string, string>();
  failSet = false;
  failRemove = false;
  failKeys = false;
  corruptOnSet = false; // stores something different from what was written
  sets = 0;
  async get({ key }: { key: string }) { return { value: this.data.get(key) ?? null }; }
  async set({ key, value }: { key: string; value: string }) {
    this.sets += 1;
    if (this.failSet) throw new Error('keychain write failed');
    this.data.set(key, this.corruptOnSet ? `${value}#` : value);
  }
  async remove({ key }: { key: string }) {
    if (this.failRemove) throw new Error('remove failed');
    this.data.delete(key);
  }
  async keys() {
    if (this.failKeys) throw new Error('keys failed');
    return { keys: [...this.data.keys()] };
  }
}

let secure: FakeStore;
let legacy: FakeStore;
const launch = () => createNativeAuthStorage(secure as KeyValueStore, legacy);
const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) => vi.spyOn(console, m as 'log').mockImplementation(() => undefined));

beforeEach(() => { secure = new FakeStore(); legacy = new FakeStore(); spies.forEach((s) => s.mockClear()); });
afterEach(() => {
  // No credential ever reaches a console, whatever path ran.
  const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
  expect(logged).not.toMatch(/access-|refresh|r1-|r2-/);
});

describe('fresh login, relaunch, refresh', () => {
  it('stores the session in secure storage only, and a relaunch restores it', async () => {
    const app = launch();
    await app.setItem(SESSION_KEY, sessionOf('A'));
    expect(secure.data.get(SESSION_KEY)).toBe(sessionOf('A'));
    expect(legacy.data.size).toBe(0);                       // never written to Preferences
    expect(await launch().getItem(SESSION_KEY)).toBe(sessionOf('A'));   // kill + relaunch
  });

  it('a refresh-token update overwrites the same entry (no second copy)', async () => {
    const app = launch();
    await app.setItem(SESSION_KEY, sessionOf('A', 'r1'));
    await app.setItem(SESSION_KEY, sessionOf('A', 'r2'));
    expect([...secure.data.keys()]).toEqual([SESSION_KEY]);
    expect(await launch().getItem(SESSION_KEY)).toBe(sessionOf('A', 'r2'));
  });

  it('an expired session is returned untouched: expiry is the auth client\'s decision, not the store\'s', async () => {
    const expired = JSON.stringify({ access_token: 'access-old', refresh_token: 'rt', expires_at: 1 });
    secure.data.set(SESSION_KEY, expired);
    expect(await launch().getItem(SESSION_KEY)).toBe(expired);
  });
});

describe('logout and account switching', () => {
  it('logout removes the secure session and the code verifier', async () => {
    const app = launch();
    await app.setItem(SESSION_KEY, sessionOf('A'));
    await app.setItem(VERIFIER_KEY, JSON.stringify('verifier'));
    await app.removeItem(SESSION_KEY);
    await app.removeItem(VERIFIER_KEY);
    expect(secure.data.size).toBe(0);
    expect(await launch().getItem(SESSION_KEY)).toBeNull();
  });

  it('A -> B: B never sees A, and A is gone from every store', async () => {
    const app = launch();
    await app.setItem(SESSION_KEY, sessionOf('A'));
    await app.removeItem(SESSION_KEY);
    expect(await launch().getItem(SESSION_KEY)).toBeNull();      // between accounts: guest
    await app.setItem(SESSION_KEY, sessionOf('B'));
    const stored = (await launch().getItem(SESSION_KEY)) ?? '';
    expect(stored).toBe(sessionOf('B'));
    expect(JSON.stringify([...secure.data, ...legacy.data])).not.toContain('access-A');
  });

  it('A -> B without an explicit logout overwrites A (same key), never merges', async () => {
    const app = launch();
    await app.setItem(SESSION_KEY, sessionOf('A'));
    await app.setItem(SESSION_KEY, sessionOf('B'));
    expect(secure.data.get(SESSION_KEY)).toBe(sessionOf('B'));
    expect(JSON.stringify([...secure.data])).not.toContain('access-A');
  });

  it('A -> guest: logout also deletes a legacy copy so nothing can resurrect A', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A'));
    const app = launch();
    await app.removeItem(SESSION_KEY);
    expect(await launch().getItem(SESSION_KEY)).toBeNull();
    expect(legacy.data.size).toBe(0);
  });

  it('logout still clears the other store if one removal fails, and reports the failure', async () => {
    const app = launch();
    await app.setItem(SESSION_KEY, sessionOf('A'));
    legacy.failRemove = true;
    await expect(app.removeItem(SESSION_KEY)).rejects.toThrow();
    expect(secure.data.size).toBe(0);
  });
});

describe('legacy Preferences -> Keychain migration', () => {
  it('moves the session, verifies the secure write, and leaves no credential in Preferences', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A'));
    legacy.data.set(VERIFIER_KEY, JSON.stringify('pkce-secret'));
    expect(await launch().getItem(SESSION_KEY)).toBe(sessionOf('A'));
    expect(secure.data.get(SESSION_KEY)).toBe(sessionOf('A'));
    expect(secure.data.get(VERIFIER_KEY)).toBe(JSON.stringify('pkce-secret'));
    expect(legacy.data.size).toBe(0);
  });

  it('is idempotent: later launches use secure only and never write again', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A'));
    await launch().getItem(SESSION_KEY);
    const writes = secure.sets;
    for (let i = 0; i < 3; i += 1) expect(await launch().getItem(SESSION_KEY)).toBe(sessionOf('A'));
    expect(secure.sets).toBe(writes);
    expect(legacy.data.size).toBe(0);
  });

  it('a failed secure write never deletes the only valid session; the user stays logged in and the next launch retries', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A'));
    secure.failSet = true;
    const app = launch();
    expect(await app.getItem(SESSION_KEY)).toBe(sessionOf('A'));   // still logged in
    expect(legacy.data.get(SESSION_KEY)).toBe(sessionOf('A'));     // not deleted
    secure.failSet = false;
    expect(await launch().getItem(SESSION_KEY)).toBe(sessionOf('A'));
    expect(secure.data.get(SESSION_KEY)).toBe(sessionOf('A'));     // retried
    expect(legacy.data.size).toBe(0);
  });

  it('a secure write that cannot be read back identically is treated as failed (legacy kept)', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A'));
    secure.corruptOnSet = true;
    await launch().getItem(SESSION_KEY);
    expect(legacy.data.get(SESSION_KEY)).toBe(sessionOf('A'));
  });

  it('interruption between the secure write and the legacy delete is harmless: both present -> secure wins, legacy deleted', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A', 'old'));
    secure.data.set(SESSION_KEY, sessionOf('A', 'newer'));
    expect(await launch().getItem(SESSION_KEY)).toBe(sessionOf('A', 'newer'));
    expect(legacy.data.size).toBe(0);
  });

  it('a failed legacy delete leaves a stale copy that never overrides secure', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A', 'old'));
    legacy.failRemove = true;
    const app = launch();
    expect(await app.getItem(SESSION_KEY)).toBe(sessionOf('A', 'old'));  // migrated copy is identical
    await app.setItem(SESSION_KEY, sessionOf('A', 'refreshed'));
    expect(await app.getItem(SESSION_KEY)).toBe(sessionOf('A', 'refreshed'));
  });

  it('an unreadable Preferences key list does not break login and is retried later', async () => {
    legacy.data.set(SESSION_KEY, sessionOf('A'));
    legacy.failKeys = true;
    expect(await launch().getItem(SESSION_KEY)).toBeNull();
    legacy.failKeys = false;
    expect(await launch().getItem(SESSION_KEY)).toBe(sessionOf('A'));
  });
});

describe('corrupted and unrelated data', () => {
  it('a corrupted secure value behaves as signed out, is deleted, and does not throw', async () => {
    secure.data.set(SESSION_KEY, '{not json');
    expect(await launch().getItem(SESSION_KEY)).toBeNull();
    expect(secure.data.has(SESSION_KEY)).toBe(false);
  });

  it('secure absent + unrelated Preferences present: signed out, and the unrelated keys are untouched', async () => {
    legacy.data.set('theme', 'dark');
    legacy.data.set('hasSeenWelcome', 'true');
    expect(await launch().getItem(SESSION_KEY)).toBeNull();
    expect([...legacy.data.entries()]).toEqual([['theme', 'dark'], ['hasSeenWelcome', 'true']]);
    expect(secure.data.size).toBe(0);
  });

  it('a read error from the secure store propagates (and deletes nothing) instead of silently signing the user out for good', async () => {
    secure.data.set(SESSION_KEY, sessionOf('A'));
    secure.get = async () => { throw new Error('keychain locked'); };
    await expect(launch().getItem(SESSION_KEY)).rejects.toThrow('keychain locked');
    expect(secure.data.get(SESSION_KEY)).toBe(sessionOf('A'));
  });
});
