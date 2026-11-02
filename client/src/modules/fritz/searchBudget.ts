/**
 * How long Fritz's exhaustive searches may run.
 *
 * Until now every bound was a wall-clock deadline, so how deep Fritz looked depended on the device and on what else
 * the machine was doing: the same position could get a different move on a slow phone, and the review-engine studies
 * over the recorded corpus jittered between runs. A node budget counts work instead of time, so the same position
 * always gets the same search. It is off by default (the time budget is the shipped behaviour) until the strength
 * change has been calibrated and approved; see docs/fritz-node-budget.md.
 */

export type SearchBudgetMode = 'time' | 'nodes';

export interface SearchBudget {
  /** Count one unit of work and report whether the budget has run out. Once true it stays true. */
  exhausted(): boolean;
  /** Units of work counted so far (nodes in node mode, checks in time mode). */
  readonly used: number;
}

export const UNLIMITED_BUDGET: SearchBudget = { exhausted: () => false, used: 0 };

/**
 * Checks per millisecond the time budgets (90 ms master endgame, 45 ms exact chain) actually allowed on the development
 * laptop: the median of the searches that ran out of time, 86 (p10 51, p90 112), in scripts/fritzNodeBudgetCalibration.ts.
 * Node budgets are `ms * NODES_PER_MS`; recalibrate by rerunning that script.
 */
export const NODES_PER_MS = 85;

let mode: SearchBudgetMode = import.meta.env?.VITE_FRITZ_NODE_BUDGET === '1' ? 'nodes' : 'time';

export function getSearchBudgetMode(): SearchBudgetMode {
  return mode;
}

/** Switch every later search; for tests, the calibration harness and the future production flag. */
export function setSearchBudgetMode(next: SearchBudgetMode): void {
  mode = next;
}

export interface SearchBudgetRecord {
  readonly budget: SearchBudget;
  readonly ms: number;
  /** Wall-clock time from creation to the last check (time mode and node mode both). */
  elapsedMs: number;
}

let statsSink: SearchBudgetRecord[] | null = null;

/** Start recording every budget created from now on; for the calibration harness. */
export function startSearchBudgetStats(): void {
  statsSink = [];
}

/** Stop recording and return what was recorded. */
export function finishSearchBudgetStats(): SearchBudgetRecord[] {
  const records = statsSink ?? [];
  statsSink = null;
  return records;
}

/** A budget equivalent to `ms` milliseconds: a deadline in time mode, `ms * NODES_PER_MS` checks in node mode. */
export function createSearchBudget(ms: number): SearchBudget {
  const created = performance.now();
  const limit = Math.round(ms * NODES_PER_MS);
  const deadline = created + ms;
  let record: SearchBudgetRecord | null = null;
  const budget: SearchBudget & { used: number } = {
    used: 0,
    exhausted(): boolean {
      budget.used += 1;
      if (record) record.elapsedMs = performance.now() - created;
      return mode === 'nodes' ? budget.used > limit : performance.now() > deadline;
    },
  };
  if (statsSink) {
    record = { budget, ms, elapsedMs: 0 };
    statsSink.push(record);
  }
  return budget;
}
