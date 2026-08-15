/**
 * express-rate-limit based limiters for use in future route modules.
 * The primary rate limiting in index.ts uses InMemoryRateLimiter; these provide
 * a simpler drop-in alternative for new routes added outside index.ts.
 */
import rateLimit from 'express-rate-limit';

const isLocalhost = (ip: string | undefined): boolean =>
  ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';

function makeJsonLimiter(max: number, windowMs = 60_000) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => isLocalhost(req.ip),
    handler: (_req, res) => {
      res.status(429).json({ error: 'Too many requests. Please slow down.' });
    },
  });
}

export const dailyFritzInitLimiter = makeJsonLimiter(20);
export const dailyFritzHandLimiter = makeJsonLimiter(60);
export const apiGeneralLimiter = makeJsonLimiter(120);
