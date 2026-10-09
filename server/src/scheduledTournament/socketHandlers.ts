import type { Server, Socket } from 'socket.io';
import {
  fetchBracketView,
  fetchTournamentById,
  registerForTournament,
  overlapConflictPayload,
  REGISTRATION_RPC_ERRORS,
  withdrawFromTournament,
} from './persistence';
import { TOURNAMENT_CONFIG } from './engine';
import {
  getSocketUserId,
  rejectMismatchedPayloadUserId,
} from './tournamentAuth';
import { isTournamentsEnabled, TOURNAMENTS_DISABLED } from './tournamentsFeature';
import { ackWithServerNow } from './serverNow';
import { emitTournamentEvent } from './tournamentEvents';
import { childLogger } from '../logger';

const log = childLogger('tournament:socket');

type Ack = (resp: unknown) => void;

/** The RPC's stable code, or 'internal' for anything unexpected. */
function registrationErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  return REGISTRATION_RPC_ERRORS.has(message) ? message : 'internal';
}

function authErrorAck(ack: Ack | undefined, error: string): void {
  ack?.({ ok: false, error });
}

export function registerTournamentSocketHandlers(io: Server, rawSocket: Socket): void {
  // Every tournament ack carries `serverNow` (see serverNow.ts).
  const socket = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on: (event: string, handler: (payload: any, ack?: Ack) => unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rawSocket.on(event, (payload: any, ack?: Ack) => { void handler(payload, ackWithServerNow(ack)); }),
    get data() { return rawSocket.data; },
  } as unknown as Socket;
  socket.on('tournament:register', async (
    payload: { tournamentId?: string; userId?: string },
    ack?: Ack,
  ) => {
    if (!isTournamentsEnabled()) {
      ack?.(TOURNAMENTS_DISABLED);
      return;
    }
    try {
      const authenticatedUserId = getSocketUserId(socket);
      if (!authenticatedUserId) {
        authErrorAck(ack, 'not_authenticated');
        return;
      }
      const mismatch = rejectMismatchedPayloadUserId(authenticatedUserId, payload?.userId);
      if (mismatch) {
        authErrorAck(ack, mismatch);
        return;
      }
      const tournamentId = payload?.tournamentId;
      if (!tournamentId) { authErrorAck(ack, 'missing_args'); return; }
      // One locked transaction checks status, close time and the seat cap.
      const result = await registerForTournament(tournamentId, authenticatedUserId);
      if (result.already_registered) {
        ack?.({ ok: true, alreadyRegistered: true });
        return;
      }
      ack?.({ ok: true });
      // After the ack: a failed broadcast never turns a registration into an error.
      void emitTournamentEvent(io, { id: tournamentId, read: (id) => fetchTournamentById(id) }, 'tournament:registration_updated', {})
        .catch((err) => log.warn({ err, tournamentId }, 'registration_updated not sent'));
    } catch (err) {
      const error = registrationErrorCode(err);
      ack?.({ ok: false, error, ...(error === 'overlapping_tournament' ? { conflict: overlapConflictPayload(err) } : {}) });
    }
  });

  socket.on('tournament:withdraw', async (
    payload: { tournamentId?: string; userId?: string },
    ack?: Ack,
  ) => {
    if (!isTournamentsEnabled()) {
      ack?.(TOURNAMENTS_DISABLED);
      return;
    }
    try {
      const authenticatedUserId = getSocketUserId(socket);
      if (!authenticatedUserId) {
        authErrorAck(ack, 'not_authenticated');
        return;
      }
      const mismatch = rejectMismatchedPayloadUserId(authenticatedUserId, payload?.userId);
      if (mismatch) {
        authErrorAck(ack, mismatch);
        return;
      }
      const tournamentId = payload?.tournamentId;
      if (!tournamentId) { authErrorAck(ack, 'missing_args'); return; }
      await withdrawFromTournament(tournamentId, authenticatedUserId);
      ack?.({ ok: true });
      // After the ack: a failed broadcast never turns a registration into an error.
      void emitTournamentEvent(io, { id: tournamentId, read: (id) => fetchTournamentById(id) }, 'tournament:registration_updated', {})
        .catch((err) => log.warn({ err, tournamentId }, 'registration_updated not sent'));
    } catch (err) {
      const code = registrationErrorCode(err);
      // Keep this handler's historical code for the closed-window case.
      ack?.({ ok: false, error: code === 'withdraw_closed' ? 'cannot_withdraw_after_start' : code });
    }
  });

  socket.on('tournament:get_bracket', async (
    payload: { tournamentId?: string },
    ack?: Ack,
  ) => {
    if (!isTournamentsEnabled()) {
      ack?.(TOURNAMENTS_DISABLED);
      return;
    }
    try {
      if (!payload?.tournamentId) { ack?.({ ok: false, error: 'missing_args' }); return; }
      const view = await fetchBracketView(payload.tournamentId);
      ack?.({ ok: true, view });
    } catch (err) {
      log.error({ err }, 'tournament:get_bracket failed');
      ack?.({ ok: false, error: 'internal' });
    }
  });

  // Keep the import alive so tree-shaking doesn't drop the TOURNAMENT_CONFIG export.
  void TOURNAMENT_CONFIG;
}
