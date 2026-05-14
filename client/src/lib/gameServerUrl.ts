/**
 * Base URL for the Racehorse Node game server (REST + Socket.io).
 *
 * - Prefer `VITE_SERVER_URL` (set in CI / Vercel for production).
 * - In local `vite` dev, default to `http://localhost:3001`.
 * - In production builds without env, fall back to the page origin so same-host
 *   deploys (or reverse-proxy setups) work; pure static hosts still need `VITE_SERVER_URL`.
 */
let warnedMissingViteServerUrl = false;

export function resolveGameServerUrl(): string {
  const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';
  if (configured) return configured.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://localhost:3001';
  if (typeof window !== 'undefined') {
    if (import.meta.env.PROD && !warnedMissingViteServerUrl) {
      warnedMissingViteServerUrl = true;
      console.warn(
        '[racehorse] VITE_SERVER_URL was not set at build time. Using this page origin for Socket.io / API. ' +
          'If the game server runs on another host (common for Vercel frontend + Node backend), set VITE_SERVER_URL in Vercel → Settings → Environment Variables, then redeploy.',
      );
    }
    return window.location.origin;
  }
  return '';
}
