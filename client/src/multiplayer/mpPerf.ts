/** Debug-gated multiplayer action timing (`localStorage mp_debug=1`). */

export type MpPerfActionKind = 'play' | 'draw' | 'pass';

type ActiveTrace = {
  kind: MpPerfActionKind;
  baselineSequence: number;
  emitAt: number;
  stateUpdateAt?: number;
  pendingClearedAt?: number;
  ackAt?: number;
};

let activeTrace: ActiveTrace | null = null;

export function isMpDebugEnabled(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem('mp_debug') === '1';
}

function roundMs(ms: number): number {
  return Number(ms.toFixed(1));
}

export function mpPerfBeginAction(kind: MpPerfActionKind, baselineSequence: number): void {
  if (!isMpDebugEnabled()) return;
  activeTrace = { kind, baselineSequence, emitAt: performance.now() };
  console.info('[mp-perf] emit', { kind, baselineSequence });
}

export function mpPerfMarkStateApplied(sequence: number, projectionMs?: number): void {
  if (!isMpDebugEnabled() || !activeTrace) return;
  if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return;
  if (sequence <= activeTrace.baselineSequence) return;
  activeTrace.stateUpdateAt = performance.now();
  console.info('[mp-perf] state:update', {
    kind: activeTrace.kind,
    sequence,
    msFromEmit: roundMs(activeTrace.stateUpdateAt - activeTrace.emitAt),
    projectionMs: projectionMs != null ? roundMs(projectionMs) : undefined,
  });
}

export function mpPerfMarkPendingUiCleared(): void {
  if (!isMpDebugEnabled() || !activeTrace) return;
  activeTrace.pendingClearedAt = performance.now();
  const fromEmit = roundMs(activeTrace.pendingClearedAt - activeTrace.emitAt);
  const fromState =
    activeTrace.stateUpdateAt != null
      ? roundMs(activeTrace.pendingClearedAt - activeTrace.stateUpdateAt)
      : undefined;
  console.info('[mp-perf] pending-ui-cleared', { msFromEmit: fromEmit, msFromStateUpdate: fromState });
}

export function mpPerfMarkAck(ok: boolean, sequence?: number | null): void {
  if (!isMpDebugEnabled() || !activeTrace) return;
  activeTrace.ackAt = performance.now();
  const summary = {
    kind: activeTrace.kind,
    ok,
    sequence: sequence ?? null,
    msFromEmit: roundMs(activeTrace.ackAt - activeTrace.emitAt),
    msFromStateUpdate:
      activeTrace.stateUpdateAt != null
        ? roundMs(activeTrace.ackAt - activeTrace.stateUpdateAt)
        : undefined,
    msFromPendingClear:
      activeTrace.pendingClearedAt != null
        ? roundMs(activeTrace.ackAt - activeTrace.pendingClearedAt)
        : undefined,
  };
  console.info('[mp-perf] ack', summary);
  activeTrace = null;
}

export function mpPerfResetAction(): void {
  activeTrace = null;
}
