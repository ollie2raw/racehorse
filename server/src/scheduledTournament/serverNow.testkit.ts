/**
 * Test support for the tournament API clock field: asserts `serverNow` is an
 * ISO-8601 UTC timestamp with milliseconds, then removes it, so existing
 * exact-shape assertions keep checking everything else.
 */
import { expect } from 'vitest';

export const SERVER_NOW_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function takeServerNow<T>(body: T): T {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { serverNow, ...rest } = body as Record<string, unknown>;
  expect(serverNow, 'serverNow on a tournament response').toMatch(SERVER_NOW_ISO);
  return rest as T;
}

/** Wraps a socket ack mock: each response must carry serverNow; the mock receives it without. */
export function ackTakingServerNow(ack: (resp: unknown) => void): (resp: unknown) => void {
  return (resp) => ack(takeServerNow(resp));
}
