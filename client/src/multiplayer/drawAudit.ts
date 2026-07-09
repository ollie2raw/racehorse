/** DEV-only structured logs for forced-draw pipeline debugging. */
export function drawAudit(event: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.info(`[draw:audit] ${event}`, payload);
}

export function nextDrawRequestId(): string {
  return nextGameActionRequestId('draw');
}

export function nextGameActionRequestId(kind: 'draw' | 'pass' | 'move'): string {
  return `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
