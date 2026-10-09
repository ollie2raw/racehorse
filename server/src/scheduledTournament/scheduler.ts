import * as Sentry from '@sentry/node';
import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { config } from '../config';
import { isTournamentPastActiveWindow } from './activeWindow';
import { fetchDueLifecycleTournaments, fetchTournamentsByStatus } from './persistence';
import {
  openRegistration,
  closeRegistrationAndStart,
  reconcileExpiredReadyMatches,
  dispatchScheduledStartMatches,
  cancelTournamentBeforeStart,
} from './engine';
import { alertTournamentAnomaly, alertTournamentStepFailed, clearTournamentStepAlert, type TournamentStep } from './tournamentAlerts';
import { supabaseFetch } from '../supabaseUtils';
import {
  databaseLeaseBackend,
  makeOrchestratorOwnerId,
  OrchestratorLease,
  orchestratorLeaseTtlMs,
} from './orchestratorLease';

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
    failures.delete(tournamentId);
    // Only a tournament still in registration is cancelled: another starter
    // (e.g. the Fritz Cup route) may have started it despite these failures.
    const cancelled = await cancelTournamentBeforeStart(io, tournamentId, undefined, `bracket_generation_failed:${code}`);
    if (!cancelled) {
      log.warn({ tournamentId, attempts }, 'close-and-start kept failing, but the tournament already left registration: not cancelled');
      return { started: false, reason: 'already_left_registration' };
    }
    Sentry.captureMessage('[tournament] bracket could not be created — cancelled', {
      level: 'error',
      fingerprint: ['tournament-close-start-failed', tournamentId],
      tags: {
        tournament_alert: 'close_start_failed',
        tournament_id: tournamentId,
        error_code: code,
      },
      extra: { tournamentId, attempts, error: code },
    });
    return { started: false, reason: 'cancelled_after_failures', cancelled: true };
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let activeLease: OrchestratorLease | null = null;
let activeIo: Server | null = null;
/** The orchestration operation in flight (at most one per process). */
let inFlight: Promise<OrchestrationOutcome> | null = null;
let draining = false;
let lastSeedAtMs = 0;
let skippedOverlappingTicks = 0;

export type OrchestrationOutcome =
  | 'standby'          // another process owns the lease: nothing done
  | 'completed'        // a full tick ran as owner
  | 'lease_lost'       // ownership ended between stages: the rest was skipped
  | 'skipped_in_flight'
  | 'draining';

/**
 * Tournament orchestration (registration open/close, scheduled-start
 * dispatch, the expired-tournament backstop, the no-show / match-cap
 * reconciler, the seed fallback, and boot recovery) runs only in the process
 * holding the `tournament_orchestrator` lease (orchestratorLease.ts, M3), and
 * at most one operation at a time per process:
 *
 *  - every 30 s: if a previous tick is still running, this one is skipped
 *    (counted, never queued);
 *  - otherwise ensure ownership: a standby process does nothing; a process
 *    that just acquired a NEW epoch runs boot recovery for it first;
 *  - the stages then run in order — recovery (new epoch), seed fallback
 *    (first tick of an epoch, then every 6 h), lifecycle, in-progress
 *    (start dispatch / backstop), reconcile — and ownership of the same epoch
 *    is re-checked before each stage and before each tournament within a
 *    stage; once it is lost the tick stops (no release; the new owner goes on).
 *
 * The lease prevents duplicate orchestration in normal operation. It does not
 * fence a database write already issued: those writes are compare-and-set,
 * row-locked or idempotent on their own (Phase 2C prerequisite), so one
 * finishing after the lease moved is harmless. It is not Socket.IO room
 * ownership.
 *
 * Gated on `TOURNAMENT_SCHEDULER_ENABLED` (default true): a process with it
 * off never competes for the lease.
 */
export function startTournamentScheduler(
  io: Server,
  opts: { lease?: OrchestratorLease } = {},
): void {
  if (timer) return;
  if (!config.tournamentSchedulerEnabled) {
    log.info(
      { flag: 'TOURNAMENT_SCHEDULER_ENABLED', value: false },
      'tournament scheduler + no-show reconciler disabled on this instance — not ticking',
    );
    return;
  }
  activeIo = io;
  draining = false;
  lastSeedAtMs = 0;
  activeLease = opts.lease ?? new OrchestratorLease({
    backend: databaseLeaseBackend(),
    ownerId: makeOrchestratorOwnerId(),
    ttlMs: orchestratorLeaseTtlMs(),
  });
  log.info({ owner: activeLease.ownerId }, 'tournament orchestrator started (lease-gated)');
  // One immediate tick so a due tournament catches up at boot.
  void runOrchestrationTick();
  timer = setInterval(() => { void runOrchestrationTick(); }, TICK_INTERVAL_MS);
}

/** One scheduler tick (exported for tests). Never runs two at once in this process. */
export function runOrchestrationTick(): Promise<OrchestrationOutcome> {
  if (draining) return Promise.resolve('draining');
  if (inFlight) {
    skippedOverlappingTicks += 1;
    log.warn({ skippedOverlappingTicks }, 'tournament tick skipped: the previous one is still running');
    return Promise.resolve('skipped_in_flight');
  }
  const io = activeIo;
  const lease = activeLease;
  if (!io || !lease) return Promise.resolve('standby');
  const run = orchestrate(io, lease).catch((err): OrchestrationOutcome => {
    log.warn({ err }, 'scheduler tick failed');
    return 'completed';
  });
  inFlight = run;
  void run.finally(() => { if (inFlight === run) inFlight = null; });
  return run;
}

/** Resolves once no orchestration operation is in flight (tests). */
export async function whenOrchestrationIdle(): Promise<void> {
  while (inFlight) await inFlight;
}

/**
 * Consecutive ticks whose lease call failed (not refused: errored, e.g. the
 * M3 RPCs missing or the database unreachable). No process orchestrates while
 * this lasts, so it alerts once it has lasted three ticks.
 */
export const LEASE_UNAVAILABLE_ALERT_AFTER_TICKS = 3;
let consecutiveLeaseErrors = 0;

async function orchestrate(io: Server, lease: OrchestratorLease): Promise<OrchestrationOutcome> {
  let ownership: Awaited<ReturnType<OrchestratorLease['ensure']>>;
  try {
    ownership = await lease.ensure();
    consecutiveLeaseErrors = 0;
  } catch (err) {
    consecutiveLeaseErrors += 1;
    log.warn({ err, consecutiveLeaseErrors }, 'orchestrator lease call failed: this process stands by');
    if (consecutiveLeaseErrors >= LEASE_UNAVAILABLE_ALERT_AFTER_TICKS) {
      alertTournamentAnomaly('orchestrator_lease_unavailable', {}, {
        consecutiveTicks: consecutiveLeaseErrors,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return 'standby';
  }
  if (!ownership.held) return 'standby';
  const token = ownership.token;
  const stillOwner = () => lease.holds(token);

  // Stage 1 — boot / takeover recovery, once per ownership epoch.
  if (ownership.newEpoch) {
    try {
      const { recoverTournamentMatches } = await import('./recovery');
      await recoverTournamentMatches(io, undefined, { shouldContinue: stillOwner });
    } catch (err) {
      log.warn({ err }, 'recovery for the new orchestrator epoch failed');
    }
  }
  if (!stillOwner()) return 'lease_lost';

  // Stage 2 — seed fallback (pg_cron may also run it: the function is idempotent).
  const now = Date.now();
  if (ownership.newEpoch || now - lastSeedAtMs >= SEED_INTERVAL_MS) {
    lastSeedAtMs = now;
    await callEnsureSeedWindow();
  }
  if (!stillOwner()) return 'lease_lost';

  // Stage 3 — registration lifecycle.
  const tournaments = await fetchDueLifecycleTournaments(new Date(now));
  for (const t of tournaments) {
    if (!stillOwner()) return 'lease_lost';
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
  if (!stillOwner()) return 'lease_lost';

  // Stage 4 — in-progress events: start dispatch, or the expired-event backstop.
  const inProgress = await fetchTournamentsByStatus(['in_progress']);
  for (const t of inProgress) {
    if (!stillOwner()) return 'lease_lost';
    // One tournament must not stop the others, or this tick's reconcile below.
    let tournamentFailed = false;
    let step: TournamentStep = 'start_dispatch';
    try {
      if (isTournamentPastActiveWindow(t, now)) {
        step = 'event_expiry';
        log.info({ tournamentId: t.id, scheduledStart: t.scheduled_start, ageMs: now - Date.parse(t.scheduled_start) }, 'finishing expired tournament through the result path');
        // Finishes the event round by round; cancels only if its rows are
        // unrecoverable (see eventBackstop.ts). No next-match dispatch.
        // Loaded on use: it pulls in room dispatch, which this module does not need otherwise.
        const { resolveExpiredTournament } = await import('./eventBackstop');
        await resolveExpiredTournament(io, t.id, undefined, new Date(now), t);
        continue;
      }
      const startAt = Date.parse(t.scheduled_start);
      if (now >= startAt) {
        await dispatchScheduledStartMatches(io, t.id, undefined, new Date(now));
      }
    } catch (err) {
      tournamentFailed = true;
      alertTournamentStepFailed(step, t.id, err);
    } finally {
      if (!tournamentFailed) clearTournamentStepAlert(step, t.id);
    }
  }
  if (!stillOwner()) return 'lease_lost';

  // Stage 5 — no-show / match-cap reconciler (handed the set just read).
  await reconcileExpiredReadyMatches(io, new Date(now), undefined, inProgress, { shouldContinue: stillOwner });
  return stillOwner() ? 'completed' : 'lease_lost';
}

/**
 * Graceful shutdown: stop new ticks and acquisitions, let the operation in
 * flight finish (the heartbeat keeps the lease alive meanwhile), then release
 * the lease — only if the operation finished within `timeoutMs` and this
 * process still holds the same epoch. On timeout nothing is released: the
 * process exits and the lease expires by TTL. Never releases a newer epoch.
 */
export async function drainTournamentOrchestrator(
  opts: { timeoutMs: number },
): Promise<{ drained: boolean; released: boolean }> {
  draining = true;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  const lease = activeLease;
  const running = inFlight;
  let drained = true;
  if (running) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    drained = await Promise.race([
      running.then(() => true, () => true),
      new Promise<boolean>((resolve) => { timeoutHandle = setTimeout(() => resolve(false), opts.timeoutMs); }),
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
  if (!lease) return { drained, released: false };
  if (!drained) {
    log.warn({ owner: lease.ownerId }, 'orchestration did not finish before the shutdown deadline: lease left to expire by TTL');
    return { drained, released: false };
  }
  const released = await lease.release();
  return { drained, released };
}

export function stopTournamentScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  activeLease?.stopHeartbeat();
  activeLease = null;
  activeIo = null;
  inFlight = null;
  draining = false;
  consecutiveLeaseErrors = 0;
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
