import type { Server } from 'socket.io';
import { fetchTournamentsByStatus } from './persistence';
import { openRegistration, closeRegistrationAndStart } from './engine';

const TICK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

/**
 * Polls every minute. For each upcoming tournament:
 *   - If now >= registration_open_at and status='upcoming' → openRegistration
 *   - If now >= registration_close_at and status='registration_open' → closeRegistrationAndStart
 *
 * Idempotent: status transitions guarded by the current status check, so a slow
 * tick or a restart won't double-fire.
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
}

export function stopTournamentScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
