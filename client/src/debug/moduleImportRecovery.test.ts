// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MODULE_IMPORT_RECOVERY_KEY,
  isChunkLoadFailure,
  markAppLoadSuccessful,
  recoverFromChunkLoadFailure,
} from './moduleImportRecovery';

function makeStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    _store: store,
  };
}

function makeDeps(initial: Record<string, string> = {}) {
  const storage = makeStorage(initial);
  const reload = vi.fn();
  return { storage, reload, href: '/solo?tier=elite#top', deps: { storage, reload, href: '/solo?tier=elite#top' } };
}

describe('isChunkLoadFailure', () => {
  it.each([
    // Safari / WebKit — the wording in the production report.
    'Importing a module script failed.',
    // Chromium.
    'Failed to fetch dynamically imported module: https://x/assets/a.js',
    // Firefox.
    'error loading dynamically imported module',
    // Vite's preload helper.
    'Unable to preload CSS for /assets/a.css',
  ])('recognises %s', (message) => {
    expect(isChunkLoadFailure(new Error(message))).toBe(true);
  });

  it.each([
    'Cannot read properties of undefined',
    'NetworkError when attempting to fetch resource.',
    'It is not your turn.',
  ])('does not claim %s', (message) => {
    expect(isChunkLoadFailure(new Error(message))).toBe(false);
  });

  it('handles a non-Error without throwing', () => {
    expect(isChunkLoadFailure('Importing a module script failed.')).toBe(true);
    expect(isChunkLoadFailure(undefined)).toBe(false);
    expect(isChunkLoadFailure({ nope: true })).toBe(false);
  });
});

describe('recoverFromChunkLoadFailure', () => {
  let ctx: ReturnType<typeof makeDeps>;
  beforeEach(() => {
    ctx = makeDeps();
  });

  it('ignores anything that is not a chunk failure', () => {
    const outcome = recoverFromChunkLoadFailure(new Error('It is not your turn.'), ctx.deps);

    expect(outcome).toBe('ignored');
    expect(ctx.reload).not.toHaveBeenCalled();
  });

  it('reloads once, busting the cached entry HTML', () => {
    const outcome = recoverFromChunkLoadFailure(
      new Error('Importing a module script failed.'),
      ctx.deps,
    );

    expect(outcome).toBe('reloaded');
    expect(ctx.reload).toHaveBeenCalledTimes(1);
    const target = ctx.reload.mock.calls[0]![0] as string;
    expect(target).toContain('/solo');
    expect(target).toMatch(/rh_reload=\d+/);
    // Query and hash survive: the reload must land the user where they were.
    expect(target).toContain('tier=elite');
    expect(target).toContain('#top');
  });

  it('refuses a second reload in the same tab, so a broken deploy cannot loop', () => {
    recoverFromChunkLoadFailure(new Error('Importing a module script failed.'), ctx.deps);
    ctx.reload.mockClear();

    const outcome = recoverFromChunkLoadFailure(
      new Error('Importing a module script failed.'),
      ctx.deps,
    );

    expect(outcome).toBe('already-attempted');
    expect(ctx.reload).not.toHaveBeenCalled();
  });

  it('recovers again once the app has come up successfully', () => {
    // The bug this fixes: the guard was set and never cleared, so a long-lived
    // mobile tab got exactly one recovery ever — and a genuine stale-deploy
    // weeks later had none left.
    recoverFromChunkLoadFailure(new Error('Importing a module script failed.'), ctx.deps);
    markAppLoadSuccessful(ctx.deps);
    ctx.reload.mockClear();

    const outcome = recoverFromChunkLoadFailure(
      new Error('Importing a module script failed.'),
      ctx.deps,
    );

    expect(outcome).toBe('reloaded');
    expect(ctx.reload).toHaveBeenCalledTimes(1);
  });

  it('leaves no marker behind after a successful load', () => {
    recoverFromChunkLoadFailure(new Error('Importing a module script failed.'), ctx.deps);
    expect(ctx.storage.getItem(MODULE_IMPORT_RECOVERY_KEY)).toBe('1');

    markAppLoadSuccessful(ctx.deps);

    expect(ctx.storage.getItem(MODULE_IMPORT_RECOVERY_KEY)).toBeNull();
  });

  it('does not throw when storage is unavailable', () => {
    const hostile = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {
        throw new Error('storage disabled');
      },
    };
    const reload = vi.fn();

    expect(() =>
      recoverFromChunkLoadFailure(new Error('Importing a module script failed.'), {
        storage: hostile,
        reload,
        href: '/',
      }),
    ).not.toThrow();
    expect(() => markAppLoadSuccessful({ storage: hostile, reload, href: '/' })).not.toThrow();
  });

  it('does not stack cache-busting params across reloads', () => {
    const deps = { ...ctx.deps, href: '/solo?rh_reload=111' };

    recoverFromChunkLoadFailure(new Error('Importing a module script failed.'), deps);

    const target = ctx.reload.mock.calls[0]![0] as string;
    expect(target.match(/rh_reload=/g)).toHaveLength(1);
  });
});
