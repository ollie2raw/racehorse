import * as Sentry from '@sentry/node';
import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { config } from '../config';
import { isTournamentPastActiveWindow } from './activeWindow';
import { fetchTournamentsByStatus } from './persistence';
import {
  openRegistration,
  closeRegistrationAndStart,
  reconcileExpiredReadyMatches,
  dispatchScheduledStartMatches,
  cancelTournament,
} from './engine';
import { supabaseFetch } from '../supabaseUtils';

const TICK_INTERVAL_MS = 30_000;
const log = childLogger('tournament:scheduler');

const SEED_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Q9: a tournament whose close-and-start keeps failing (bracket generation
 * throws) used to be retried every tick forever, silently, stuck in
 * registration_open. After this many consecutive failed ticks (2.5 min at the
 * 30 s cadence) it is alerted and cancelled with a recorded reason instead.
 */
export const CLOSE_START_MAX_CONSECUTIVE_FAILURES = 5;

/** Consecutive close-and-start failures per tournament id (this process only). */
const closeStartFailures = new Map<string, number>();

/**
 * Close registration and start the bracket, escalating repeated failure.
 * Never throws for a close-and-start failure: it counts it, and on the Nth
 * consecutive failure alerts (Sentry, one issue per tournament) and cancels
 * the tournament with `bracket_generation_failed:<code>`. A success clears the
 * count. Exported for tests; `failures` defaults to the scheduler's own map.
 */
export async function closeRegistrationWithEscalation(
  io: Server,
  tournamentId: string,
  failures: Map<string, number> = closeStartFailures,
): Promise<{ started: boolean; reason?: string; cancelled?: boolean }> {
  try {
    const result = await closeRegistrationAndStart(io, tournamentId);
    failures.delete(tournamentId);
    return result;
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    const attempts = (failures.get(tournamentId) ?? 0) + 1;
    failures.set(tournamentId, attempts);
    log.warn({ err, tournamentId, attempts }, 'close-and-start failed');
    if (attempts < CLOSE_START_MAX_CONSECUTIVE_FAILURES) {
      return { started: false, reason: 'close_start_failed' };
    }
    Sentry.captureMessage('[tournament] bracket could not be created — cancelling', {
      level: 'error',
      fingerprint: ['tournament-close-start-failed', tournamentId],
      tags: {
        tournament_alert: 'close_start_failed',
        tournament_id: tournamentId,
        error_code: code,
      },
      extra: { tournamentId, attempts, error: code },
    });
    await cancelTournament(io, tournamentId, undefined, `bracket_generation_failed:${code}`);
    failures.delete(tournamentId);
    return { started: false, reason: 'cancelled_after_failures', cancelled: true };
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let seedTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Polls every minute. For each upcoming tournament:
 *   - If now >= registration_open_at and status='upcoming' → openRegistration
 *   - If now >= registration_close_at and status='registration_open' → closeRegistrationAndStart
 *   - If now >= scheduled_start and status='in_progress' → dispatchScheduledStartMatches
 *
 * Idempotent: status transitions guarded by the current status check, so a slow
 * tick or a restart won't double-fire.
 *
 * SINGLETON (D-7 / HARDENING_PLAN.md §1.4.6): this whole tick — registration
 * open/close, scheduled-start dispatch, expired-tournament cancel, AND the
 * no-show reconciler (`reconcileExpiredReadyMatches`) — must run on exactly one
 * process. The per-match RPC row lock (D-2) makes each `complete_tournament_match`
 * call safe, but it does NOT stop two instances from each *scheduling* a call
 * for different stale matches in the same tick (duplicated work + log noise).
 * Gated on `TOURNAMENT_SCHEDULER_ENABLED` (default true): Render runs one
 * instance so this is structurally moot today; when a dedicated scheduler worker
 * is split out, the flag is false on the web dynos and true on that worker.
 *
 * A pg advisory lock was evaluated and REJECTED — the server has no holdable
 * Postgres session (every DB call is PostgREST over HTTP on a different pooled
 * connection), so a session-scoped lock releases before the tick's next call.
 * Only `pg_try_advisory_xact_lock` works over PostgREST, and only inside one RPC.
 * See §1.4.6 for the full rationale so this is not re-proposed.
 */
export function startTournamentScheduler(io: Server): void {
  if (timer) return;
  if (!config.tournamentSchedulerEnabled) {
    log.info(
      { flag: 'TOURNAMENT_SCHEDULER_ENABLED', value: false },
      'tournament scheduler + no-show reconciler disabled on this instance — not ticking',
    );
    return;
  }
  const tick = async () => {
    try {
      const now = Date.now();
      const tournaments = await fetchTournamentsByStatus(['upcoming', 'registration_open']);
      for (const t of tournaments) {
        const openAt = Date.parse(t.registration_open_at);
        const closeAt = Date.parse(t.registration_close_at);
        // Per tournament: one event that cannot open or start must not stall
        // every other event in the same tick.
        try {
          if (t.status === 'upcoming' && now >= openAt) {
            await openRegistration(io, t.id);
          } else if (t.status === 'registration_open' && now >= closeAt) {
            await closeRegistrationWithEscalation(io, t.id);
          }
        } catch (err) {
          log.warn({ err, tournamentId: t.id }, 'tournament lifecycle step failed');
        }
      }
      const inProgress = await fetchTournamentsByStatus(['in_progress']);
      for (const t of inProgress) {
        if (isTournamentPastActiveWindow(t, now)) {
          log.info({ tournamentId: t.id, scheduledStart: t.scheduled_start, ageMs: now - Date.parse(t.scheduled_start) }, 'cancelling expired tournament');
          await cancelTournament(io, t.id, undefined, 'active_window_expired');
          continue;
        }
        const startAt = Date.parse(t.scheduled_start);
        if (now >= startAt) {
          await dispatchScheduledStartMatches(io, t.id, undefined, new Date(now));
        }
      }
      // Hand over the set just read rather than making the engine fetch it again.
      await reconcileExpiredReadyMatches(io, new Date(now), undefined, inProgress);
    } catch (err) {
      log.warn({ err }, 'scheduler tick failed');
    }
  };
  // Fire one immediate tick so an existing-due tournament catches up at boot.
  void tick();
  timer = setInterval(() => { void tick(); }, TICK_INTERVAL_MS);

  // Fallback for deployments where pg_cron isn't enabled: call the seed RPC
  // every 6 hours. With 30-minute tournament cadence this shortens recovery
  // time if the seed window drifts, while remaining cheap and idempotent.
  startSeedFallback();
}

export function stopTournamentScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (seedTimer) {
    clearInterval(seedTimer);
    seedTimer = null;
  }
}

/** Invoke ensure_tournament_seed_window() on Supabase via the REST RPC endpoint. */
async function callEnsureSeedWindow(): Promise<void> {
  try {
    await supabaseFetch('/rest/v1/rpc/ensure_tournament_seed_window', {
      method: 'POST',
      body: '{}',
    });
  } catch (err) {
    log.warn({ err }, 'auto-reseed RPC failed');
  }
}

function startSeedFallback(): void {
  if (seedTimer) return;
  // Fire once at boot so a freshly-deployed instance tops up immediately if
  // the table has drifted below the target future-slot window.
  void callEnsureSeedWindow();
  seedTimer = setInterval(() => { void callEnsureSeedWindow(); }, SEED_INTERVAL_MS);
}
