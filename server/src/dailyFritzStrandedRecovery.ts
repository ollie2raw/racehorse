import { processTimeout, processInterval } from './platform/processLifecycle';
import { childLogger } from './logger';
import { withDailyFritzAttemptLock } from './dailyFritzAttemptLock';
import {
  getDailyFritzAttemptById,
  invalidateDailyFritzLeaderboard,
  listStrandedDailyFritzAttempts,
  upsertDailyFritzAttempt,
} from './http/stores/dailyFritzStore';
import { classifyDailyFritzRecovery, type DailyFritzRecoveryCandidate } from './dailyFritzRecoveryEligibility';
import { applyDailyFritzAttemptFinalization } from './http/routes/dailyFritzAttemptFinalize';
import { commitDailyFritzAttemptCommand } from './http/stores/dailyFritzCommandStore';
import { incrementDailyFritzMetric } from './http/routes/dailyFritzMetrics';
import { recordDailyFritzEventBestEffort } from './http/routes/dailyFritzVerificationGlue';
import { isDailyFritzTransactionalAuthorityEnabled } from './dailyFritzAuthorityFeature';

const log = childLogger('daily-fritz-recovery');

const msg = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * DF-G1 — how long an attempt may sit `status='started'` before the reaper will
 * finalize it (if its set is complete). A best-of-3 Daily Fritz set is ~5–15 min
 * of play and the client fires `/complete` at set end; the reaper only touches
 * attempts whose set is **already complete**, so this age is not guarding an
 * active player — it is a wide margin around the client's own `/complete` retry
 * loop (which is seconds). 30 min is >100× that interval and still recovers a
 * stranded run well within the same Pacific day.
 */
export const DAILY_FRITZ_STRANDED_ATTEMPT_MIN_AGE_MS = 30 * 60_000;

/** Bounded scan per sweep — daily-mode volume is tiny; this is a safety cap. */
export const DAILY_FRITZ_STRANDED_SCAN_LIMIT = 100;

/** Periodic reaper cadence — same class as the tournament reconciler; the T-17 5-min ping keeps the process warm so this fires. */
export const DAILY_FRITZ_STRANDED_RECOVERY_INTERVAL_MS = 15 * 60_000;

/** Boot sweep delay — after the daily warmups (12s) have had a chance to run. */
export const DAILY_FRITZ_STRANDED_RECOVERY_BOOT_DELAY_MS = 20_000;

type StrandedOutcome = 'finalized' | 'skipped';
let scanAfterId: string | undefined;
let sweepRunning = false;
const failedAttempts = new Map<string, { attempts: number; retryAt: number }>();
function deferFailedAttempt(id: string, now: number): void {
  const attempts = Math.min(6, (failedAttempts.get(id)?.attempts ?? 0) + 1);
  failedAttempts.delete(id);
  failedAttempts.set(id, { attempts, retryAt: now + Math.min(6 * 60 * 60_000, 30 * 60_000 * 2 ** (attempts - 1)) });
  if (failedAttempts.size > 1000) failedAttempts.delete(failedAttempts.keys().next().value!);
}

/** Test seam; production resets the cursor only on restart or page wrap. */
export function resetDailyFritzRecoveryScanForTests(): void {
  scanAfterId = undefined;
  sweepRunning = false;
  failedAttempts.clear();
}

/**
 * Finalize Daily Fritz attempts that are stuck `status='started'` with a
 * complete set — the player finished but `/api/daily-fritz/complete` never
 * landed (client crash / network drop / server restart mid-request). Without
 * this the run is silently absent from the leaderboard + history and lost after
 * the Pacific-day reset. Mirrors `recoverTournamentMatches`.
 *
 * Idempotent: re-checks `status` under the per-attempt lock, finalizes via the
 * same path `/complete` uses, and skips anything whose set is not complete or
 * that a real `/complete` already resolved. Never promotes a `rejected` run
 * (DM-INV-11) — `applyDailyFritzAttemptFinalization` writes `legacy_unverified`
 * for those.
 */
export async function recoverStrandedDailyFritzAttempts(options?: {
  minAgeMs?: number;
  now?: number;
}): Promise<{ scanned: number; finalized: number; skipped: number }> {
  if (sweepRunning) {
    log.info({ outcome: 'already_running' }, 'sweep skipped');
    return { scanned: 0, finalized: 0, skipped: 0 };
  }
  sweepRunning = true;
  const startedAt = Date.now();
  try {
    return await runStrandedSweep(options);
  } catch (error) {
    log.warn({ durationMs: Date.now() - startedAt, outcome: 'failed', error: msg(error) }, 'sweep failed');
    throw error;
  } finally {
    sweepRunning = false;
  }
}

async function runStrandedSweep(options?: { minAgeMs?: number; now?: number }): Promise<{ scanned: number; finalized: number; skipped: number }> {
  const sweepStartedAt = Date.now();
  const minAgeMs = options?.minAgeMs ?? DAILY_FRITZ_STRANDED_ATTEMPT_MIN_AGE_MS;
  const now = options?.now ?? Date.now();
  const startedBeforeIso = new Date(now - minAgeMs).toISOString();

  let candidates: DailyFritzRecoveryCandidate[];
  try {
    candidates = await listStrandedDailyFritzAttempts(startedBeforeIso, DAILY_FRITZ_STRANDED_SCAN_LIMIT, scanAfterId);
  } catch (error) {
    log.warn({ error: msg(error) }, 'scan failed');
    throw error; // Infrastructure failures belong to the scheduler, not row classification.
  }

  let finalized = 0;
  let skipped = 0;
  let failed = 0;
  let backedOff = 0;
  for (const candidate of candidates) {
    // Incomplete and ambiguous rows remain untouched/resumable. They cause no
    // full-row refetch, write or per-row event on any subsequent sweep.
    let eligibility: ReturnType<typeof classifyDailyFritzRecovery>;
    try {
      eligibility = classifyDailyFritzRecovery(candidate.result);
    } catch (error) {
      // Defense in depth for an unforeseen classifier failure. Do not write a
      // per-row event or refetch this row; continue the page and its cursor.
      log.warn({
        attemptId: candidate.id,
        error: error instanceof Error ? error.message : 'Unexpected eligibility classification error',
      }, 'eligibility classification failed; skipping ambiguous attempt');
      skipped += 1;
      continue;
    }
    if (eligibility !== 'complete') {
      skipped += 1;
      continue;
    }
    if ((failedAttempts.get(candidate.id)?.retryAt ?? 0) > now) {
      skipped += 1;
      backedOff += 1;
      continue;
    }
    try {
      if ((await finalizeOneStrandedAttempt(candidate)) === 'finalized') finalized += 1;
      else skipped += 1;
    } catch (error) {
      if (/Supabase request (?:failed: (?:401|403|404|429|5\d\d)|timed out)|fetch failed|ECONN|ETIMEDOUT/i.test(msg(error))) throw error;
      skipped += 1;
      failed += 1;
      deferFailedAttempt(candidate.id, now);
      log.error({ attemptId: candidate.id, error: msg(error) }, 'finalize failed');
      await recordDailyFritzEventBestEffort({
        attemptId: candidate.id,
        runDate: candidate.runDate,
        userId: candidate.userId,
        eventType: 'recovery_failed',
        idempotencyKey: `${candidate.id}:recovery_failed:${Date.now()}`,
        payload: { operation: 'stranded_set_finalize', message: msg(error) },
      });
    }
  }

  scanAfterId = candidates.length === DAILY_FRITZ_STRANDED_SCAN_LIMIT ? candidates[candidates.length - 1]!.id : undefined;

  log.info({ durationMs: Date.now() - sweepStartedAt, scanned: candidates.length, finalized, skipped,
    failed, backedOff, nextPage: scanAfterId !== undefined, outcome: failed ? 'partial' : 'success' }, 'sweep complete');
  return { scanned: candidates.length, finalized, skipped };
}

async function finalizeOneStrandedAttempt(candidate: DailyFritzRecoveryCandidate): Promise<StrandedOutcome> {
  return withDailyFritzAttemptLock(candidate.id, async () => {
    const attempt = await getDailyFritzAttemptById(candidate.id, candidate.userId);
    if (!attempt || attempt.status !== 'started') return 'skipped'; // resolved elsewhere / raced a live /complete

    const finalization = applyDailyFritzAttemptFinalization(attempt, attempt.runDate);
    if (!finalization) return 'skipped'; // set not complete — player is genuinely mid-attempt

    const { isVerified, completionVerificationStatus, serverReceipt, setResult } = finalization;
    const transactional = Boolean(attempt.challengeId && isDailyFritzTransactionalAuthorityEnabled());

    if (transactional) {
      const command = await commitDailyFritzAttemptCommand<Record<string, unknown>>({
        userId: attempt.userId,
        attemptId: attempt.id,
        operationId: 'finalize:set',
        commandType: 'finalize_verified_attempt',
        expectedRevision: attempt.revision,
        next: {
          status: 'completed',
          currentGameNumber: attempt.currentGameNumber,
          currentHandIndex: attempt.currentHandIndex,
          result: attempt.result ?? {},
          finalScore: attempt.finalScore,
          opponentScore: attempt.opponentScore,
          pointDiff: attempt.pointDiff,
          won: attempt.won,
          movesUsed: attempt.movesUsed,
          handsPlayed: attempt.handsPlayed,
          completionHash: serverReceipt,
        },
        outbox: {
          eventType: 'attempt_completed',
          payload: {
            verified: isVerified,
            verification_status: completionVerificationStatus,
            finalScore: attempt.finalScore,
            opponentScore: attempt.opponentScore,
            setOutcome: `${attempt.finalScore}-${attempt.opponentScore}`,
            setWinner: setResult.setWinner ?? null,
            movesUsed: attempt.movesUsed,
            handsPlayed: attempt.handsPlayed,
            recovered: true,
          },
        },
      });
      if (command.outcome !== 'committed') {
        // Stale revision / a concurrent /complete beat us — resolved elsewhere.
        log.info({ attemptId: attempt.id, errorCode: command.errorCode }, 'finalize command not committed');
        return 'skipped';
      }
    } else {
      await upsertDailyFritzAttempt(attempt);
      await recordDailyFritzEventBestEffort({
        attemptId: attempt.id,
        runDate: attempt.runDate,
        userId: attempt.userId,
        eventType: 'attempt_completed',
        idempotencyKey: `${attempt.id}:attempt_completed:${serverReceipt}`,
        payload: {
          verified: isVerified,
          verification_status: completionVerificationStatus,
          finalScore: attempt.finalScore,
          opponentScore: attempt.opponentScore,
          movesUsed: attempt.movesUsed,
          handsPlayed: attempt.handsPlayed,
          recovered: true,
        },
      });
    }

    incrementDailyFritzMetric('attempt_completed');
    await recordDailyFritzEventBestEffort({
      attemptId: attempt.id,
      runDate: attempt.runDate,
      userId: attempt.userId,
      eventType: 'recovery_succeeded',
      idempotencyKey: `${attempt.id}:recovery_succeeded:${serverReceipt}`,
      payload: { operation: 'stranded_set_finalize', verification_status: completionVerificationStatus, verified: isVerified },
    });
    invalidateDailyFritzLeaderboard(attempt.runDate);
    log.info(
      { attemptId: attempt.id, userId: attempt.userId, runDate: attempt.runDate, verified: isVerified },
      'stranded set finalized',
    );
    return 'finalized';
  });
}

let scheduled = false;

/** Boot sweep + periodic reaper. Safe to call once at server start. */
export function scheduleStrandedDailyFritzRecovery(): void {
  if (scheduled) return;
  scheduled = true;
  processTimeout('daily-fritz-recovery', () => {
    return recoverStrandedDailyFritzAttempts().catch((error) => log.warn({ error: msg(error) }, 'boot sweep failed'));
  }, DAILY_FRITZ_STRANDED_RECOVERY_BOOT_DELAY_MS);
  processInterval('daily-fritz-recovery', () => {
    return recoverStrandedDailyFritzAttempts().catch((error) => log.warn({ error: msg(error) }, 'periodic sweep failed'));
  }, DAILY_FRITZ_STRANDED_RECOVERY_INTERVAL_MS);
}
