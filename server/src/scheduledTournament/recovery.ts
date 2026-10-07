import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { isTournamentPastActiveWindow } from './activeWindow';
import {
  alertTournamentMatchStepFailed,
  alertTournamentStepFailed,
  clearTournamentMatchStepAlert,
  clearTournamentStepAlert,
} from './tournamentAlerts';
import { recordFinishedGameIfAny } from './engine';
import { dispatchTournamentMatch } from './matchDispatch';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';

const log = childLogger('tournament:recovery');

export async function recoverTournamentMatches(
  io: Server,
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<{ readyRecovered: number; inProgressRecovered: number }> {
  const tournaments = persistence.fetchTournamentsByStatus
    ? await persistence.fetchTournamentsByStatus(['in_progress'])
    : [];
  let readyRecovered = 0;
  let inProgressRecovered = 0;

  for (const tournament of tournaments) {
    if (isTournamentPastActiveWindow(tournament)) {
      log.info({
        tournamentId: tournament.id,
        reason: 'tournament_past_active_window',
        scheduledStart: tournament.scheduled_start,
      }, 'skipped-stale');
      continue;
    }
    let tournamentFailed = false;
    try {
      const matches = await persistence.fetchMatches(tournament.id);
      const startMs = Date.parse(tournament.scheduled_start);
      for (const match of matches) {
        let matchFailed = false;
        try {
          if (
            match.status === 'completed' ||
            match.status === 'bye' ||
            match.completed_at ||
            match.winner_id
          ) {
            log.info({
              tournamentId: tournament.id,
              matchId: match.id,
              roomCode: match.room_code,
            }, 'skipped-completed');
            continue;
          }
          if (match.status === 'ready') {
            if (Date.now() < startMs && !match.ready_at) continue;
            await dispatchTournamentMatch(io, match.id, { reason: 'recovery', emitIfAlreadyReady: true }, persistence);
            readyRecovered += 1;
            log.info({
              tournamentId: tournament.id,
              matchId: match.id,
              roomCode: match.room_code,
            }, 'ready match recovered');
            continue;
          }

          if (match.status === 'in_progress' && match.room_code) {
            try {
              persistence.getRoom(match.room_code);
            } catch {
              // A game that finished before the restart is recorded from its
              // persisted final state now; a finished room is never restored.
              if (await recordFinishedGameIfAny(io, match, persistence)) {
                log.info({
                  tournamentId: tournament.id,
                  matchId: match.id,
                  roomCode: match.room_code,
                }, 'finished game recorded');
                continue;
              }
              await dispatchTournamentMatch(io, match.id, { reason: 'recovery', emitIfAlreadyReady: true }, persistence);
              inProgressRecovered += 1;
              log.info({
                tournamentId: tournament.id,
                matchId: match.id,
                roomCode: match.room_code,
              }, 'in-progress room recreated');
            }
          }
        } catch (err) {
          // One match must not stop recovery of the others.
          matchFailed = true;
          alertTournamentMatchStepFailed('recovery', match, err);
        } finally {
          if (!matchFailed) clearTournamentMatchStepAlert('recovery', match.id);
        }
      }
    } catch (err) {
      // One tournament (e.g. its matches could not be read) must not stop the others.
      tournamentFailed = true;
      alertTournamentStepFailed('recovery', tournament.id, err);
    } finally {
      if (!tournamentFailed) clearTournamentStepAlert('recovery', tournament.id);
    }
  }

  return { readyRecovered, inProgressRecovered };
}
