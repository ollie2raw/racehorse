import { trackProcessWork, beginProcessWork } from '../platform/processLifecycle';
import { randomUUID } from 'node:crypto';
import { childLogger } from '../logger';
import { supabaseFetch } from '../supabaseUtils';

const log = childLogger('ranking:cutover-gate');

/**
 * Rating cutover quiescence gate (senior-audit Ghost/Fritz + weekly decay).
 *
 * Why it exists: the pre-remediation ("legacy") server commits a Fritz ranked
 * result, then separately and without awaiting writes the Ghost training
 * profile; its weekly decay reads RD and later PATCHes it unconditionally. If
 * the Ghost/ranked expand migrations land between those steps the legacy
 * write is fenced and the other half is silently lost. This gate lets one
 * operator stop NEW legacy rating-affecting work, then positively observe that
 * all STARTED work has finished, before any expand migration runs.
 *
 * State lives in two places, on purpose:
 *  - the intent (`quiesced`) is one row in `public.rating_cutover_gate`, so a
 *    process restart can never reopen legacy writers;
 *  - in-flight counters are in memory: this deployment is a single process, and
 *    a unit is only ever "in flight" inside the process that is running it.
 *
 * `LEGACY_RATING_WRITERS_ENFORCED` is true only in the bridge build that runs
 * on the OLD rating write paths. The remediated server writes through atomic
 * RPCs that are safe to run while the row says quiesced (that is how it is
 * smoke-tested before resuming), so it counts and reports but never blocks.
 */
export const LEGACY_RATING_WRITERS_ENFORCED = false;

let legacyEnforced = LEGACY_RATING_WRITERS_ENFORCED;
const bootId = randomUUID();
const bootedAt = new Date().toISOString();

const counters = { completions: 0, deferredGhostWrites: 0, decayRuns: 0, rejected: 0 };

export class RatingCutoverQuiescedError extends Error {
  readonly code = 'rating_cutover_quiesced';
  readonly retryable = true;
  constructor(operation: string) {
    super(`rating_cutover_quiesced: ${operation} rejected while the rating cutover gate is closed`);
    this.name = 'RatingCutoverQuiescedError';
  }
}

export function isRatingCutoverQuiescedError(error: unknown): error is RatingCutoverQuiescedError {
  return error instanceof RatingCutoverQuiescedError;
}

export type CutoverFence = {
  quiesced: boolean;
  quiescedAt: string | null;
  enabledBootId: string | null;
  reason: string | null;
  ghostExpandAppliedAt: string | null;
};

type FenceRow = {
  quiesced: boolean;
  quiesced_at: string | null;
  enabled_boot_id: string | null;
  reason: string | null;
  ghost_expand_applied_at: string | null;
};

const FENCE_PATH = '/rest/v1/rating_cutover_gate?id=eq.true';
const FENCE_SELECT = 'quiesced,quiesced_at,enabled_boot_id,reason,ghost_expand_applied_at';

function toFence(row: FenceRow): CutoverFence {
  return {
    quiesced: row.quiesced,
    quiescedAt: row.quiesced_at,
    enabledBootId: row.enabled_boot_id,
    reason: row.reason,
    ghostExpandAppliedAt: row.ghost_expand_applied_at,
  };
}

/** Reads the durable fence. Throws when it cannot be read: callers fail closed. */
export async function readCutoverFence(): Promise<CutoverFence> {
  const rows = await supabaseFetch<FenceRow[]>(`${FENCE_PATH}&select=${FENCE_SELECT}`, { method: 'GET' });
  const row = rows[0];
  if (!row) throw new Error('rating_cutover_gate row is missing; apply 2026-10-13_rating_cutover_gate.sql');
  return toFence(row);
}

export type CompletionUnit = { end(): void };

function makeEnder(release: () => void): () => void {
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    release();
  };
}

/**
 * Starts one vulnerable completion unit. The in-flight count is raised
 * BEFORE the fence is read, so a unit that has read "open" is always already
 * visible in the count an operator reads after closing the gate.
 */
export async function beginRatingCompletion(operation: string): Promise<CompletionUnit> {
  const release = beginProcessWork('rating-completion');
  counters.completions += 1;
  const end = makeEnder(() => { counters.completions -= 1; release(); });
  if (!legacyEnforced) return { end };
  try {
    const fence = await readCutoverFence();
    if (fence.quiesced) {
      counters.rejected += 1;
      throw new RatingCutoverQuiescedError(operation);
    }
  } catch (error) {
    end();
    throw error;
  }
  return { end };
}

/** The whole vulnerable logical operation is one unit: ranked write through the last awaited step. */
export async function withRatingCompletion<T>(operation: string, run: () => Promise<T>): Promise<T> {
  const unit = await beginRatingCompletion(operation);
  try {
    return await run();
  } finally {
    unit.end();
  }
}

/**
 * Keeps a fire-and-forget part of a completion (the legacy deferred Ghost
 * training write) counted until it settles. Must be called synchronously while
 * the owning completion unit is still held so there is no uncounted gap.
 */
export function trackDeferredRatingWork<T>(work: Promise<T>): Promise<T> {
  counters.deferredGhostWrites += 1;
  const end = makeEnder(() => { counters.deferredGhostWrites -= 1; });
  return trackProcessWork('deferred-ghost', () => work).finally(end);
}

export type DecayRun = { end(): void };

/** Returns null (do not run) when a legacy decay run must not start. Fails closed. */
export async function beginDecayRun(): Promise<DecayRun | null> {
  counters.decayRuns += 1;
  const end = makeEnder(() => { counters.decayRuns -= 1; });
  if (!legacyEnforced) return { end };
  try {
    const fence = await readCutoverFence();
    if (fence.quiesced) {
      counters.rejected += 1;
      end();
      return null;
    }
  } catch (error) {
    end();
    log.error({ err: error }, 'rating cutover fence unreadable; weekly decay not started');
    return null;
  }
  return { end };
}

/** Checked immediately before each unconditional decay write. Fails closed. */
export async function mayContinueDecay(): Promise<boolean> {
  if (!legacyEnforced) return true;
  try {
    const fence = await readCutoverFence();
    if (fence.quiesced) counters.rejected += 1;
    return !fence.quiesced;
  } catch (error) {
    log.error({ err: error }, 'rating cutover fence unreadable; stopping weekly decay');
    return false;
  }
}

export type RatingCutoverStatus = {
  enforcement: 'legacy_writers' | 'atomic_writers';
  quiesced: boolean;
  quiescedAt: string | null;
  reason: string | null;
  release: string | null;
  bootId: string;
  bootedAt: string;
  enabledInThisProcess: boolean;
  completionsInFlight: number;
  deferredGhostWritesInFlight: number;
  decayInFlight: boolean;
  rejectedSinceBoot: number;
  newUnsafeOperationsCanStart: boolean;
  drained: boolean;
  readyForExpand: boolean;
  notReadyReasons: string[];
  ghostExpandAppliedAt: string | null;
};

export async function getRatingCutoverStatus(release: string | null = null): Promise<RatingCutoverStatus> {
  const fence = await readCutoverFence();
  const completionsInFlight = counters.completions;
  const deferredGhostWritesInFlight = counters.deferredGhostWrites;
  const decayInFlight = counters.decayRuns > 0;
  const enabledInThisProcess = fence.enabledBootId === bootId;
  const notReadyReasons: string[] = [];
  if (!legacyEnforced) notReadyReasons.push('this build does not enforce the legacy-writer fence');
  if (!fence.quiesced) notReadyReasons.push('gate is not enabled');
  if (fence.quiesced && !enabledInThisProcess) {
    notReadyReasons.push('gate was enabled by a different process; re-run enable so drain is observed here');
  }
  if (completionsInFlight > 0) notReadyReasons.push(`${completionsInFlight} completion(s) in flight`);
  if (deferredGhostWritesInFlight > 0) notReadyReasons.push(`${deferredGhostWritesInFlight} deferred Ghost write(s) in flight`);
  if (decayInFlight) notReadyReasons.push('weekly decay in flight');
  const drained = completionsInFlight === 0 && deferredGhostWritesInFlight === 0 && !decayInFlight;
  return {
    enforcement: legacyEnforced ? 'legacy_writers' : 'atomic_writers',
    quiesced: fence.quiesced,
    quiescedAt: fence.quiescedAt,
    reason: fence.reason,
    release,
    bootId,
    bootedAt,
    enabledInThisProcess,
    completionsInFlight,
    deferredGhostWritesInFlight,
    decayInFlight,
    rejectedSinceBoot: counters.rejected,
    newUnsafeOperationsCanStart: legacyEnforced && !fence.quiesced,
    drained,
    readyForExpand: notReadyReasons.length === 0,
    notReadyReasons,
    ghostExpandAppliedAt: fence.ghostExpandAppliedAt,
  };
}

/** Durable toggle. Enabling stamps this process so drain evidence is only valid from it. */
export async function setRatingCutoverQuiesced(
  enabled: boolean,
  reason: string | null,
): Promise<CutoverFence> {
  const patch = enabled
    ? { quiesced: true, quiesced_at: new Date().toISOString(), enabled_boot_id: bootId, reason }
    : { quiesced: false, reason };
  const rows = await supabaseFetch<FenceRow[]>(
    `${FENCE_PATH}&select=${FENCE_SELECT}`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) },
  );
  const row = rows[0];
  if (!row) throw new Error('rating_cutover_gate row is missing; apply 2026-10-13_rating_cutover_gate.sql');
  log.warn({ enabled, reason, bootId }, 'rating cutover gate changed');
  return toFence(row);
}

export function getRatingCutoverCountersForTests(): Readonly<typeof counters> {
  return { ...counters };
}

export function setLegacyRatingWritersEnforcedForTests(value: boolean): void {
  legacyEnforced = value;
}

export function resetRatingCutoverGateForTests(): void {
  legacyEnforced = LEGACY_RATING_WRITERS_ENFORCED;
  counters.completions = 0;
  counters.deferredGhostWrites = 0;
  counters.decayRuns = 0;
  counters.rejected = 0;
}
