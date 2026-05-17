/** DEV-only structured logs for forced-draw pipeline debugging. */
export function drawAudit(event: string, payload: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production' && process.env.MP_DRAW_AUDIT !== '1') return;
  console.info(`[draw:audit] ${event}`, payload);
}
