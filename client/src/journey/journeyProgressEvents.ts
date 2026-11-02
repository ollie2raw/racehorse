/**
 * Two small signals between Journey's local store and the account sync (docs/progress-sync.md).
 *
 * `saved`: progress was just written to this browser (every write goes through `saveJourneyProgress`), so the sync may have something to send.
 * `applied`: the sync just changed the stored progress because another device had more, so anything showing progress should re-read it.
 *
 * Plain listener sets, not React state: the store is not React, and nothing here may run during a render.
 */

type Listener = () => void;

function channel() {
  const listeners = new Set<Listener>();
  return {
    on(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(): void {
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // One listener failing must not stop the write that announced it, or the other listeners.
        }
      }
    },
  };
}

const saved = channel();
const applied = channel();

export const onJourneyProgressSaved = saved.on;
export const emitJourneyProgressSaved = saved.emit;
export const onJourneyProgressApplied = applied.on;
export const emitJourneyProgressApplied = applied.emit;
