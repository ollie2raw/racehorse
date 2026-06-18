import { supabaseFetch } from '../supabaseUtils';

export const RECORD_MATCH_MODES = ['bot', 'online', 'practice'] as const;
export type RecordMatchMode = (typeof RECORD_MATCH_MODES)[number];

export const RECORD_MATCH_OPPONENT_TYPES = ['bot', 'online', 'guest'] as const;
export type RecordMatchOpponentType = (typeof RECORD_MATCH_OPPONENT_TYPES)[number];

export type RecordUserMatchInput = {
  authenticatedUserId: string;
  mode: RecordMatchMode;
  opponentType: RecordMatchOpponentType;
  winnerUserId: string | null;
  loserUserId: string | null;
  winnerScore: number | null;
  loserScore: number | null;
  moveCount: number | null;
  avgMoveQuality?: number | null;
  roomCode?: string | null;
  metadata?: Record<string, unknown>;
};

export type ValidatedRecordUserMatchPayload = {
  mode: RecordMatchMode;
  room_code: string | null;
  winner_user_id: string | null;
  loser_user_id: string | null;
  winner_score: number | null;
  loser_score: number | null;
  move_count: number | null;
  avg_move_quality?: number;
  metadata: Record<string, unknown>;
  idempotency?: {
    roomCode: string;
    winnerSocketId: string;
    loserSocketId: string;
  };
};

const MAX_SCORE = 200;
const MAX_METADATA_JSON_BYTES = 8_192;

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeOptionalUserId(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isUuidLike(trimmed) ? trimmed : null;
}

function normalizeOptionalScore(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0 || num > MAX_SCORE) return null;
  return num;
}

function normalizeOptionalMoveCount(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) return null;
  return num;
}

function normalizeAvgMoveQuality(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 100) return null;
  return num;
}

function normalizeRoomCode(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed || trimmed.length > 32) return null;
  return trimmed;
}

function normalizeMetadata(value: unknown): Record<string, unknown> | null {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_METADATA_JSON_BYTES) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function validateRecordUserMatchInput(
  input: RecordUserMatchInput,
): { ok: true; payload: ValidatedRecordUserMatchPayload } | { ok: false; error: string; status: number } {
  const authenticatedUserId = typeof input.authenticatedUserId === 'string' ? input.authenticatedUserId.trim() : '';
  if (!authenticatedUserId || !isUuidLike(authenticatedUserId)) {
    return { ok: false, error: 'Unauthorized', status: 401 };
  }

  if (!RECORD_MATCH_MODES.includes(input.mode)) {
    return { ok: false, error: 'Invalid match mode.', status: 400 };
  }
  if (!RECORD_MATCH_OPPONENT_TYPES.includes(input.opponentType)) {
    return { ok: false, error: 'Invalid opponent type.', status: 400 };
  }

  const winnerUserId = normalizeOptionalUserId(input.winnerUserId);
  const loserUserId = normalizeOptionalUserId(input.loserUserId);
  if (input.winnerUserId != null && input.winnerUserId !== '' && !winnerUserId) {
    return { ok: false, error: 'Invalid winner_user_id.', status: 400 };
  }
  if (input.loserUserId != null && input.loserUserId !== '' && !loserUserId) {
    return { ok: false, error: 'Invalid loser_user_id.', status: 400 };
  }

  const participantIds = [winnerUserId, loserUserId].filter((id): id is string => Boolean(id));
  if (participantIds.length === 0) {
    return { ok: false, error: 'At least one participant user id is required.', status: 400 };
  }
  if (!participantIds.includes(authenticatedUserId)) {
    return { ok: false, error: 'Forbidden', status: 403 };
  }
  if (winnerUserId && loserUserId && winnerUserId === loserUserId) {
    return { ok: false, error: 'Winner and loser must be different users.', status: 400 };
  }

  const winnerScore = normalizeOptionalScore(input.winnerScore);
  const loserScore = normalizeOptionalScore(input.loserScore);
  if (input.winnerScore != null && winnerScore == null) {
    return { ok: false, error: 'Invalid winner_score.', status: 400 };
  }
  if (input.loserScore != null && loserScore == null) {
    return { ok: false, error: 'Invalid loser_score.', status: 400 };
  }

  const moveCount = normalizeOptionalMoveCount(input.moveCount);
  if (input.moveCount != null && moveCount == null) {
    return { ok: false, error: 'Invalid move_count.', status: 400 };
  }

  const avgMoveQuality = normalizeAvgMoveQuality(input.avgMoveQuality);
  if (input.avgMoveQuality != null && avgMoveQuality == null) {
    return { ok: false, error: 'Invalid avg_move_quality.', status: 400 };
  }

  const roomCode = normalizeRoomCode(input.roomCode);
  if (input.roomCode != null && input.roomCode !== '' && !roomCode) {
    return { ok: false, error: 'Invalid room_code.', status: 400 };
  }

  const extraMetadata = normalizeMetadata(input.metadata);
  if (input.metadata != null && extraMetadata == null) {
    return { ok: false, error: 'Invalid metadata.', status: 400 };
  }

  const metadata: Record<string, unknown> = {
    opponentType: input.opponentType,
    ...(extraMetadata ?? {}),
  };

  let idempotency: ValidatedRecordUserMatchPayload['idempotency'];
  const winnerSocketId =
    typeof metadata.winnerSocketId === 'string' ? metadata.winnerSocketId.trim() : '';
  const loserSocketId =
    typeof metadata.loserSocketId === 'string' ? metadata.loserSocketId.trim() : '';
  if (roomCode && winnerSocketId && loserSocketId) {
    idempotency = { roomCode, winnerSocketId, loserSocketId };
  }

  const payload: ValidatedRecordUserMatchPayload = {
    mode: input.mode,
    room_code: roomCode,
    winner_user_id: winnerUserId,
    loser_user_id: loserUserId,
    winner_score: winnerScore,
    loser_score: loserScore,
    move_count: moveCount,
    ...(avgMoveQuality != null ? { avg_move_quality: avgMoveQuality } : {}),
    metadata,
    ...(idempotency ? { idempotency } : {}),
  };

  return { ok: true, payload };
}

async function hasExistingGuestMatch(idempotency: NonNullable<ValidatedRecordUserMatchPayload['idempotency']>): Promise<boolean> {
  const roomEnc = encodeURIComponent(idempotency.roomCode);
  const winnerEnc = encodeURIComponent(idempotency.winnerSocketId);
  const loserEnc = encodeURIComponent(idempotency.loserSocketId);
  const rows = await supabaseFetch<Array<{ id: string }>>(
    `/rest/v1/matches?room_code=eq.${roomEnc}` +
      `&metadata->>winnerSocketId=eq.${winnerEnc}` +
      `&metadata->>loserSocketId=eq.${loserEnc}` +
      `&select=id&limit=1`,
    { method: 'GET' },
  );
  return rows.length > 0;
}

function isMissingAvgMoveQualityColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('avg_move_quality') ||
    message.includes('column') ||
    message.includes('42703')
  );
}

export async function recordUserMatch(
  input: RecordUserMatchInput,
): Promise<{ ok: true; replayed?: boolean } | { ok: false; error: string; status: number }> {
  const validated = validateRecordUserMatchInput(input);
  if (!validated.ok) return validated;

  const { payload } = validated;
  if (payload.idempotency) {
    try {
      if (await hasExistingGuestMatch(payload.idempotency)) {
        return { ok: true, replayed: true };
      }
    } catch (err) {
      console.warn(
        '[stats] recordUserMatch idempotency check failed',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const insertBody: Record<string, unknown> = {
    mode: payload.mode,
    room_code: payload.room_code,
    winner_user_id: payload.winner_user_id,
    loser_user_id: payload.loser_user_id,
    winner_score: payload.winner_score,
    loser_score: payload.loser_score,
    move_count: payload.move_count,
    metadata: payload.metadata,
  };
  if (payload.avg_move_quality != null) {
    insertBody.avg_move_quality = payload.avg_move_quality;
  }

  try {
    await supabaseFetch('/rest/v1/matches', {
      method: 'POST',
      body: JSON.stringify(insertBody),
    });
    return { ok: true };
  } catch (err) {
    if (payload.avg_move_quality != null && isMissingAvgMoveQualityColumn(err)) {
      const { avg_move_quality: _ignored, ...withoutQuality } = insertBody;
      try {
        await supabaseFetch('/rest/v1/matches', {
          method: 'POST',
          body: JSON.stringify(withoutQuality),
        });
        return { ok: true };
      } catch (retryErr) {
        console.warn(
          '[stats] recordUserMatch insert failed',
          retryErr instanceof Error ? retryErr.message : retryErr,
        );
        return { ok: false, error: 'Failed to record match.', status: 500 };
      }
    }
    console.warn('[stats] recordUserMatch insert failed', err instanceof Error ? err.message : err);
    return { ok: false, error: 'Failed to record match.', status: 500 };
  }
}
