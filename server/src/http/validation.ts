import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { childLogger } from '../logger';
import { requestIdOf } from './errors';

/**
 * Request-body validation with a safe rollout (roadmap 3.3).
 *
 *   shadow   (default)  check the body against the route's schema and LOG what does not match, but let every request through exactly as before.
 *                       This is how a schema is proven against real traffic before it can reject anyone.
 *   enforce             a body that does not match is answered with a 400 and never reaches the handler.
 *   off                 no checking at all (a kill switch if a schema ever misbehaves).
 *
 * Set with REQUEST_VALIDATION_MODE. Anything else, or nothing, is shadow.
 *
 * What is logged is only the route, the request id, and each problem's path and code (for example `winnerScore: too_big`). Never a value:
 * a body can carry ids and room codes, and a zod message can echo the input.
 */

const log = childLogger('validation');

export type ValidationMode = 'off' | 'shadow' | 'enforce';

export function validationMode(): ValidationMode {
  const value = process.env.REQUEST_VALIDATION_MODE;
  return value === 'off' || value === 'enforce' ? value : 'shadow';
}

type Tally = { checked: number; invalid: number };
const tallies = new Map<string, Tally>();
const lastLoggedAt = new Map<string, number>();

/** A busy route with a drifting client would log on every request; one line per route per interval is enough to see it. */
export const VALIDATION_LOG_INTERVAL_MS = 10_000;
const MAX_ISSUES_LOGGED = 5;

/** Counts since the process started (or since the last reset): how many bodies were checked and how many did not match, per route. */
export function validationTallies(): Record<string, Tally> {
  return Object.fromEntries([...tallies].map(([route, tally]) => [route, { ...tally }]));
}

export function resetValidationStateForTests(): void {
  tallies.clear();
  lastLoggedAt.clear();
}

export function validateBody(route: string, schema: ZodType, options: { now?: () => number } = {}): RequestHandler {
  const now = options.now ?? Date.now;
  return (req, res, next) => {
    const mode = validationMode();
    if (mode === 'off') {
      next();
      return;
    }

    const result = schema.safeParse(req.body);
    const tally = tallies.get(route) ?? { checked: 0, invalid: 0 };
    tally.checked += 1;
    tallies.set(route, tally);
    if (result.success) {
      next();
      return;
    }
    tally.invalid += 1;

    const at = now();
    const last = lastLoggedAt.get(route);
    if (mode === 'enforce' || last === undefined || at - last >= VALIDATION_LOG_INTERVAL_MS) {
      lastLoggedAt.set(route, at);
      log.warn(
        {
          route,
          mode,
          requestId: requestIdOf(res),
          issues: result.error.issues.slice(0, MAX_ISSUES_LOGGED).map((issue) => ({ path: issue.path.join('.') || '(body)', code: issue.code })),
          checked: tally.checked,
          invalid: tally.invalid,
        },
        mode === 'enforce' ? 'request body rejected' : 'request body does not match its schema (shadow: allowed)',
      );
    }

    if (mode === 'enforce') {
      res.status(400).json({ error: 'The request is not valid.', requestId: requestIdOf(res) });
      return;
    }
    next();
  };
}
