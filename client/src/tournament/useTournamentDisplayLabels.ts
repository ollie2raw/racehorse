import { useState, useEffect } from 'react';
import type { TournamentMatchContext } from '../match/session/tournament/tournamentMatchSessionTypes';
import type { UserProfile } from '../auth/useAuth';
import { reportOptionalChunkFailure } from '../utils/optionalChunk';

type RoomPlayer = { id: string; username: string; userId: string | null };

export type UseTournamentDisplayLabelsParams = {
  tournamentMatch: TournamentMatchContext | null;
  players: RoomPlayer[];
  you: string;
  authProfile: UserProfile | null;
};

export type UseTournamentDisplayLabelsResult = {
  tournamentOpponentLabel: string | null;
  tournamentMyLabel: string;
};

export function useTournamentDisplayLabels(
  params: UseTournamentDisplayLabelsParams,
): UseTournamentDisplayLabelsResult {
  const { tournamentMatch, players, you, authProfile } = params;

  const [tournamentOpponentLabel, setTournamentOpponentLabel] = useState<string | null>(null);

  const opponentInRoom = players.find((pl) => pl.id !== you) ?? null;

  useEffect(() => {
    if (!tournamentMatch) {
      setTournamentOpponentLabel(null);
      return;
    }

    let cancelled = false;
    void import('./displayNames').then(({ resolveTournamentOpponentLabel }) => {
      if (cancelled) return;
      setTournamentOpponentLabel(
        resolveTournamentOpponentLabel({
          opponentUserId: tournamentMatch.opponentUserId,
          opponentUsername: tournamentMatch.opponentUsername,
          round: tournamentMatch.round,
          roomOpponentUsername: opponentInRoom?.username ?? null,
        }),
      );
    })
      .catch((error) => reportOptionalChunkFailure('./displayNames', error));

    return () => {
      cancelled = true;
    };
  }, [
    opponentInRoom?.username,
    tournamentMatch?.opponentUserId,
    tournamentMatch?.opponentUsername,
    tournamentMatch?.round,
    tournamentMatch,
  ]);

  const tournamentMyLabel = authProfile?.username
    ? authProfile.username.replace(/^@/, '')
    : 'You';

  return { tournamentOpponentLabel, tournamentMyLabel };
}
