import { childLogger } from './logger';
import { withDailyFritzAttemptLock } from './dailyFritzAttemptLock';
import {
  getDailyFritzAttemptById,
  invalidateDailyFritzLeaderboard,
  listStrandedDailyFritzAttempts,
  upsertDailyFritzAttempt,
  type DailyFritzAttemptRecord,
} from './http/stores/dailyFritzStore';
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
  const minAgeMs = options?.minAgeMs ?? DAILY_FRITZ_STRANDED_ATTEMPT_MIN_AGE_MS;
  const now = options?.now ?? Date.now();
  const startedBeforeIso = new Date(now - minAgeMs).toISOString();

  let candidates: DailyFritzAttemptRecord[];
  try {
    candidates = await listStrandedDailyFritzAttempts(startedBeforeIso, DAILY_FRITZ_STRANDED_SCAN_LIMIT);
  } catch (error) {
    log.warn({ error: msg(error) }, 'scan failed');
    return { scanned: 0, finalized: 0, skipped: 0 };
  }

  let finalized = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    try {
      if ((await finalizeOneStrandedAttempt(candidate)) === 'finalized') finalized += 1;
      else skipped += 1;
    } catch (error) {
      skipped += 1;
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

  if (candidates.length > 0) {
    log.info({ scanned: candidates.length, finalized, skipped }, 'sweep complete');
  }
  return { scanned: candidates.length, finalized, skipped };
}

async function finalizeOneStrandedAttempt(candidate: DailyFritzAttemptRecord): Promise<StrandedOutcome> {
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
  setTimeout(() => {
    void recoverStrandedDailyFritzAttempts().catch((error) => log.warn({ error: msg(error) }, 'boot sweep failed'));
  }, DAILY_FRITZ_STRANDED_RECOVERY_BOOT_DELAY_MS);
  setInterval(() => {
    void recoverStrandedDailyFritzAttempts().catch((error) => log.warn({ error: msg(error) }, 'periodic sweep failed'));
  }, DAILY_FRITZ_STRANDED_RECOVERY_INTERVAL_MS);
}
