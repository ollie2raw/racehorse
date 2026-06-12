/** DEV / QA fairness replay log — not player-facing. */
const ENABLED =
  Boolean((import.meta as ImportMeta & { env?: Record<string, string> }).env?.DEV) ||
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_FAIRNESS_LOG === '1';

export type FairnessLogEvent =
  | 'match-init'
  | 'hand-deal'
  | 'draw'
  | 'fritz-move'
  | 'legal-moves';

export function fairnessLogEnabled(): boolean {
  return ENABLED;
}

export function fairnessLog(event: FairnessLogEvent, payload: Record<string, unknown>): void {
  if (!ENABLED) return;
  console.info(`[fairness] ${event}`, payload);
}
