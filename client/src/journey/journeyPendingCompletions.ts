import { journeyNamespacedKeySuffix } from './journeyStorageScope';

/**
 * Durable "this win owes its stage a completion" records.
 *
 * Settling a match win and completing its stage are two writes to two different `localStorage` keys, and
 * the second is a whole-object read-modify-write on the progress store that can lose a race to another tab
 * (no compare-and-swap). If it does, the attempt log says `won` while the trail still shows the stage
 * unfinished. A pending-completion record closes that gap: it is written BEFORE the win is settled and
 * removed only once the stage is verifiably complete, so a crash, reload or lost race leaves an obligation
 * that a later Journey load can finish.
 *
 * Why a separate record rather than scanning `won` attempts for incomplete stages:
 *   - a terminal attempt must stay immutable, so it cannot carry a mutable "applied" flag;
 *   - "won and the node is not complete" cannot tell an owed completion from history — it would resurrect
 *     completions after a progress reset, or grant them across a reused node ID;
 *   - the record is created only by the settlement path, so an arbitrary attempt entry never grants anything.
 *
 * A record alone grants nothing either: recovery (see `recoverPendingJourneyCompletions`) acts only when the
 * record points at a stored, valid `won` match attempt for the same node.
 *
 * One key per attempt, like the attempt log: `rh_journey_pending_completion_v1:<namespace>:p:<attemptId>`, so
 * concurrent writers of different obligations never overwrite each other, and namespaces never mix.
 */

export const JOURNEY_PENDING_COMPLETION_KEY = 'rh_journey_pending_completion_v1';

export interface JourneyPendingCompletion {
  attemptId: string;
  nodeId: string;
  /** ISO time the obligation was registered. */
  createdAt: string;
}

function prefix(): string {
  return `${JOURNEY_PENDING_COMPLETION_KEY}${journeyNamespacedKeySuffix()}:p:`;
}

export function getPendingCompletionStorageKey(attemptId: string): string {
  return `${prefix()}${attemptId}`;
}

function parse(raw: string | null): JourneyPendingCompletion | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== 'object') return null;
    if (value.version !== 1) return null;
    if (typeof value.attemptId !== 'string' || value.attemptId.length === 0) return null;
    if (typeof value.nodeId !== 'string' || value.nodeId.length === 0) return null;
    if (typeof value.createdAt !== 'string' || value.createdAt.length === 0) return null;
    return { attemptId: value.attemptId, nodeId: value.nodeId, createdAt: value.createdAt };
  } catch {
    return null;
  }
}

/** Writes the obligation and reads it back. Returns false if storage refused it (full, blocked). */
export function registerPendingCompletion(attemptId: string, nodeId: string): boolean {
  if (typeof window === 'undefined') return false;
  const key = getPendingCompletionStorageKey(attemptId);
  try {
    window.localStorage.setItem(key, JSON.stringify({ version: 1, attemptId, nodeId, createdAt: new Date().toISOString() }));
    return parse(window.localStorage.getItem(key)) != null;
  } catch {
    return false;
  }
}

export function removePendingCompletionByKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // best effort: a leftover record is re-evaluated (and removed) by the next recovery
  }
}

export function removePendingCompletion(attemptId: string): void {
  removePendingCompletionByKey(getPendingCompletionStorageKey(attemptId));
}

/**
 * Removes EVERY obligation in the current namespace — and only that namespace (keys are namespaced, so another
 * user's and the guest's records are never matched). Called when progress is reset: an obligation is a promise
 * to complete a stage in the progress that existed when the win happened, so once that progress is discarded
 * on purpose the promise is void. Left in place, a later recovery would "finish" it as soon as the
 * prerequisite stage were replayed, undoing the reset. Returns how many were removed.
 */
export function clearPendingCompletions(): number {
  const records = listPendingCompletions();
  for (const { key } of records) removePendingCompletionByKey(key);
  return records.length;
}

/** Every record in the current namespace. A malformed one comes back with `record: null` so it can be cleaned up. */
export function listPendingCompletions(): Array<{ key: string; record: JourneyPendingCompletion | null }> {
  if (typeof window === 'undefined') return [];
  const keyPrefix = prefix();
  const keys: string[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith(keyPrefix)) keys.push(key);
    }
    return keys.map((key) => ({ key, record: parse(window.localStorage.getItem(key)) }));
  } catch {
    return [];
  }
}
