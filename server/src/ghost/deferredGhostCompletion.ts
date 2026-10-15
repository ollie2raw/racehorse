import { childLogger } from '../logger';
import { supabaseFetch } from '../supabaseUtils';
import { isProcessClosing, processInterval, processTimeout } from '../platform/processLifecycle';
import { isRatingCutoverQuiescedError, withRatingCompletion } from '../ranking/ratingCutoverGate';
import { completeDeferredGhostSeat, type DeferredGhostSeat } from './service';

const log = childLogger('ghost-deferred');

/**
 * Drain for `ghost_deferred_completions` (supabase/migrations/2026-10-15_ghost_precontract_deferral.sql).
 *
 * A row exists only because the legacy global `ghost_games_match_id_unique` was still present when
 * the SECOND human account of one match completed. The match itself is complete; only that seat's
 * Ghost row/rating/style is pending. Replay goes through the same idempotent RPC, so a crash between
 * the RPC and the row delete just replays a receipt.
 *
 * Request shape (nothing per match): 1 GET per sweep. With rows present and the constraint still
 * there, the first replay returns `waiting_for_contract` and the sweep stops: 2 requests per
 * interval, no row is touched, no attempt is burned.
 */
export const GHOST_DEFERRED_BOOT_DELAY_MS = 30_000;
export const GHOST_DEFERRED_INTERVAL_MS = 15 * 60_000;
export const GHOST_DEFERRED_PAGE_SIZE = 10;
export const GHOST_DEFERRED_MAX_ATTEMPTS = 10;

const SELECT =
  'user_id,match_id,final_score,opponent_score,move_log,mode,opponent_rating,apply_rating,attempts';

type DeferredRow = DeferredGhostSeat & { attempts: number };

export type GhostDeferredSweepResult = {
  scanned: number;
  completed: number;
  /** Rows left untouched because the Ghost contract has not run yet. */
  waitingForContract: boolean;
  quarantined: number;
  failed: number;
  /** Sweep stopped early on an infrastructure error / closed gate; no row attempt was consumed. */
  stoppedEarly: 'infrastructure' | 'quiesced' | 'closing' | null;
};

/** Deterministic data/contract rejections (RPC `raise exception` => 400/409/422). Everything else is infrastructure. */
export function isDeterministicDeferredGhostFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Supabase request failed: (?:400|409|422)\b/.test(message);
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500);
const keyFilter = (row: Pick<DeferredRow, 'user_id' | 'match_id'>) =>
  `user_id=eq.${encodeURIComponent(row.user_id)}&match_id=eq.${encodeURIComponent(row.match_id)}`;

let sweeping: Promise<GhostDeferredSweepResult> | null = null;

export function drainDeferredGhostCompletions(): Promise<GhostDeferredSweepResult> {
  if (sweeping) return sweeping;
  sweeping = runSweep().finally(() => {
    sweeping = null;
  });
  return sweeping;
}

async function runSweep(): Promise<GhostDeferredSweepResult> {
  const result: GhostDeferredSweepResult = {
    scanned: 0,
    completed: 0,
    waitingForContract: false,
    quarantined: 0,
    failed: 0,
    stoppedEarly: null,
  };
  const rows = await supabaseFetch<DeferredRow[]>(
    `/rest/v1/ghost_deferred_completions?select=${SELECT}&quarantined_at=is.null` +
      `&order=last_attempt_at.asc.nullsfirst,created_at.asc&limit=${GHOST_DEFERRED_PAGE_SIZE}`,
    { method: 'GET' },
  );
  result.scanned = rows.length;
  for (const row of rows) {
    if (isProcessClosing()) {
      result.stoppedEarly = 'closing';
      break;
    }
    try {
      const outcome = await withRatingCompletion('ghost_deferred_drain', () => completeDeferredGhostSeat(row));
      if (outcome === 'waiting_for_contract') {
        result.waitingForContract = true;
        break; // nothing can change until the contract migration runs: do not touch the other rows
      }
      await supabaseFetch(`/rest/v1/ghost_deferred_completions?${keyFilter(row)}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      });
      result.completed += 1;
    } catch (error) {
      if (isRatingCutoverQuiescedError(error)) {
        result.stoppedEarly = 'quiesced';
        break;
      }
      if (!isDeterministicDeferredGhostFailure(error)) {
        // Network/DB/auth/5xx/timeout: recoverable, so it must never spend the permanent row budget.
        log.warn({ userId: row.user_id, matchId: row.match_id, error: errorText(error) }, 'deferred ghost replay infrastructure failure; will retry');
        result.stoppedEarly = 'infrastructure';
        break;
      }
      result.failed += 1;
      const attempts = row.attempts + 1;
      const quarantine = attempts >= GHOST_DEFERRED_MAX_ATTEMPTS;
      if (quarantine) result.quarantined += 1;
      log.error({ userId: row.user_id, matchId: row.match_id, attempts, quarantine, error: errorText(error) }, 'deferred ghost replay rejected');
      await supabaseFetch(`/rest/v1/ghost_deferred_completions?${keyFilter(row)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          attempts,
          last_attempt_at: new Date().toISOString(),
          last_error: errorText(error),
          ...(quarantine ? { quarantined_at: new Date().toISOString() } : {}),
        }),
      }).catch((patchError) =>
        log.warn({ userId: row.user_id, matchId: row.match_id, error: errorText(patchError) }, 'could not record deferred ghost failure'),
      );
    }
  }
  if (result.scanned > 0) log.info(result, 'deferred ghost sweep');
  return result;
}

let scheduled = false;

/**
 * On unless GHOST_DEFERRED_DRAIN_ENABLED is exactly "false". Timers are process-owned: cancelled at
 * shutdown admission, and an admitted sweep is counted until it settles.
 */
export function scheduleDeferredGhostDrain(): void {
  if (scheduled) return;
  if (process.env.GHOST_DEFERRED_DRAIN_ENABLED === 'false') {
    log.info('deferred ghost drain DISABLED (GHOST_DEFERRED_DRAIN_ENABLED=false)');
    return;
  }
  scheduled = true;
  const sweep = () =>
    drainDeferredGhostCompletions().catch((error) => log.warn({ error: errorText(error) }, 'deferred ghost sweep failed'));
  processTimeout('ghost-deferred-drain', sweep, GHOST_DEFERRED_BOOT_DELAY_MS);
  processInterval('ghost-deferred-drain', sweep, GHOST_DEFERRED_INTERVAL_MS);
}

export function resetDeferredGhostDrainForTests(): void {
  scheduled = false;
  sweeping = null;
}
