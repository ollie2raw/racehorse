import type { Server } from 'socket.io';
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
const SEED_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

let timer: ReturnType<typeof setInterval> | null = null;
let seedTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Polls every minute. For each upcoming tournament:
 *   - If now >= registration_open_at and status='upcoming' → openRegistration
 *   - If now >= registration_close_at and status='registration_open' → closeRegistrationAndStart
 *   - If now >= scheduled_start and status='in_progress' → dispatchScheduledStartMatches
 *
 * Idempotent: status transitions guarded by the current status check, so a slow
 * tick or a restart won't double-fire. No-show resolution also runs off
 * persisted deadlines here; this is acceptable for the current single-instance
 * Render deployment, but multi-instance scale needs a DB-backed lease/lock so
 * only one worker resolves expired matches.
 */
export function startTournamentScheduler(io: Server): void {
  if (timer) return;
  const tick = async () => {
    try {
      const now = Date.now();
      const tournaments = await fetchTournamentsByStatus(['upcoming', 'registration_open']);
      for (const t of tournaments) {
        const openAt = Date.parse(t.registration_open_at);
        const closeAt = Date.parse(t.registration_close_at);
        if (t.status === 'upcoming' && now >= openAt) {
          await openRegistration(io, t.id);
        } else if (t.status === 'registration_open' && now >= closeAt) {
          await closeRegistrationAndStart(io, t.id);
        }
      }
      const inProgress = await fetchTournamentsByStatus(['in_progress']);
      for (const t of inProgress) {
        if (isTournamentPastActiveWindow(t, now)) {
          console.log('[tournament:stale] cancelling expired in-progress tournament', {
            tournamentId: t.id,
            scheduledStart: t.scheduled_start,
            ageMs: now - Date.parse(t.scheduled_start),
            reason: 'past_active_window',
          });
          await cancelTournament(io, t.id);
          continue;
        }
        const startAt = Date.parse(t.scheduled_start);
        if (now >= startAt) {
          await dispatchScheduledStartMatches(io, t.id, undefined, new Date(now));
        }
      }
      await reconcileExpiredReadyMatches(io, new Date(now));
    } catch (err) {
      console.warn(
        '[tournament:scheduler] tick failed',
        err instanceof Error ? err.message : err,
      );
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
    console.warn(
      '[tournament:scheduler] auto-reseed RPC failed',
      err instanceof Error ? err.message : err,
    );
  }
}

function startSeedFallback(): void {
  if (seedTimer) return;
  // Fire once at boot so a freshly-deployed instance tops up immediately if
  // the table has drifted below the target future-slot window.
  void callEnsureSeedWindow();
  seedTimer = setInterval(() => { void callEnsureSeedWindow(); }, SEED_INTERVAL_MS);
}
