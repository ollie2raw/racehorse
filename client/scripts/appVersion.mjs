/**
 * The release identifier baked into the client bundle.
 *
 * Sentry showed `release: unknown` on every production event. CI sets
 * VITE_APP_VERSION for the build it runs, but Vercel builds the deployed
 * bundle itself, and Vite only exposes `VITE_`-prefixed variables to client
 * code — so VERCEL_GIT_COMMIT_SHA, which Vercel does inject into the build
 * environment, never reached `import.meta.env`.
 *
 * Resolving it here rather than in the Vercel dashboard keeps the mapping in
 * the repo, and keeps CI's explicit VITE_APP_VERSION authoritative so the
 * release name matches the one its sourcemap upload uses.
 */
export function resolveAppVersion(env = process.env) {
  const explicit = env.VITE_APP_VERSION?.trim();
  if (explicit) return explicit;
  const vercelSha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercelSha) return vercelSha;
  return 'unknown';
}
