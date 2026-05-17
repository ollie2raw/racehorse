import type { ScheduledTournamentRow } from './types';

// First-release guardrail: a scheduled tournament should not remain attachable
// forever if it never completed. After this window, recovery skips it and the
// scheduler cancels it on the next tick.
export const TOURNAMENT_ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

export function isTournamentPastActiveWindow(
  tournament: Pick<ScheduledTournamentRow, 'status' | 'scheduled_start' | 'winner_id'>,
  nowMs = Date.now(),
): boolean {
  if (tournament.status !== 'in_progress') return false;
  if (tournament.winner_id) return false;
  const scheduledStartMs = Date.parse(tournament.scheduled_start);
  if (!Number.isFinite(scheduledStartMs)) return false;
  return scheduledStartMs < nowMs - TOURNAMENT_ACTIVE_WINDOW_MS;
}

