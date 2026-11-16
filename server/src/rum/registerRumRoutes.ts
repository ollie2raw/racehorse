import { timingSafeEqual } from 'node:crypto';
import express, { type Application, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { aggregator, isRumIngestEnabled, recentPublishedHours } from './rumHourly';
import { parseBeacon } from './rumAggregator';

/**
 * POST /api/rum: one speed-measurement summary (docs/ops/rum-beacon.md). The route never logs, and never reads the request's IP, user agent
 * or cookies; the only per-IP thing is the rate limiter in front of it (in memory). Errors are answered here, so nothing about the request
 * reaches the error handler or Sentry.
 * GET /api/rum/summary: the totals, behind RUM_SUMMARY_TOKEN (404 when the token is not configured).
 */
export const RUM_BODY_LIMIT = '2kb';

function tokenMatches(header: string | undefined, token: string): boolean {
  const presented = Buffer.from((header ?? '').replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export function registerRumRoutes(app: Application, limits: { ingest?: RequestHandler; summary?: RequestHandler } = {}): void {
  const passthrough: RequestHandler = (_req, _res, next) => next();
  // text/plain on purpose: the browser's beacon then needs no CORS preflight. Any content type is read as text.
  const bodyParser = express.text({ type: () => true, limit: RUM_BODY_LIMIT });
  const bodyErrors = (_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(413).json({ error: 'invalid' });
  };

  app.post('/api/rum', limits.ingest ?? passthrough, bodyParser, bodyErrors, (req: Request, res: Response) => {
    if (!isRumIngestEnabled()) { res.status(204).end(); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(typeof req.body === 'string' ? req.body : ''); } catch { parsed = null; }
    const beacon = parseBeacon(parsed);
    if (!beacon) { res.status(400).json({ error: 'invalid' }); return; }
    aggregator.ingest(beacon);
    res.status(204).end();
  });

  app.get('/api/rum/summary', limits.summary ?? passthrough, (req: Request, res: Response) => {
    const token = process.env.RUM_SUMMARY_TOKEN?.trim();
    if (!token) { res.status(404).end(); return; }
    if (!tokenMatches(req.get('authorization'), token)) { res.status(401).json({ error: 'unauthorized' }); return; }
    res.json({ current: aggregator.preview(), published: recentPublishedHours() });
  });
}
