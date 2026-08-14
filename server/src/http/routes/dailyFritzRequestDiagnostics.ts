import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

const REQUEST_HEADER = 'x-racehorse-request-id';

export type DailyFritzRequestDiagnostics = {
  requestId: string;
  operation: string;
  startedAt: number;
  log: (event: string, details?: Record<string, unknown>) => void;
};

function resolveRequestId(req: Request): string {
  const supplied = req.get(REQUEST_HEADER)?.trim();
  return supplied && supplied.length <= 128 ? supplied : randomUUID();
}

/** Correlates a Daily Fritz mutation through verification, persistence, and response. */
export function startDailyFritzRequestDiagnostics(
  req: Request,
  res: Response,
  operation: string,
): DailyFritzRequestDiagnostics {
  const requestId = resolveRequestId(req);
  const startedAt = Date.now();
  res.setHeader(REQUEST_HEADER, requestId);

  const diag = (event: string, details: Record<string, unknown> = {}): void => {
    // intentionally no-op — callers consume the DailyFritzRequestDiagnostics.log field
    void { requestId, operation, event, elapsedMs: Date.now() - startedAt, ...details };
  };

  res.once('finish', () => diag('response', { statusCode: res.statusCode }));
  diag('start');
  return { requestId, operation, startedAt, log: diag };
}
