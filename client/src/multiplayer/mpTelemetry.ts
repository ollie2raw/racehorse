import { logger } from '../utils/logger';

/** Structural subset of RecoveryLogEntry — avoids importing recoveryMachine (cycle break). */
export type MpRecoveryLogEntry = {
  episodeId: number;
  attempt: number;
  from: string;
  to: string;
  event: string;
  policy: string;
  targetRoom: string | null;
};

export const MP_TELEMETRY_EPISODE_MAP_MAX_SIZE = 50;

export type MpTelemetryCounters = {
  recoveryEpisodeStart: number;
  recoveryEpisodeSuccess: number;
  recoveryEpisodeFailure: number;
  recoveryEpisodeExhausted: number;
  resyncRequested: number;
  resyncCompleted: number;
  resyncFailed: number;
  resyncSkipped: number;
  resyncStale: number;
  ingressReplayDrop: number;
  ingressDedupDrop: number;
  ingressStaleEpisodeDrop: number;
  ingressSequenceRegressionDrop: number;
  joinLatencyMs: number;
  rejoinLatencyMs: number;
  joinAckTimeout: number;
  reconnectSuccess: number;
  actionStaleState: number;
  actionRequestIdConflict: number;
  actionDuplicateReplay: number;
  actionRejected: number;
};

const counters: MpTelemetryCounters = {
  recoveryEpisodeStart: 0,
  recoveryEpisodeSuccess: 0,
  recoveryEpisodeFailure: 0,
  recoveryEpisodeExhausted: 0,
  resyncRequested: 0,
  resyncCompleted: 0,
  resyncFailed: 0,
  resyncSkipped: 0,
  resyncStale: 0,
  ingressReplayDrop: 0,
  ingressDedupDrop: 0,
  ingressStaleEpisodeDrop: 0,
  ingressSequenceRegressionDrop: 0,
  joinLatencyMs: 0,
  rejoinLatencyMs: 0,
  joinAckTimeout: 0,
  reconnectSuccess: 0,
  actionStaleState: 0,
  actionRequestIdConflict: 0,
  actionDuplicateReplay: 0,
  actionRejected: 0,
};

const episodeStartedAt = new Map<number, number>();

function rememberEpisodeStart(episodeId: number, now: number): void {
  if (!episodeStartedAt.has(episodeId)) {
    episodeStartedAt.set(episodeId, now);
  }
  if (episodeStartedAt.size > MP_TELEMETRY_EPISODE_MAP_MAX_SIZE) {
    const oldestKey = episodeStartedAt.keys().next().value;
    if (oldestKey !== undefined) {
      episodeStartedAt.delete(oldestKey);
    }
  }
}

function emit(context: string, event: string, extra?: Record<string, unknown>): void {
  logger.operational(context, event, extra);
}

export function resetMpTelemetryForTests(): void {
  for (const key of Object.keys(counters) as Array<keyof MpTelemetryCounters>) {
    counters[key] = 0;
  }
  episodeStartedAt.clear();
}

export function getMpTelemetryCountersForTests(): Readonly<MpTelemetryCounters> {
  return { ...counters };
}

export function recordRecoveryTransition(entry: MpRecoveryLogEntry): void {
  const base = {
    episodeId: entry.episodeId,
    attempt: entry.attempt,
    from: entry.from,
    to: entry.to,
    event: entry.event,
    policy: entry.policy,
    targetRoom: entry.targetRoom,
  };

  if (entry.event === 'SOCKET_LOST' && entry.to === 'connecting') {
    rememberEpisodeStart(entry.episodeId, Date.now());
    counters.recoveryEpisodeStart += 1;
    emit('recovery', 'episode_start', base);
    return;
  }

  if (entry.to === 'idle' && (entry.event === 'ROOM_JOIN_OK' || entry.event === 'RESYNC_OK')) {
    const startedAt = episodeStartedAt.get(entry.episodeId);
    const durationMs = startedAt != null ? Date.now() - startedAt : undefined;
    episodeStartedAt.delete(entry.episodeId);
    counters.recoveryEpisodeSuccess += 1;
    if (entry.event === 'ROOM_JOIN_OK') {
      counters.reconnectSuccess += 1;
    }
    emit('recovery', 'episode_success', { ...base, durationMs });
    return;
  }

  if (entry.to === 'failed') {
    const startedAt = episodeStartedAt.get(entry.episodeId);
    const durationMs = startedAt != null ? Date.now() - startedAt : undefined;
    episodeStartedAt.delete(entry.episodeId);
    counters.recoveryEpisodeFailure += 1;
    if (entry.attempt >= 5) {
      counters.recoveryEpisodeExhausted += 1;
      emit('recovery', 'episode_exhausted', { ...base, durationMs, attempts: entry.attempt });
      return;
    }
    emit('recovery', 'episode_failure', { ...base, durationMs, attempts: entry.attempt });
  }
}

export function recordResyncRequested(
  reason: string,
  extra?: Record<string, unknown>,
): void {
  counters.resyncRequested += 1;
  emit('resync', 'requested', { reason, ...extra });
}

export function recordResyncCompleted(reason: string, extra?: Record<string, unknown>): void {
  counters.resyncCompleted += 1;
  emit('resync', 'completed', { reason, ...extra });
}

export function recordResyncFailed(reason: string, extra?: Record<string, unknown>): void {
  counters.resyncFailed += 1;
  emit('resync', 'failed', { reason, ...extra });
}

export function recordResyncSkipped(reason: string, extra?: Record<string, unknown>): void {
  counters.resyncSkipped += 1;
  emit('resync', 'skipped', { reason, ...extra });
}

export function recordResyncStale(extra?: Record<string, unknown>): void {
  counters.resyncStale += 1;
  emit('resync', 'stale', extra);
}

export function recordIngressReplayDrop(eventType: string, extra?: Record<string, unknown>): void {
  counters.ingressReplayDrop += 1;
  emit('ingress', 'replay_drop', { eventType, ...extra });
}

export function recordIngressDedupDrop(eventType: string, extra?: Record<string, unknown>): void {
  counters.ingressDedupDrop += 1;
  emit('ingress', 'dedup_drop', { eventType, ...extra });
}

export function recordIngressStaleEpisodeDrop(extra?: Record<string, unknown>): void {
  counters.ingressStaleEpisodeDrop += 1;
  emit('ingress', 'stale_episode_drop', extra);
}

export function recordIngressSequenceRegressionDrop(
  incoming: number | undefined,
  watermark: number,
): void {
  counters.ingressSequenceRegressionDrop += 1;
  emit('ingress', 'sequence_regression_drop', { incoming, watermark });
}

export function recordJoinLatency(latencyMs: number, kind: 'join' | 'rejoin'): void {
  if (kind === 'rejoin') {
    counters.rejoinLatencyMs = latencyMs;
    emit('join', 'rejoin_latency', { latencyMs });
    return;
  }
  counters.joinLatencyMs = latencyMs;
  emit('join', 'join_latency', { latencyMs });
}

export function recordJoinAckTimeout(event: string, elapsedMs: number): void {
  counters.joinAckTimeout += 1;
  emit('join', 'ack_timeout', { event, elapsedMs });
}

/**
 * Canonical client-side accounting for server action acknowledgements. The
 * server remains authoritative; this lets operations distinguish expected
 * optimistic-concurrency resyncs from actual player-visible failures.
 */
export function recordGameplayActionAck(
  action: 'draw' | 'pass' | 'play',
  ack: { ok?: boolean; error?: string; duplicate?: boolean; sequence?: number } | null | undefined,
  context: { roomCode: string; expectedSequence: number },
): void {
  const base = {
    action,
    roomCode: context.roomCode,
    expectedSequence: context.expectedSequence,
    actualSequence: ack?.sequence,
    error: ack?.error,
  };
  if (ack?.ok) {
    if (ack.duplicate) {
      counters.actionDuplicateReplay += 1;
      emit('gameplay_action', 'duplicate_replay', base);
    }
    return;
  }
  if (ack?.error === 'stale_state') {
    counters.actionStaleState += 1;
    emit('gameplay_action', 'stale_state', base);
    return;
  }
  if (ack?.error === 'request_id_conflict') {
    counters.actionRequestIdConflict += 1;
    emit('gameplay_action', 'request_id_conflict', base);
    return;
  }
  counters.actionRejected += 1;
  emit('gameplay_action', 'rejected', base);
}

declare global {
  interface Window {
    __racehorseMpTelemetry?: {
      getCounters: () => Readonly<MpTelemetryCounters>;
      reset: () => void;
    };
  }
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__racehorseMpTelemetry = {
    getCounters: getMpTelemetryCountersForTests,
    reset: resetMpTelemetryForTests,
  };
}
