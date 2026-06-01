import type { Server, Socket } from 'socket.io';
import type { Express } from 'express';
import { registerTournamentSocketHandlers } from './socketHandlers';
import { registerTournamentRoutes } from './routes';
import { startTournamentScheduler } from './scheduler';
import { recoverTournamentMatches } from './recovery';

export {
  applyMatchResult,
  applyTournamentGameOverFromRoom,
  findTournamentMatchByRoom,
  TOURNAMENT_CONFIG,
} from './engine';
export type { MatchRow, ScheduledTournamentRow, RegistrationRow, BracketView } from './types';

let infrastructureInitialized = false;

/**
 * REST routes and the tournament scheduler must exist before any socket connects.
 * Previously these were registered on first socket.io connection, so cold HTTP
 * clients (Vercel, curl, UptimeRobot) could hang or 404 while sockets never fired.
 */
export function bootstrapScheduledTournamentInfrastructure(io: Server, app: Express): void {
  if (infrastructureInitialized) return;
  infrastructureInitialized = true;
  registerTournamentRoutes(app);
  startTournamentScheduler(io);
  setTimeout(() => {
    void recoverTournamentMatches(io).catch((error) => {
      console.warn(
        '[tournament:recovery] startup recovery failed',
        error instanceof Error ? error.message : error,
      );
    });
  }, 2_000);
}

/**
 * Wire scheduled tournaments into the server. Safe to call once per socket
 * connection (handlers attach to the socket).
 */
export function initScheduledTournaments(io: Server, app: Express, socket: Socket): void {
  registerTournamentSocketHandlers(io, socket);
  bootstrapScheduledTournamentInfrastructure(io, app);
}
