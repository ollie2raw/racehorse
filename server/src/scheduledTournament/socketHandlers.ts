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

type Ack = (resp: unknown) => void;

export function registerTournamentSocketHandlers(io: Server, socket: Socket): void {
  socket.on('tournament:register', async (
    payload: { tournamentId?: string; userId?: string },
    ack?: Ack,
  ) => {
    try {
      const { tournamentId, userId } = payload ?? {};
      if (!tournamentId || !userId) { ack?.({ ok: false, error: 'missing_args' }); return; }
      const t = await fetchTournamentById(tournamentId);
      if (!t) { ack?.({ ok: false, error: 'tournament_not_found' }); return; }
      if (t.status !== 'registration_open') {
        ack?.({ ok: false, error: 'registration_closed' });
        return;
      }
      const regs = await fetchRegistrations(tournamentId);
      if (regs.filter((r) => r.status === 'registered').length >= t.max_players) {
        ack?.({ ok: false, error: 'full' });
        return;
      }
      const existing = await fetchActiveRegistration(tournamentId, userId);
      if (existing && existing.status === 'registered') {
        ack?.({ ok: true, alreadyRegistered: true });
        return;
      }
      await insertRegistration(tournamentId, userId);
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
      const { tournamentId, userId } = payload ?? {};
      if (!tournamentId || !userId) { ack?.({ ok: false, error: 'missing_args' }); return; }
      const t = await fetchTournamentById(tournamentId);
      if (!t) { ack?.({ ok: false, error: 'tournament_not_found' }); return; }
      if (t.status !== 'registration_open' && t.status !== 'upcoming') {
        ack?.({ ok: false, error: 'cannot_withdraw_after_start' });
        return;
      }
      await withdrawRegistration(tournamentId, userId);
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
