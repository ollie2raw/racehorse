import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { childLogger } from '../logger';

/**
 * One way for the HTTP API to fail.
 *
 *   - Every request gets an id (`X-Request-Id`, also in the body of an error), so a player's "it said something went wrong" can be matched
 *     to one log line. A caller may supply its own id; it is only trusted if it is plain and short.
 *   - A 500 never carries internal error text in production (a database error can include the query or a table name); the caller gets the
 *     route's fixed sentence and the request id, and the real error goes to the log.
 *   - Anything a route does not catch ends in `errorHandler`, so a thrown error is JSON with a request id, not Express's default page.
 */

const log = childLogger('http');

export const REQUEST_ID_HEADER = 'X-Request-Id';
/** What an incoming request id may look like to be reused: plain characters, 8 to 64 of them. Anything else is replaced. */
const REUSABLE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const requestId = incoming && REUSABLE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};

export function requestIdOf(res: Response): string | undefined {
  const id = (res.locals as { requestId?: unknown } | undefined)?.requestId;
  return typeof id === 'string' ? id : undefined;
}

/** The message a caller may see: the route's fixed sentence in production, the real one while developing. */
export function publicErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === 'production') return fallback;
  return error instanceof Error ? error.message : fallback;
}

function describe(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: typeof error === 'string' ? error : 'non-error thrown' };
}

/**
 * Answer a failed request with a 500: log the real error with the request id, return the route's fixed sentence and the request id.
 * Pass `capture` to also send it to Sentry (leave it off for failures that are expected to be transient, so they cannot eat the quota).
 */
export function sendServerError(
  res: Response,
  error: unknown,
  fallback: string,
  options: { capture?: boolean; context?: Record<string, unknown> } = {},
): void {
  const requestId = requestIdOf(res);
  log.error({ requestId, err: describe(error), ...options.context }, fallback);
  if (options.capture) Sentry.captureException(error, { extra: { requestId, ...options.context } });
  if (res.headersSent) return;
  res.status(500).json({ error: publicErrorMessage(error, fallback), requestId });
}

type HttpishError = { type?: unknown; status?: unknown; statusCode?: unknown };

/** Registered after every route. Turns an error nothing else handled into JSON with a request id. */
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const requestId = requestIdOf(res);
  const shape = (error && typeof error === 'object' ? error : {}) as HttpishError;

  if (shape.type === 'entity.too.large') {
    res.status(413).json({ error: 'Match result payload is too large.', requestId });
    return;
  }
  if (shape.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body is not valid JSON.', requestId });
    return;
  }
  // Other errors the body parser raises (a wrong charset, an aborted upload) carry a 4xx status of their own.
  const status = Number(shape.status ?? shape.statusCode);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    res.status(status).json({ error: 'The request could not be read.', requestId });
    return;
  }

  log.error({ requestId, err: describe(error) }, 'unhandled error in a request');
  Sentry.captureException(error, { extra: { requestId } });
  res.status(500).json({ error: 'Something went wrong.', requestId });
};
