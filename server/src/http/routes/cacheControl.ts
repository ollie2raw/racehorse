import type { Response } from 'express';

export function setPublicShortCache(res: Response, maxAgeSeconds = 60, swrSeconds = 300): void {
  res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${swrSeconds}`);
}

export function setPublicDailyCache(res: Response): void {
  // Good for data that changes once per day — 5-min fresh, serve stale for up to 1 hr while revalidating.
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
}
