/**
 * Base URL for the Racehorse Node game server (REST + Socket.io).
 *
 * - Prefer `VITE_SERVER_URL` (set in CI / Vercel for production).
 * - In local `vite` dev, default to `http://localhost:3001`.
 * - In known static production on Vercel, fall back to the Render origin so a
 *   missing env var does not send `/api/*` traffic to Vercel and hard-fail.
 * - Otherwise, fall back to the page origin so same-host deploys (or reverse-proxy
 *   setups) still work.
 */
let warnedMissingViteServerUrl = false;
const KNOWN_PRODUCTION_GAME_SERVER_URL = 'https://racehorse.onrender.com';

function isLocalBrowserHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function resolveGameServerUrl(): string {
  const configured = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';
  if (configured) return configured.replace(/\/$/, '');
  if (import.meta.env.DEV) return 'http://localhost:3001';
  if (typeof window !== 'undefined') {
    if (window.location.hostname === 'racehorsedoms.vercel.app') {
      if (import.meta.env.PROD && !warnedMissingViteServerUrl) {
        warnedMissingViteServerUrl = true;
        console.warn(
          '[racehorse] VITE_SERVER_URL was not set at build time. Falling back to the production Render server for Socket.io / API.',
        );
      }
      return KNOWN_PRODUCTION_GAME_SERVER_URL;
    }
    if (isLocalBrowserHost(window.location.hostname)) return '';
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

/** True when the configured game server origin is the same as the current page (static SPA only — no Socket.io). */
export function isGameServerSameOriginAsPage(serverUrl: string): boolean {
  if (typeof window === 'undefined' || !serverUrl.trim()) return false;
  try {
    return new URL(serverUrl).origin === window.location.origin;
  } catch {
    return false;
  }
}
