/**
 * Retry a refused hand:ready (audit B1). The server answers ok:false when the new hand could not be saved (`uncertain`, the room is
 * rolled back) or is blocked, and nothing on the server starts the hand again; the client used to count that answer as an acknowledgement
 * and waited for a reconnect. On, a refusal is resent with a backoff (1 s, 2 s, 4 s, 8 s, then every 15 s). Off by default; on only when
 * VITE_ENABLE_HAND_READY_RETRY is exactly "true" (build-time). Rollback: unset it and redeploy.
 */
export function parseHandReadyRetryFlag(value: unknown): boolean {
  return value === 'true';
}

export function isHandReadyRetryEnabled(value: unknown = import.meta.env.VITE_ENABLE_HAND_READY_RETRY): boolean {
  return parseHandReadyRetryFlag(value);
}
