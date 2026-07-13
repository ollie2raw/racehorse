export type RecoveredTerminalMatchNotice = {
  context: 'multiplayer';
  title: string;
  detail: string;
};

export type TerminalArchiveRecoveryResult =
  | { status: 'found'; notice: RecoveredTerminalMatchNotice }
  | { status: 'absent' }
  | { status: 'unauthorized' }
  | { status: 'temporarily_unavailable'; error?: string };

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

export function buildTerminalArchiveFallbackNotice(
  status: Exclude<TerminalArchiveRecoveryResult['status'], 'found'>,
  roomCode: string,
): RecoveredTerminalMatchNotice {
  const code = roomCode.trim().toUpperCase();
  if (status === 'unauthorized') {
    return {
      context: 'multiplayer',
      title: 'Sign in to recover result',
      detail: `Your saved room ${code} has ended, but result recovery needs a fresh sign-in. Return home, sign in, then retry Multiplayer.`,
    };
  }
  if (status === 'temporarily_unavailable') {
    return {
      context: 'multiplayer',
      title: 'Result still syncing',
      detail: `Your saved room ${code} has ended, but the archived result is temporarily unavailable. Return home and retry Multiplayer in a moment.`,
    };
  }
  return {
    context: 'multiplayer',
    title: 'Match ended',
    detail: `Your saved room ${code} has ended, but no archived result was found.`,
  };
}

export async function recoverTerminalMatchArchive(params: {
  serverUrl: string;
  roomCode: string;
  authToken: string | null;
  timeoutMs?: number;
}): Promise<TerminalArchiveRecoveryResult> {
  const roomCode = params.roomCode.trim().toUpperCase();
  if (!params.serverUrl || !roomCode) return { status: 'absent' };
  if (!params.authToken) return { status: 'unauthorized' };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), params.timeoutMs ?? 8000);

  try {
    const response = await fetch(
      `${params.serverUrl.replace(/\/$/, '')}/api/room-events/by-room/${encodeURIComponent(roomCode)}`,
      {
        headers: {
          Authorization: `Bearer ${params.authToken}`,
        },
        signal: controller.signal,
      },
    );
    if (response.status === 404) return { status: 'absent' };
    if (response.status === 403 || response.status === 401) return { status: 'unauthorized' };
    if (!response.ok) {
      return { status: 'temporarily_unavailable', error: `HTTP ${response.status}` };
    }

    const payload = (await response.json()) as ArchivedRoomLogResponse;
    return payload.log
      ? { status: 'found', notice: buildRecoveredTerminalMatchNotice(payload.log) }
      : { status: 'absent' };
  } catch (error) {
    return {
      status: 'temporarily_unavailable',
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function fetchRecoveredTerminalMatchNotice(params: {
  serverUrl: string;
  roomCode: string;
  authToken: string | null;
}): Promise<RecoveredTerminalMatchNotice | null> {
  const result = await recoverTerminalMatchArchive(params);
  return result.status === 'found' ? result.notice : null;
}
