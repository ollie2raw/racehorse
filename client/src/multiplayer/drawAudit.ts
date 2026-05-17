/** DEV-only structured logs for forced-draw pipeline debugging. */
export function drawAudit(event: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.info(`[draw:audit] ${event}`, payload);
}

export function nextDrawRequestId(): string {
  return `draw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
