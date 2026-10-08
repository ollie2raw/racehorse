import type { Server } from 'socket.io';
import { childLogger } from '../logger';
import { closeRegistrationAndStart, dispatchScheduledStartMatches } from './engine';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';
import { startFritzCup, type StartFritzCupResult } from './persistence';
import type { ScheduledTournamentRow } from './types';

const log = childLogger('tournament:fritz-cup');

export type FritzCupDeps = {
  startFritzCup?: (userId: string) => Promise<StartFritzCupResult>;
  persistence?: EnginePersistence;
};

export type FritzCupStart = {
  /** True when the user's already-active cup was returned (a retry, or a second tap). */
  existing: boolean;
  tournament: ScheduledTournamentRow;
  /** False when starting it failed this time; the scheduler's lifecycle tick finishes it. */
  initialized: boolean;
};

/**
 * An on-demand Fritz Cup for `userId` (the authenticated user): the database
 * creates it, or returns the user's active one (start_fritz_cup — one
 * transaction under the per-user tournament lock, with the overlap check and
 * the creation limits), then it is started through the normal engine, exactly
 * as the scheduler starts a Live Event:
 *
 *   closeRegistrationAndStart → generate_tournament_bracket (the owner + 7
 *   Fritz, bot-only quarterfinals resolved) → dispatchScheduledStartMatches
 *   (the owner's first match: room + match_ready).
 *
 * Every step is idempotent, so a retry of an interrupted start just resumes
 * it. A cup is created registration_open and already due, so if this process
 * dies (or a step fails) the scheduler's ordinary tick starts it; a start that
 * keeps failing is cancelled by the scheduler's existing escalation, after
 * which the user may create another.
 */
export async function startOrResumeFritzCup(
  io: Server,
  userId: string,
  deps: FritzCupDeps = {},
): Promise<FritzCupStart> {
  const persistence = deps.persistence ?? defaultEnginePersistence;
  const { existing, tournament } = await (deps.startFritzCup ?? startFritzCup)(userId);
  let initialized = true;
  try {
    await startCup(io, tournament, persistence);
  } catch (err) {
    initialized = false;
    log.warn({ err, tournamentId: tournament.id, existing }, 'fritz cup start failed; the scheduler tick will resume it');
  }
  const current = (await persistence.fetchTournamentById(tournament.id).catch(() => null)) ?? tournament;
  return { existing, tournament: current, initialized };
}

async function startCup(io: Server, created: ScheduledTournamentRow, persistence: EnginePersistence): Promise<void> {
  const tournament = (await persistence.fetchTournamentById(created.id)) ?? created;
  if (tournament.status === 'cancelled' || tournament.status === 'completed') return;
  if (tournament.status === 'upcoming' || tournament.status === 'registration_open') {
    await closeRegistrationAndStart(io, tournament.id, persistence);
  }
  // The cup's start is the database clock at creation: never let a slightly
  // behind server clock read it as "not yet due".
  const now = new Date(Math.max(Date.now(), Date.parse(tournament.scheduled_start) || 0));
  await dispatchScheduledStartMatches(io, tournament.id, persistence, now);
}
