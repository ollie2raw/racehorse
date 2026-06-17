import type { PreGameDrawState } from './preGameDrawLogic.ts';
import type { UsePreGameDrawUiPhase } from './usePreGameDraw.ts';

export interface PreGameDrawPersistedSnapshot {
  drawState: PreGameDrawState;
  uiPhase: UsePreGameDrawUiPhase;
  resultMessage: string | null;
}

const snapshots = new Map<string, PreGameDrawPersistedSnapshot>();

export function readPreGameDrawSnapshot(key: string): PreGameDrawPersistedSnapshot | null {
  return snapshots.get(key) ?? null;
}

export function writePreGameDrawSnapshot(key: string, snapshot: PreGameDrawPersistedSnapshot): void {
  if (snapshot.uiPhase === 'idle' || snapshot.uiPhase === 'done') {
    snapshots.delete(key);
    return;
  }
  snapshots.set(key, snapshot);
}

export function clearPreGameDrawSnapshot(key: string): void {
  snapshots.delete(key);
}
