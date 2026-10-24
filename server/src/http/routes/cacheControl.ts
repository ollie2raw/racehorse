import type { Response } from 'express';

export function setPublicShortCache(res: Response, maxAgeSeconds = 60, swrSeconds = 300): void {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${swrSeconds}`);
}

/**
 * For per-viewer responses. `private` keeps shared caches out; `Vary: Authorization` keeps the BROWSER cache (keyed by
 * URL otherwise) from answering a different account's request on the same device with the previous account's payload
 * after a sign-out / account switch inside the max-age window.
 */
export function setPrivateShortCache(res: Response, maxAgeSeconds = 30): void {
  res.set('Cache-Control', `private, max-age=${maxAgeSeconds}, stale-while-revalidate=60`);
  res.vary('Authorization');
}

export function setPublicDailyCache(res: Response): void {
  // Good for data that changes once per day — 5-min fresh, serve stale for up to 1 hr while revalidating.
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
}
