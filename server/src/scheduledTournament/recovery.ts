import type { Server } from 'socket.io';
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
    const matches = await persistence.fetchMatches(tournament.id);
    for (const match of matches) {
      if (match.status === 'ready') {
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
          const room = persistence.createReservedRoom(match.room_code, { winningScore: tournament.win_target });
          room.scheduledTournamentMatchId = match.id;
          room.scheduledTournamentId = tournament.id;
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
