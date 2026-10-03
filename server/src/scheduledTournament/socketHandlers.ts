import type { Server, Socket } from 'socket.io';
import {
  fetchBracketView,
  registerForTournament,
  REGISTRATION_RPC_ERRORS,
  withdrawFromTournament,
} from './persistence';
import { TOURNAMENT_CONFIG } from './engine';
import {
  getSocketUserId,
  rejectMismatchedPayloadUserId,
} from './tournamentAuth';

type Ack = (resp: unknown) => void;

/** The RPC's stable code, or 'internal' for anything unexpected. */
function registrationErrorCode(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  return REGISTRATION_RPC_ERRORS.has(message) ? message : 'internal';
}

function authErrorAck(ack: Ack | undefined, error: string): void {
  ack?.({ ok: false, error });
}

export function registerTournamentSocketHandlers(io: Server, socket: Socket): void {
  socket.on('tournament:register', async (
    payload: { tournamentId?: string; userId?: string },
    ack?: Ack,
  ) => {
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
      io.emit('tournament:registration_updated', { tournamentId });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: registrationErrorCode(err) });
    }
  });

  socket.on('tournament:withdraw', async (
    payload: { tournamentId?: string; userId?: string },
    ack?: Ack,
  ) => {
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
      io.emit('tournament:registration_updated', { tournamentId });
      ack?.({ ok: true });
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
    try {
      if (!payload?.tournamentId) { ack?.({ ok: false, error: 'missing_args' }); return; }
      const view = await fetchBracketView(payload.tournamentId);
      ack?.({ ok: true, view });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'internal' });
    }
  });

  // Keep the import alive so tree-shaking doesn't drop the TOURNAMENT_CONFIG export.
  void TOURNAMENT_CONFIG;
}
