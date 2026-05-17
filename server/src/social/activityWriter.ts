import { supabaseFetch } from '../supabaseUtils';

type ActivityType = 'win' | 'loss' | 'streak' | 'tournament' | 'puzzle' | 'daily_fritz';

async function writeActivity(
  userId: string,
  type: ActivityType,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await supabaseFetch('/rest/v1/activity_feed', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ user_id: userId, type, metadata }),
    });
  } catch (err) {
    // Non-critical: log but never throw so callers don't fail.
    console.warn('[activityWriter] write failed', err instanceof Error ? err.message : err);
  }
}

export async function writeMatchActivity(params: {
  winnerUserId: string | null;
  loserUserId: string | null;
  winnerUsername: string;
  loserUsername: string;
  mode: string;
  winnerScore: number | null;
  loserScore: number | null;
}): Promise<void> {
  const { winnerUserId, loserUserId, winnerUsername, loserUsername, mode, winnerScore, loserScore } = params;
  const writes: Promise<void>[] = [];
  if (winnerUserId) {
    writes.push(writeActivity(winnerUserId, 'win', {
      opponent_username: loserUsername, mode, score: winnerScore, opponent_score: loserScore,
    }));
  }
  if (loserUserId) {
    writes.push(writeActivity(loserUserId, 'loss', {
      opponent_username: winnerUsername, mode, score: loserScore, opponent_score: winnerScore,
    }));
  }
  await Promise.all(writes);
}

export async function writePuzzleActivity(params: {
  userId: string;
  score: number | null;
  streak: number;
}): Promise<void> {
  const { userId, score, streak } = params;
  await writeActivity(userId, 'puzzle', { score, streak });
  if ([3, 7, 14, 30].includes(streak)) {
    await writeActivity(userId, 'streak', { streak, source: 'puzzle' });
  }
}

export async function writeDailyFritzActivity(params: {
  userId: string;
  finalScore: number | null;
  won: boolean;
  games?: Array<{
    gameNumber: number;
    playerWon: boolean;
    playerScore: number;
    fritzScore: number;
  }>;
}): Promise<void> {
  if (params.games?.length) {
    await Promise.all(
      params.games.map((game) =>
        writeActivity(params.userId, 'daily_fritz', {
          result: game.playerWon ? 'win' : 'loss',
          game_number: game.gameNumber,
          player_score: game.playerScore,
          fritz_score: game.fritzScore,
        }),
      ),
    );
    return;
  }
  await writeActivity(params.userId, 'daily_fritz', {
    score: params.finalScore,
    result: params.won ? 'win' : 'loss',
  });
}

export async function writeTournamentActivity(params: {
  userId: string;
  placement: string;
  tournamentId: string;
  tournamentName?: string;
}): Promise<void> {
  await writeActivity(params.userId, 'tournament', {
    placement: params.placement,
    tournament_id: params.tournamentId,
    tournament_name: params.tournamentName ?? 'Scheduled Tournament',
  });
}
