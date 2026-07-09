export type RecoveredTerminalMatchNotice = {
  context: 'multiplayer';
  title: string;
  detail: string;
};

type ArchivedRoomParticipant = {
  id: string;
  username?: string | null;
  userId?: string | null;
};

type ArchivedRoomLog = {
  matchId: string;
  roomCode: string;
  status: 'completed' | 'abandoned';
  participants?: ArchivedRoomParticipant[];
  summary?: {
    winnerId?: string | null;
    scores?: Record<string, number>;
  } | null;
};

type ArchivedRoomLogResponse = {
  ok?: boolean;
  log?: ArchivedRoomLog;
};

function participantNameBySeat(log: ArchivedRoomLog): Map<string, string> {
  const names = new Map<string, string>();
  for (const participant of log.participants ?? []) {
    names.set(participant.id, participant.username?.trim() || 'Player');
  }
  return names;
}

function formatScoreline(log: ArchivedRoomLog): string | null {
  const scores = log.summary?.scores;
  if (!scores || typeof scores !== 'object') return null;
  const names = participantNameBySeat(log);
  const entries = Object.entries(scores).filter(([, score]) => Number.isFinite(score));
  if (entries.length === 0) return null;
  return entries
    .map(([seatId, score]) => `${names.get(seatId) ?? 'Player'} ${score}`)
    .join(' - ');
}

export function buildRecoveredTerminalMatchNotice(
  log: ArchivedRoomLog,
): RecoveredTerminalMatchNotice {
  const roomCode = log.roomCode.trim().toUpperCase();
  const scoreline = formatScoreline(log);
  if (log.status === 'completed') {
    return {
      context: 'multiplayer',
      title: 'Match completed',
      detail: scoreline
        ? `Your saved room ${roomCode} finished while you were away. Final score: ${scoreline}.`
        : `Your saved room ${roomCode} finished while you were away.`,
    };
  }

  return {
    context: 'multiplayer',
    title: 'Match ended',
    detail: scoreline
      ? `Your saved room ${roomCode} was abandoned while you were away. Last recorded score: ${scoreline}.`
      : `Your saved room ${roomCode} was abandoned while you were away.`,
  };
}

export async function fetchRecoveredTerminalMatchNotice(params: {
  serverUrl: string;
  roomCode: string;
  authToken: string | null;
}): Promise<RecoveredTerminalMatchNotice | null> {
  const roomCode = params.roomCode.trim().toUpperCase();
  if (!params.serverUrl || !roomCode || !params.authToken) return null;

  const response = await fetch(
    `${params.serverUrl.replace(/\/$/, '')}/api/room-events/by-room/${encodeURIComponent(roomCode)}`,
    {
      headers: {
        Authorization: `Bearer ${params.authToken}`,
      },
    },
  );
  if (response.status === 404 || response.status === 403 || response.status === 401) return null;
  if (!response.ok) return null;

  const payload = (await response.json()) as ArchivedRoomLogResponse;
  return payload.log ? buildRecoveredTerminalMatchNotice(payload.log) : null;
}
