import { isDailyFritzSkunk } from '../dailyFritzSkunk';
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

function buildBotMatchActivityMetadata(params: {
  mode: string;
  fritzTier?: string | null;
  isWinnerRow: boolean;
  score: number | null;
  opponentScore: number | null;
}): Record<string, unknown> {
  if (params.mode !== 'bot') return {};
  const metadata: Record<string, unknown> = {};
  const tier = typeof params.fritzTier === 'string' ? params.fritzTier.trim().toLowerCase() : '';
  if (tier) metadata.fritz_tier = tier;
  const losingScore = params.isWinnerRow ? params.opponentScore : params.score;
  if (losingScore != null && isDailyFritzSkunk(losingScore)) {
    metadata.skunk = true;
    metadata.skunk_by = params.isWinnerRow ? 'player' : 'fritz';
  }
  return metadata;
}

export async function writeMatchActivity(params: {
  winnerUserId: string | null;
  loserUserId: string | null;
  winnerUsername: string;
  loserUsername: string;
  mode: string;
  winnerScore: number | null;
  loserScore: number | null;
  fritzTier?: string | null;
}): Promise<void> {
  const { winnerUserId, loserUserId, winnerUsername, loserUsername, mode, winnerScore, loserScore, fritzTier } = params;
  const writes: Promise<void>[] = [];
  if (winnerUserId) {
    writes.push(writeActivity(winnerUserId, 'win', {
      opponent_username: loserUsername,
      mode,
      score: winnerScore,
      opponent_score: loserScore,
      ...buildBotMatchActivityMetadata({
        mode,
        fritzTier,
        isWinnerRow: true,
        score: winnerScore,
        opponentScore: loserScore,
      }),
    }));
  }
  if (loserUserId) {
    writes.push(writeActivity(loserUserId, 'loss', {
      opponent_username: winnerUsername,
      mode,
      score: loserScore,
      opponent_score: winnerScore,
      ...buildBotMatchActivityMetadata({
        mode,
        fritzTier,
        isWinnerRow: false,
        score: loserScore,
        opponentScore: winnerScore,
      }),
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

export async function writeDailyFritzGameActivity(params: {
  userId: string;
  gameNumber: number;
  playerWon: boolean;
  playerScore: number;
  fritzScore: number;
  skunk?: boolean;
  skunkBy?: 'player' | 'fritz';
}): Promise<void> {
  await writeActivity(params.userId, 'daily_fritz', {
    result: params.playerWon ? 'win' : 'loss',
    game_number: params.gameNumber,
    player_score: params.playerScore,
    fritz_score: params.fritzScore,
    ...(params.skunk ? { skunk: true } : {}),
    ...(params.skunkBy ? { skunk_by: params.skunkBy } : {}),
  });
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
    skunk?: boolean;
    skunkBy?: 'player' | 'fritz';
  }>;
}): Promise<void> {
  if (params.games?.length) {
    await Promise.all(
      params.games.map((game) =>
        writeDailyFritzGameActivity({
          userId: params.userId,
          gameNumber: game.gameNumber,
          playerWon: game.playerWon,
          playerScore: game.playerScore,
          fritzScore: game.fritzScore,
          skunk: game.skunk,
          skunkBy: game.skunkBy,
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
