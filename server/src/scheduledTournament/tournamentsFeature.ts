import type { Response } from 'express';

/**
 * Live tournaments are switched off until there is real demand (2026-10-03:
 * 2 accounts ever registered, no completed event since 2026-07-09). Off
 * unless TOURNAMENTS_ENABLED is exactly "true". Read on each call.
 *
 * Off means no Supabase traffic from tournaments: no scheduler tick, no event
 * seeding, no boot recovery; register/withdraw are refused with a stable code;
 * the read endpoints answer an empty state without a query; socket handlers
 * ack `tournaments_disabled`. The client has its own flag,
 * VITE_ENABLE_TOURNAMENTS; turn both on together.
 *
 * TOURNAMENT_SCHEDULER_ENABLED keeps its own meaning (which instance runs the
 * scheduler once there are several); the scheduler runs only if both are on.
 */
export function isTournamentsEnabled(): boolean {
  return process.env.TOURNAMENTS_ENABLED === 'true';
}

export const TOURNAMENTS_DISABLED = {
  ok: false,
  error: 'tournaments_disabled',
  message: 'Tournaments are coming back soon.',
} as const;

const EMPTY_ME = {
  ok: true,
  disabled: true,
  registrations: [],
  activeAssignedMatch: null,
  currentTournamentPhase: null,
  activeTournamentId: null,
  assignedMatch: null,
  countdown: null,
} as const;

export type DisabledRouteKind = 'upcoming' | 'me' | 'my' | 'history' | 'refuse';

/**
 * Answer a tournament route while the feature is off, without touching
 * Supabase. Returns true when it answered (the handler must return).
 * Read routes old clients still call get an empty state; everything else
 * (bracket, result, register, withdraw) gets 403 tournaments_disabled.
 */
export function respondIfTournamentsDisabled(res: Response, kind: DisabledRouteKind): boolean {
  if (isTournamentsEnabled()) return false;
  switch (kind) {
    case 'upcoming':
      res.json({ ok: true, disabled: true, tournaments: [] });
      return true;
    case 'me':
      res.json(EMPTY_ME);
      return true;
    case 'my':
      res.json({ ok: true, disabled: true, registrations: [] });
      return true;
    case 'history':
      res.json({ ok: true, disabled: true, history: [] });
      return true;
    default:
      res.status(403).json(TOURNAMENTS_DISABLED);
      return true;
  }
}
