import type { PersistedRoomMatchLogRow } from './roomMatchLogPersistence';
import {
  rankingMessage,
  type RankingOutcome,
  type RankingSkipReason,
} from './rankingOutcome';

export type PrivateMatchSeat = {
  seatId: string;
  userId: string | null;
  username: string;
};

export type PrivateMatchRankingBlock = {
  eligible: boolean;
  applied: boolean;
  skipReason: RankingSkipReason | null;
  message: string | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
};

export type PrivateMatchResult = {
  matchId: string;
  roomCode: string;
  terminalStatus: 'completed' | 'abandoned';
  archivedAt: string;
  you: PrivateMatchSeat;
  opponent: PrivateMatchSeat;
  outcome: 'win' | 'loss' | 'draw';
  yourScore: number;
  opponentScore: number;
};

export type RankedGameRatingRow = {
  player_id: string;
  rating_before?: number | null;
  rating_after?: number | null;
  delta?: number | null;
};

type Participant = {
  id: string;
  username: string;
  userId: string | null;
  seatIndex: number;
};

function asParticipants(value: unknown): Participant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== 'string') return [];
    return [
      {
        id: row.id,
        username: typeof row.username === 'string' && row.username.trim() ? row.username : 'Player',
        userId: typeof row.userId === 'string' ? row.userId : null,
        seatIndex: typeof row.seatIndex === 'number' ? row.seatIndex : 0,
      },
    ];
  });
}

function asScores(summary: Record<string, unknown> | null): Record<string, number> {
  const scores = summary?.scores;
  if (!scores || typeof scores !== 'object') return {};
  return Object.fromEntries(
    Object.entries(scores as Record<string, unknown>).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
}

function asRankingOutcome(summary: Record<string, unknown> | null): RankingOutcome | null {
  const raw = summary?.rankingOutcome;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    glickoEligible: row.glickoEligible === true,
    glickoApplied: row.glickoApplied === true,
    skipReason:
      row.skipReason === 'move_log_verification_failed' ||
      row.skipReason === 'duplicate' ||
      row.skipReason === 'not_ranked'
        ? row.skipReason
        : null,
  };
}

function resolveOutcome(params: {
  yourSeatId: string;
  yourScore: number;
  opponentScore: number;
  winnerId: string | null;
}): 'win' | 'loss' | 'draw' {
  if (params.winnerId) {
    if (params.winnerId === params.yourSeatId) return 'win';
    return 'loss';
  }
  if (params.yourScore === params.opponentScore) return 'draw';
  return params.yourScore > params.opponentScore ? 'win' : 'loss';
}

export function buildPrivateMatchResult(params: {
  log: PersistedRoomMatchLogRow;
  viewerUserId: string;
  rankedGame?: RankedGameRatingRow | null;
}):
  | { ok: true; result: PrivateMatchResult & { ranking: PrivateMatchRankingBlock } }
  | { ok: false; reason: 'not_a_participant' } {
  const participants = asParticipants(params.log.participants);
  const you = participants.find((participant) => participant.userId === params.viewerUserId);
  if (!you) {
    return { ok: false, reason: 'not_a_participant' };
  }
  const opponent =
    participants.find((participant) => participant.id !== you.id) ?? {
      id: 'unknown',
      username: 'Opponent',
      userId: null,
      seatIndex: you.seatIndex === 0 ? 1 : 0,
    };

  const scores = asScores(params.log.summary);
  const yourScore = scores[you.id] ?? 0;
  const opponentScore = scores[opponent.id] ?? 0;
  const winnerId =
    typeof params.log.summary?.winnerId === 'string' ? params.log.summary.winnerId : null;
  const rankingOutcome = asRankingOutcome(params.log.summary);
  const inferredFromRankedGame =
    !rankingOutcome && params.rankedGame != null && params.rankedGame.rating_after != null;
  const applied = rankingOutcome?.glickoApplied === true || inferredFromRankedGame;
  const eligible = rankingOutcome?.glickoEligible === true || inferredFromRankedGame;
  const skipReason = applied
    ? null
    : rankingOutcome?.skipReason ?? (eligible ? null : 'not_ranked');

  return {
    ok: true,
    result: {
      matchId: params.log.match_id,
      roomCode: params.log.room_code,
      terminalStatus: params.log.status,
      archivedAt: params.log.archived_at,
      you: { seatId: you.id, userId: you.userId, username: you.username },
      opponent: {
        seatId: opponent.id,
        userId: opponent.userId,
        username: opponent.username,
      },
      outcome: resolveOutcome({
        yourSeatId: you.id,
        yourScore,
        opponentScore,
        winnerId,
      }),
      yourScore,
      opponentScore,
      ranking: {
        eligible,
        applied,
        skipReason,
        message: rankingMessage(applied),
        ratingBefore: params.rankedGame?.rating_before ?? null,
        ratingAfter: params.rankedGame?.rating_after ?? null,
        ratingDelta: params.rankedGame?.delta ?? null,
      },
    },
  };
}
