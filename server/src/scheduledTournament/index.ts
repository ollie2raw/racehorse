import type { Server, Socket } from 'socket.io';
import type { Express } from 'express';
import { registerTournamentSocketHandlers } from './socketHandlers';
import { registerTournamentRoutes } from './routes';
import { startTournamentScheduler } from './scheduler';

export { applyMatchResult, findTournamentMatchByRoom, TOURNAMENT_CONFIG } from './engine';
export type { MatchRow, ScheduledTournamentRow, RegistrationRow, BracketView } from './types';

let initialized = false;

/**
 * Wire scheduled tournaments into the server. Safe to call once per socket
 * connection (handlers attach to the socket). Routes + scheduler are
 * registered only on the first call.
 */
export function initScheduledTournaments(io: Server, app: Express, socket: Socket): void {
  registerTournamentSocketHandlers(io, socket);
  if (initialized) return;
  initialized = true;
  registerTournamentRoutes(app);
  startTournamentScheduler(io);
}
