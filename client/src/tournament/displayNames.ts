import type { TournamentMatch } from './types';

export type BotTier = 'standard' | 'elite' | 'master';

export function isTournamentBotId(userId: string | null | undefined): boolean {
  return Boolean(userId && userId.startsWith('bot:fritz:'));
}

export function botTierForRound(round: 1 | 2 | 3): BotTier {
  if (round === 3) return 'master';
  if (round === 2) return 'elite';
  return 'standard';
}

export function botDisplayNameFromTier(tier: BotTier | null | undefined): string {
  if (tier === 'master') return 'Master Fritz';
  if (tier === 'elite') return 'Elite Fritz';
  return 'Fritz';
}

function looksLikeRawBotToken(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  return v.startsWith('bot:') || v.startsWith('bot:fritz');
}

export function resolveTournamentPlayerName(
  userId: string | null,
  opts?: {
    username?: string | null;
    botTier?: BotTier | null;
    round?: 1 | 2 | 3;
  },
): string {
  if (!userId) return 'TBD';
  if (isTournamentBotId(userId)) {
    const tier = opts?.botTier ?? (opts?.round != null ? botTierForRound(opts.round) : null);
    return botDisplayNameFromTier(tier);
  }
  const username = opts?.username?.trim();
  if (username && !looksLikeRawBotToken(username)) {
    return username.replace(/^@/, '');
  }
  return userId.slice(0, 8);
}

export function resolveTournamentOpponentLabel(input: {
  opponentUserId?: string | null;
  opponentUsername?: string | null;
  round?: 1 | 2 | 3;
  botTier?: BotTier | null;
  roomOpponentUsername?: string | null;
}): string {
  const fromRoom = input.roomOpponentUsername?.trim();
  if (fromRoom && !looksLikeRawBotToken(fromRoom)) {
    return fromRoom.replace(/^@/, '');
  }
  return resolveTournamentPlayerName(input.opponentUserId ?? null, {
    username: input.opponentUsername,
    botTier: input.botTier,
    round: input.round,
  });
}

export function registrationNameFor(
  userId: string,
  username: string | null | undefined,
  match?: Pick<TournamentMatch, 'round' | 'bot_tier' | 'player1_id' | 'player2_id'> | null,
): string {
  const inMatch = match && (match.player1_id === userId || match.player2_id === userId);
  return resolveTournamentPlayerName(userId, {
    username,
    botTier: inMatch ? match.bot_tier : isTournamentBotId(userId) ? botTierForRound(match?.round ?? 1) : null,
    round: inMatch ? match.round : undefined,
  });
}

export function tournamentStageShortLabel(round: 1 | 2 | 3): string {
  if (round === 3) return 'Final';
  if (round === 2) return 'Semifinal';
  return 'Quarterfinal';
}
