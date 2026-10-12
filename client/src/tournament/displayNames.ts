import type { TournamentMatch } from './types';

export type BotTier = 'standard' | 'elite' | 'master';

export function isTournamentBotId(userId: string | null | undefined): boolean {
  return Boolean(userId && userId.startsWith('bot:fritz:'));
}

/** Stable 1-based index from `bot:fritz:{tournamentId}:{n}` */
export function tournamentBotDisplayIndex(userId: string | null | undefined): number | null {
  if (!isTournamentBotId(userId)) return null;
  const segment = userId!.split(':').pop();
  const n = segment ? Number.parseInt(segment, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function botTierForRound(round: 1 | 2 | 3): BotTier {
  if (round === 3) return 'master';
  if (round === 2) return 'elite';
  return 'standard';
}

export function botDisplayNameFromTier(
  tier: BotTier | null | undefined,
  botIndex?: number | null,
): string {
  const suffix = botIndex != null ? ` ${botIndex}` : '';
  if (tier === 'master') return `Master Fritz${suffix}`;
  if (tier === 'elite') return `Elite Fritz${suffix}`;
  return `Fritz${suffix}`;
}

function looksLikeRawBotToken(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  return v.startsWith('bot:') || v.startsWith('bot:fritz');
}

/** How a tournament player is shown (Phase 3D): one place for every surface. */
export type TournamentPlayerDisplay = {
  label: string;
  isFritz: boolean;
  fritzTier: BotTier | null;
  /** Text chip shown next to a Fritz seat (identity never by colour or name alone). */
  badgeLabel: 'Fritz' | null;
};

export type TournamentPlayerDisplayContext = {
  /** The player's known name (a human's username; ignored for Fritz). */
  username?: string | null;
  /** The Fritz tier of the match this seat is in. */
  botTier?: BotTier | null;
  /** The round, when the tier is not known (Fritz's tier follows the round). */
  round?: 1 | 2 | 3;
  /**
   * Only when two Fritz seats of the same tier are shown together (Fritz
   * against Fritz): the smallest stable number that tells them apart.
   */
  fritzSuffix?: number | null;
};

/**
 * The one tournament display-name helper: "Fritz" / "Elite Fritz" / "Master
 * Fritz" for a Fritz seat (never its internal id, never a number unless two
 * same-tier Fritz seats need telling apart), the username for a human.
 */
export function tournamentPlayerDisplay(
  playerId: string | null | undefined,
  ctx: TournamentPlayerDisplayContext = {},
): TournamentPlayerDisplay {
  if (!playerId) return { label: 'TBD', isFritz: false, fritzTier: null, badgeLabel: null };
  if (isTournamentBotId(playerId)) {
    const tier = ctx.botTier ?? (ctx.round != null ? botTierForRound(ctx.round) : 'standard');
    return { label: botDisplayNameFromTier(tier, ctx.fritzSuffix ?? null), isFritz: true, fritzTier: tier, badgeLabel: 'Fritz' };
  }
  const username = ctx.username?.trim();
  const label = username && !looksLikeRawBotToken(username) ? username.replace(/^@/, '') : 'Player';
  return { label, isFritz: false, fritzTier: null, badgeLabel: null };
}

/**
 * Fritz-against-Fritz: both seats share a tier, so number them 1 and 2 by
 * their stable seat index. Any other match needs no numbers.
 */
export function matchFritzSuffixes(
  match: Pick<TournamentMatch, 'player1_id' | 'player2_id'>,
): Map<string, number> {
  const suffixes = new Map<string, number>();
  const { player1_id: a, player2_id: b } = match;
  if (!a || !b || !isTournamentBotId(a) || !isTournamentBotId(b)) return suffixes;
  const ia = tournamentBotDisplayIndex(a) ?? 0;
  const ib = tournamentBotDisplayIndex(b) ?? 0;
  suffixes.set(a, ia <= ib ? 1 : 2);
  suffixes.set(b, ia <= ib ? 2 : 1);
  return suffixes;
}

/** A bracket slot: the match's tier, plus a number only for Fritz against Fritz. */
export function bracketSlotDisplay(
  playerId: string | null,
  username: string | null | undefined,
  match: Pick<TournamentMatch, 'round' | 'bot_tier' | 'player1_id' | 'player2_id'>,
): TournamentPlayerDisplay {
  return tournamentPlayerDisplay(playerId, {
    username,
    botTier: match.bot_tier ?? null,
    round: match.round,
    fritzSuffix: playerId ? matchFritzSuffixes(match).get(playerId) ?? null : null,
  });
}

export function resolveTournamentPlayerName(
  userId: string | null,
  opts?: {
    username?: string | null;
    botTier?: BotTier | null;
    round?: 1 | 2 | 3;
  },
): string {
  return tournamentPlayerDisplay(userId, opts).label;
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
  if (inMatch) return bracketSlotDisplay(userId, username, match).label;
  return tournamentPlayerDisplay(userId, { username, botTier: isTournamentBotId(userId) ? botTierForRound(match?.round ?? 1) : null }).label;
}

export function tournamentStageShortLabel(round: 1 | 2 | 3): string {
  if (round === 3) return 'Final';
  if (round === 2) return 'Semifinal';
  return 'Quarterfinal';
}
