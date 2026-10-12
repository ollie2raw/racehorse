/**
 * The tournament API's clock reference (Phase 2C): every tournament REST body
 * and the time-relevant socket payloads/acks carry `serverNow`, this server's
 * time (ISO-8601 UTC with milliseconds) when the response was created. Clients
 * derive an offset from it (e.g. against the request's send/receive midpoint)
 * so countdowns never trust the device clock. It is a UI clock reference, not
 * the orchestrator lease clock (that is the database's).
 */
export function serverNow(): string {
  return new Date().toISOString();
}

/** `body` with `serverNow` added (objects only; anything else unchanged). */
export function withServerNow<T>(body: T): T | (T & { serverNow: string }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  return { ...(body as object), serverNow: serverNow() } as T & { serverNow: string };
}

/** A socket ack that stamps `serverNow` on what it sends. */
export function ackWithServerNow<A extends (response: never) => void>(ack: A | undefined): A | undefined {
  if (!ack) return undefined;
  return ((response: unknown) => (ack as unknown as (r: unknown) => void)(withServerNow(response))) as unknown as A;
}
