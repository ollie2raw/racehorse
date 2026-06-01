import type { Server, Socket } from 'socket.io';
import {
  fetchActiveRegistration,
  fetchBracketView,
  fetchTournamentById,
  insertRegistration,
  withdrawRegistration,
  fetchRegistrations,
} from './persistence';
import { TOURNAMENT_CONFIG } from './engine';
import {
  getSocketUserId,
  rejectMismatchedPayloadUserId,
} from './tournamentAuth';

type Ack = (resp: unknown) => void;

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
      const t = await fetchTournamentById(tournamentId);
      if (!t) { authErrorAck(ack, 'tournament_not_found'); return; }
      if (t.status !== 'registration_open') {
        authErrorAck(ack, 'registration_closed');
        return;
      }
      const regs = await fetchRegistrations(tournamentId);
      if (regs.filter((r) => r.status === 'registered').length >= t.max_players) {
        authErrorAck(ack, 'full');
        return;
      }
      const existing = await fetchActiveRegistration(tournamentId, authenticatedUserId);
      if (existing && existing.status === 'registered') {
        ack?.({ ok: true, alreadyRegistered: true });
        return;
      }
      await insertRegistration(tournamentId, authenticatedUserId);
      io.emit('tournament:registration_updated', { tournamentId });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'internal' });
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
      const t = await fetchTournamentById(tournamentId);
      if (!t) { authErrorAck(ack, 'tournament_not_found'); return; }
      if (t.status !== 'registration_open' && t.status !== 'upcoming') {
        authErrorAck(ack, 'cannot_withdraw_after_start');
        return;
      }
      await withdrawRegistration(tournamentId, authenticatedUserId);
      io.emit('tournament:registration_updated', { tournamentId });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'internal' });
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
