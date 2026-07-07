import {
  hasProcessedTransportEventId,
  type SocketEpisodeProjectionGate,
} from '../socketEventBus';

/** Drop post-resync / reconnect ghost replays before projection (Phase F). */
export const STATE_REPLAY_SILENT_DROP_GAP = 50;

export function shouldDropPreProjectionStateReplay(
  watermark: number,
  incoming: number | undefined | null,
): boolean {
  if (typeof incoming !== 'number' || !Number.isFinite(incoming)) {
    return false;
  }
  if (watermark < 0) {
    return false;
  }
  return incoming < watermark - STATE_REPLAY_SILENT_DROP_GAP;
}

export function shouldDropStaleEpisodeStateUpdate(
  currentEpisodeSequence: number,
  incomingEpisodeSequence: number | undefined,
  busEpisodeSequence: number,
): boolean {
  const effectiveEpisode = Math.max(currentEpisodeSequence, busEpisodeSequence);
  if (typeof incomingEpisodeSequence !== 'number') {
    return false;
  }
  return incomingEpisodeSequence < effectiveEpisode;
}

export function nextEpisodeSequenceCursor(
  currentEpisodeSequence: number,
  incomingEpisodeSequence: number | undefined,
  busEpisodeSequence: number,
): number {
  const effectiveEpisode = Math.max(currentEpisodeSequence, busEpisodeSequence);
  if (typeof incomingEpisodeSequence !== 'number') {
    return effectiveEpisode;
  }
  return Math.max(effectiveEpisode, incomingEpisodeSequence);
}

export function shouldDropTransportReplayProjection(transportId: string | undefined): boolean {
  if (!transportId) {
    return false;
  }
  return hasProcessedTransportEventId(transportId);
}

export function shouldDropStaleProjectionCommit(
  currentCommit: symbol | null,
  commitId: symbol,
): boolean {
  return currentCommit !== commitId;
}

/** Drop late state updates for a closed episode (Phase J). */
export function shouldDropClosedEpisodeProjection(
  gate: SocketEpisodeProjectionGate,
  incomingEpisodeSequence: number | undefined,
): boolean {
  if (!gate.isClosed) {
    return false;
  }
  if (typeof incomingEpisodeSequence !== 'number') {
    return false;
  }
  return incomingEpisodeSequence === gate.id;
}