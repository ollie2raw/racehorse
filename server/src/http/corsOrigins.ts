/**
 * Which browser origins may call the game server (REST + Socket.IO).
 *
 * Auth is a bearer token, never a cookie, so CORS is defence in depth rather
 * than the access control — but there is still no reason to let an unrelated
 * site read API responses with credentials.
 *
 * Allowed:
 *  - the production site (apex + www);
 *  - the iOS app's WebView origin, `capacitor://localhost` (also set in
 *    Render's CORS_ALLOWED_ORIGINS; it lives here so the app can't be broken
 *    by an env edit);
 *  - this team's Vercel deployments of the two client projects (production
 *    alias `racehorsedoms.vercel.app`, and preview URLs, which Vercel names
 *    `<project>-<id|git-branch>-<team>.vercel.app`);
 *  - local development (http://localhost / 127.0.0.1, any port);
 *  - CLIENT_URL and CORS_ALLOWED_ORIGINS from the environment.
 *
 * Not allowed: any other `*.vercel.app` origin. This used to be a wildcard.
 */
export const CANONICAL_PRODUCTION_CLIENT_ORIGINS = [
  'https://playracehorse.com',
  'https://www.playracehorse.com',
] as const;

export const NATIVE_APP_ORIGINS = ['capacitor://localhost'] as const;

/** Vercel team scope that owns the client projects (from their deployment URLs). */
export const VERCEL_TEAM_SCOPE = 'olivers-projects-3706e148';

export const ALLOWED_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^http:\/\/localhost(?::\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https:\/\/racehorsedoms\.vercel\.app$/i,
  new RegExp(`^https://racehorse(?:doms|dominoes)-[a-z0-9-]+-${VERCEL_TEAM_SCOPE}\\.vercel\\.app$`, 'i'),
];

export type CorsOriginConfig = {
  clientDeployUrl?: string | null;
  configuredOrigins?: readonly string[];
};

/** Exact origins (Socket.IO checks these first). */
export function explicitAllowedOrigins(config: CorsOriginConfig = {}): string[] {
  return [
    ...new Set([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      ...CANONICAL_PRODUCTION_CLIENT_ORIGINS,
      ...NATIVE_APP_ORIGINS,
      ...(config.clientDeployUrl ? [config.clientDeployUrl] : []),
      ...(config.configuredOrigins ?? []),
    ]),
  ];
}

export function isAllowedOrigin(origin: string | undefined, config: CorsOriginConfig = {}): boolean {
  // No Origin header: same-origin, server-to-server, or a native HTTP client.
  if (!origin) return true;
  if (explicitAllowedOrigins(config).includes(origin)) return true;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}
