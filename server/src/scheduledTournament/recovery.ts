import type { Server } from 'socket.io';
import { isTournamentPastActiveWindow } from './activeWindow';
import { dispatchTournamentMatch } from './matchDispatch';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';

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
      console.log('[tournament:recovery] skipped-stale', {
        tournamentId: tournament.id,
        reason: 'tournament_past_active_window',
        scheduledStart: tournament.scheduled_start,
      });
      continue;
    }
    const matches = await persistence.fetchMatches(tournament.id);
    const startMs = Date.parse(tournament.scheduled_start);
    for (const match of matches) {
      if (
        match.status === 'completed' ||
        match.status === 'bye' ||
        match.completed_at ||
        match.winner_id
      ) {
        console.log('[tournament:recovery] skipped-completed', {
          tournamentId: tournament.id,
          matchId: match.id,
          roomCode: match.room_code,
        });
        continue;
      }
      if (match.status === 'ready') {
        if (Date.now() < startMs && !match.ready_at) continue;
        await dispatchTournamentMatch(io, match.id, { reason: 'recovery', emitIfAlreadyReady: true }, persistence);
        readyRecovered += 1;
        console.log('[tournament:recovery] ready match recovered', {
          tournamentId: tournament.id,
          matchId: match.id,
          roomCode: match.room_code,
        });
        continue;
      }

      if (match.status === 'in_progress' && match.room_code) {
        try {
          persistence.getRoom(match.room_code);
        } catch {
          await dispatchTournamentMatch(io, match.id, { reason: 'recovery', emitIfAlreadyReady: true }, persistence);
          inProgressRecovered += 1;
          console.log('[tournament:recovery] in-progress room recreated', {
            tournamentId: tournament.id,
            matchId: match.id,
            roomCode: match.room_code,
          });
        }
      }
    }
  }

  return { readyRecovered, inProgressRecovered };
}
