export type PrivateMatchSeat = {
  seatId: string;
  userId: string | null;
  username: string;
};

export type PrivateMatchRanking = {
  eligible: boolean;
  applied: boolean;
  skipReason: string | null;
  message: string | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
};

export type PrivateMatchResultPayload = {
  matchId: string;
  roomCode: string;
  terminalStatus: 'completed' | 'abandoned';
  archivedAt: string;
  you: PrivateMatchSeat;
  opponent: PrivateMatchSeat;
  outcome: 'win' | 'loss' | 'draw';
  yourScore: number;
  opponentScore: number;
  ranking: PrivateMatchRanking;
};

export type RecoveredPrivateMatchUi =
  | { kind: 'result'; result: PrivateMatchResultPayload }
  | { kind: 'unauthorized'; roomCode: string }
  | { kind: 'forbidden'; roomCode: string }
  | { kind: 'absent'; roomCode: string }
  | { kind: 'syncing'; roomCode: string };

type PrivateMatchResultResponse = {
  ok?: boolean;
  result?: PrivateMatchResultPayload;
};

function isPrivateMatchResultPayload(value: unknown): value is PrivateMatchResultPayload {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PrivateMatchResultPayload>;
  return (
    typeof row.matchId === 'string' &&
    typeof row.roomCode === 'string' &&
    (row.outcome === 'win' || row.outcome === 'loss' || row.outcome === 'draw') &&
    typeof row.yourScore === 'number' &&
    typeof row.opponentScore === 'number' &&
    Boolean(row.you && row.opponent && row.ranking)
  );
}

export async function recoverPrivateMatchResult(params: {
  serverUrl: string;
  roomCode: string;
  matchId?: string | null;
  authToken: string | null;
  timeoutMs?: number;
}): Promise<RecoveredPrivateMatchUi> {
  const roomCode = params.roomCode.trim().toUpperCase();
  if (!params.serverUrl || !roomCode) return { kind: 'absent', roomCode };
  if (!params.authToken) return { kind: 'unauthorized', roomCode };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), params.timeoutMs ?? 8000);
  const matchId = params.matchId?.trim() ?? '';
  const query = matchId
    ? `matchId=${encodeURIComponent(matchId)}`
    : `roomCode=${encodeURIComponent(roomCode)}`;

  try {
    const response = await fetch(
      `${params.serverUrl.replace(/\/$/, '')}/api/private-match/result?${query}`,
      {
        headers: {
          Authorization: `Bearer ${params.authToken}`,
        },
        signal: controller.signal,
      },
    );
    if (response.status === 401) return { kind: 'unauthorized', roomCode };
    if (response.status === 403) return { kind: 'forbidden', roomCode };
    if (response.status === 404) return { kind: 'absent', roomCode };
    if (response.status === 503) return { kind: 'syncing', roomCode };
    if (!response.ok) return { kind: 'syncing', roomCode };

    const payload = (await response.json()) as PrivateMatchResultResponse;
    if (payload.ok === true && isPrivateMatchResultPayload(payload.result)) {
      return { kind: 'result', result: payload.result };
    }
    return { kind: 'absent', roomCode };
  } catch {
    return { kind: 'syncing', roomCode };
  } finally {
    window.clearTimeout(timeout);
  }
}