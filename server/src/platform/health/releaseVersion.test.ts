import { describe, expect, it } from 'vitest';
import { resolveReleaseVersion } from './releaseVersion';

/**
 * The release string every health route reports.
 *
 * `/health` and `/ping` already carried it; `/api/health` did not, and that
 * gap cost an investigation an hour of "I can't tell what commit is live"
 * while the answer was one endpoint away.
 */
describe('resolveReleaseVersion', () => {
  it('prefers an explicit RELEASE_VERSION', () => {
    expect(
      resolveReleaseVersion({ RELEASE_VERSION: 'v9', RENDER_GIT_COMMIT: 'abc' }),
    ).toBe('v9');
  });

  it('falls back to the commit Render injects', () => {
    expect(resolveReleaseVersion({ RENDER_GIT_COMMIT: 'abc123' })).toBe('abc123');
  });

  it('then to the commit Vercel injects', () => {
    expect(resolveReleaseVersion({ VERCEL_GIT_COMMIT_SHA: 'def456' })).toBe('def456');
  });

  it('then to the package version', () => {
    expect(resolveReleaseVersion({ npm_package_version: '1.2.3' })).toBe('1.2.3');
  });

  it('says dev when nothing identifies the build', () => {
    expect(resolveReleaseVersion({})).toBe('dev');
  });

  it('ignores blank and whitespace-only values rather than reporting an empty release', () => {
    expect(resolveReleaseVersion({ RELEASE_VERSION: '   ', RENDER_GIT_COMMIT: 'abc' })).toBe('abc');
    expect(resolveReleaseVersion({ RELEASE_VERSION: '' })).toBe('dev');
  });

  it('trims, so a shell-injected newline is not part of the release', () => {
    expect(resolveReleaseVersion({ RENDER_GIT_COMMIT: 'abc123\n' })).toBe('abc123');
  });
});
