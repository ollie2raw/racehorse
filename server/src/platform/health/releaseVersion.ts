/**
 * The release identifier the health routes report.
 *
 * Extracted from registerHealthRoutes so `/api/health` can report the same
 * string `/health` and `/ping` already did. That inconsistency is not
 * cosmetic: `/api/health` returned `{ok, ts}` only, and an investigation into
 * overnight bandwidth concluded "there is no way to tell what commit is live"
 * on the strength of it, while `/health` had the answer all along.
 */
export function resolveReleaseVersion(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.RELEASE_VERSION?.trim() ||
    env.RENDER_GIT_COMMIT?.trim() ||
    env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    env.npm_package_version?.trim() ||
    'dev'
  );
}
