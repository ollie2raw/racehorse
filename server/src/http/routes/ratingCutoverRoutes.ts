import type { Application, Request, Response } from 'express';
import { childLogger } from '../../logger';
import { isAdminSecret } from '../../platform/auth/adminSecret';
import { resolveReleaseVersion } from '../../platform/health/releaseVersion';
import { getRatingCutoverStatus, setRatingCutoverQuiesced } from '../../ranking/ratingCutoverGate';

const log = childLogger('ranking:cutover-routes');

/**
 * Operator controls for the rating cutover gate. Both routes require the
 * `x-admin-secret` header (the same header-only admin pattern as Daily Fritz);
 * nothing here is reachable anonymously, the secret is never echoed, and the
 * response carries only operational counters.
 */
function authorized(req: Request, res: Response): boolean {
  if (!isAdminSecret(req.get('x-admin-secret'))) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

export function registerRatingCutoverRoutes(app: Application): void {
  app.get('/api/ops/rating-cutover/status', async (req, res) => {
    if (!authorized(req, res)) return;
    noStore(res);
    try {
      res.json(await getRatingCutoverStatus(resolveReleaseVersion()));
    } catch (error) {
      log.error({ err: error }, 'rating cutover status failed');
      res.status(503).json({ error: 'rating_cutover_status_unavailable' });
    }
  });

  app.post('/api/ops/rating-cutover/quiesce', async (req, res) => {
    if (!authorized(req, res)) return;
    noStore(res);
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: '`enabled` must be a boolean.' });
      return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 200) : null;
    try {
      await setRatingCutoverQuiesced(enabled, reason);
      res.json(await getRatingCutoverStatus(resolveReleaseVersion()));
    } catch (error) {
      log.error({ err: error }, 'rating cutover toggle failed');
      res.status(503).json({ error: 'rating_cutover_toggle_failed' });
    }
  });
}
