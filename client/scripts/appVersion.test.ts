/**
 * The build-time release identifier.
 *
 * Production reported `release: unknown` on every Sentry event: CI sets
 * VITE_APP_VERSION for its own build, but Vercel builds the deployed bundle
 * separately and Vite only exposes `VITE_`-prefixed variables — so
 * VERCEL_GIT_COMMIT_SHA, which Vercel does inject, never reached the client.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — build script module, not part of the app's TS program.
import { resolveAppVersion } from './appVersion.mjs';

const resolve = resolveAppVersion as (env: Record<string, string | undefined>) => string;

describe('resolveAppVersion', () => {
  it('prefers an explicit VITE_APP_VERSION', () => {
    // CI sets this to github.sha; it must keep winning.
    expect(resolve({ VITE_APP_VERSION: 'abc123', VERCEL_GIT_COMMIT_SHA: 'def456' })).toBe('abc123');
  });

  it('falls back to the commit Vercel injects into its own build', () => {
    expect(resolve({ VERCEL_GIT_COMMIT_SHA: 'def456' })).toBe('def456');
  });

  it('ignores an empty value rather than reporting a blank release', () => {
    expect(resolve({ VITE_APP_VERSION: '', VERCEL_GIT_COMMIT_SHA: 'def456' })).toBe('def456');
    expect(resolve({ VITE_APP_VERSION: '   ' })).toBe('unknown');
  });

  it('still says unknown when nothing identifies the build', () => {
    // A local `npm run build` has neither. Keeping the literal means the
    // Sentry events that do carry it are unambiguously untagged builds.
    expect(resolve({})).toBe('unknown');
  });

  it('trims, so a shell-injected newline does not become part of the release', () => {
    expect(resolve({ VITE_APP_VERSION: 'abc123\n' })).toBe('abc123');
  });
});
