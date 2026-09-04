import { isSupportedFritzPolicyVersion, type FritzPolicyVersion } from '@racehorse/game-core';
import type { DailyFritzAttemptRecord } from '../stores/dailyFritzStore';
import { getCurrentDailyFritzGameNumber } from '../stores/dailyFritzStore';

export const DAILY_FRITZ_CHECKPOINT_SCHEMA_VERSION = 9;

/**
 * Must stay in sync with the client's phases in
 * `client/src/modules/daily/useDailyFritzSessionPersistence.ts`. It emitted
 * 'completed' at game over while this list held only two values, so every
 * game-ending checkpoint 400'd as malformed and no resume point was ever
 * stored — which is why a failed save had nothing to fall back to.
 */
export type DailyFritzServerCheckpointPhase = 'active_hand' | 'hand_transition' | 'completed';

export type DailyFritzServerCheckpoint = {
  schemaVersion: typeof DAILY_FRITZ_CHECKPOINT_SCHEMA_VERSION;
  attemptId: string;
  runFingerprint: string;
  gameNumber: number;
  currentHandIndex: number;
  authorityRevision: number;
  lifecyclePhase: DailyFritzServerCheckpointPhase;
  checkpointRevision: number;
  lastTransitionAt: string;
  match: Record<string, unknown>;
  handResult: Record<string, unknown> | null;
  movesUsed: number;
  moveLog: unknown[];
  transcript: Record<string, unknown> | null;
  verificationPhase: 'collecting' | 'pending';
  startedAt: string;
  transcriptProtocolVersion?: 1 | 2;
  fritzPolicyVersion?: FritzPolicyVersion;
  fritzPolicyContract?: string;
  challenge?: {
    challengeDate: string;
    challengeId: string;
    rulesVersion: number;
    seedVersion: number;
  };
};

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nonNegativeInteger = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;

const validIso = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const validTile = (value: unknown) => object(value)
  && Number.isInteger(value.low)
  && Number.isInteger(value.high)
  && Number(value.low) >= 0
  && Number(value.low) <= 6
  && Number(value.high) >= 0
  && Number(value.high) <= 6;

function validMatch(value: unknown): value is Record<string, unknown> {
  if (!object(value) || !object(value.players) || !object(value.players.you) || !object(value.players.bot)) {
    return false;
  }
  const you = value.players.you as Record<string, unknown>;
  const bot = value.players.bot as Record<string, unknown>;
  return Array.isArray(you.hand) && you.hand.every(validTile)
    && Array.isArray(bot.hand) && bot.hand.every(validTile)
    && Array.isArray(value.boneyard) && value.boneyard.every(validTile)
    && Array.isArray(value.deadTiles) && value.deadTiles.every(validTile)
    && Number.isFinite(you.score) && Number(you.score) >= 0
    && Number.isFinite(bot.score) && Number(bot.score) >= 0
    && nonNegativeInteger(value.handNumber)
    && typeof value.handOver === 'boolean'
    && typeof value.gameOver === 'boolean';
}

function validHandResult(value: unknown): value is Record<string, unknown> | null {
  if (value === null) return true;
  if (!object(value)) return false;
  return (value.winner === 'you' || value.winner === 'bot' || value.winner === null)
    && (value.reason === 'domino' || value.reason === 'blocked')
    && Number.isFinite(value.pointsAwarded) && Number(value.pointsAwarded) >= 0
    && Array.isArray(value.yourRemainingTiles) && value.yourRemainingTiles.every(validTile)
    && Array.isArray(value.botRemainingTiles) && value.botRemainingTiles.every(validTile);
}

export function readDailyFritzActiveCheckpoint(
  result: Record<string, unknown> | null | undefined,
): DailyFritzServerCheckpoint | null {
  if (!object(result) || !object(result.active_checkpoint)) return null;
  return parseDailyFritzServerCheckpoint(result.active_checkpoint);
}

export function writeDailyFritzActiveCheckpoint(
  result: Record<string, unknown> | null | undefined,
  checkpoint: DailyFritzServerCheckpoint,
): Record<string, unknown> {
  return {
    ...(result ?? {}),
    active_checkpoint: checkpoint,
  };
}

export function clearDailyFritzActiveCheckpoint(
  result: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!object(result) || !('active_checkpoint' in result)) return result ?? {};
  const next = { ...result };
  delete next.active_checkpoint;
  return next;
}

export function parseDailyFritzServerCheckpoint(value: unknown): DailyFritzServerCheckpoint | null {
  if (!object(value) || value.schemaVersion !== DAILY_FRITZ_CHECKPOINT_SCHEMA_VERSION) return null;
  if (typeof value.attemptId !== 'string' || !value.attemptId) return null;
  if (typeof value.runFingerprint !== 'string' || !value.runFingerprint) return null;
  if (!nonNegativeInteger(value.gameNumber) || !nonNegativeInteger(value.currentHandIndex)) return null;
  if (!nonNegativeInteger(value.authorityRevision) || !nonNegativeInteger(value.checkpointRevision)) return null;
  if (!validIso(value.startedAt) || !validIso(value.lastTransitionAt)) return null;
  if (Date.parse(String(value.lastTransitionAt)) < Date.parse(String(value.startedAt))) return null;
  if (!['active_hand', 'hand_transition', 'completed'].includes(String(value.lifecyclePhase))) return null;
  if (!validMatch(value.match) || !validHandResult(value.handResult)) return null;
  if (!nonNegativeInteger(value.movesUsed) || !Array.isArray(value.moveLog)) return null;
  const phase = value.lifecyclePhase as DailyFritzServerCheckpointPhase;
  const match = value.match as Record<string, unknown>;
  if (phase === 'active_hand' && (match.handOver === true || match.gameOver === true)) return null;
  if (phase === 'hand_transition' && (match.handOver !== true || match.gameOver === true || value.handResult === null)) {
    return null;
  }
  // 'completed' is the terminal checkpoint: the game is over, so the two
  // in-play phases above cannot describe it.
  if (phase === 'completed' && match.gameOver !== true) return null;
  if (Number(match.handNumber) !== Number(value.currentHandIndex) + 1) return null;
  const verificationPhase = value.verificationPhase === 'pending' ? 'pending' : 'collecting';
  const transcriptProtocolVersion = value.transcriptProtocolVersion === 2 ? 2 : 1;
  if (value.fritzPolicyVersion != null && !isSupportedFritzPolicyVersion(value.fritzPolicyVersion)) {
    return null;
  }
  if (value.fritzPolicyContract != null && typeof value.fritzPolicyContract !== 'string') return null;
  return {
    schemaVersion: DAILY_FRITZ_CHECKPOINT_SCHEMA_VERSION,
    attemptId: value.attemptId,
    runFingerprint: value.runFingerprint,
    gameNumber: Number(value.gameNumber),
    currentHandIndex: Number(value.currentHandIndex),
    authorityRevision: Number(value.authorityRevision),
    lifecyclePhase: phase,
    checkpointRevision: Number(value.checkpointRevision),
    lastTransitionAt: String(value.lastTransitionAt),
    match,
    handResult: value.handResult === null ? null : value.handResult as Record<string, unknown>,
    movesUsed: Number(value.movesUsed),
    moveLog: value.moveLog,
    transcript: object(value.transcript) ? value.transcript : null,
    verificationPhase,
    startedAt: String(value.startedAt),
    transcriptProtocolVersion,
    fritzPolicyVersion: isSupportedFritzPolicyVersion(value.fritzPolicyVersion)
      ? value.fritzPolicyVersion
      : undefined,
    fritzPolicyContract: typeof value.fritzPolicyContract === 'string' ? value.fritzPolicyContract : undefined,
    challenge: object(value.challenge)
      && typeof value.challenge.challengeDate === 'string'
      && typeof value.challenge.challengeId === 'string'
      && Number.isInteger(value.challenge.rulesVersion)
      && Number.isInteger(value.challenge.seedVersion)
      ? {
          challengeDate: value.challenge.challengeDate,
          challengeId: value.challenge.challengeId,
          rulesVersion: Number(value.challenge.rulesVersion),
          seedVersion: Number(value.challenge.seedVersion),
        }
      : undefined,
  };
}

export type DailyFritzCheckpointRejectReason =
  | 'malformed_checkpoint'
  | 'attempt_mismatch'
  | 'verified_match_mismatch'
  | 'game_mismatch'
  | 'hand_mismatch'
  | 'revision_mismatch'
  | 'stale_checkpoint'
  | 'attempt_locked';

export function validateDailyFritzCheckpointWrite(
  attempt: DailyFritzAttemptRecord,
  verifiedMatchId: string,
  checkpoint: DailyFritzServerCheckpoint,
  existing: DailyFritzServerCheckpoint | null,
): { ok: true } | { ok: false; reason: DailyFritzCheckpointRejectReason } {
  if (attempt.status !== 'started') return { ok: false, reason: 'attempt_locked' };
  if (checkpoint.attemptId !== attempt.id) return { ok: false, reason: 'attempt_mismatch' };
  if (attempt.verifiedMatchId && attempt.verifiedMatchId !== verifiedMatchId) {
    return { ok: false, reason: 'verified_match_mismatch' };
  }
  const gameNumber = getCurrentDailyFritzGameNumber(attempt.result) ?? attempt.currentGameNumber ?? 1;
  if (checkpoint.gameNumber !== gameNumber) return { ok: false, reason: 'game_mismatch' };
  if (checkpoint.currentHandIndex !== attempt.currentHandIndex) return { ok: false, reason: 'hand_mismatch' };
  if (checkpoint.authorityRevision !== attempt.revision) return { ok: false, reason: 'revision_mismatch' };
  if (existing && checkpoint.checkpointRevision <= existing.checkpointRevision) {
    return { ok: false, reason: 'stale_checkpoint' };
  }
  return { ok: true };
}

export function resolveDailyFritzResumeCheckpoint(
  attempt: DailyFritzAttemptRecord,
  runFingerprint: string,
): DailyFritzServerCheckpoint | null {
  const checkpoint = readDailyFritzActiveCheckpoint(attempt.result);
  if (!checkpoint) return null;
  if (checkpoint.attemptId !== attempt.id) return null;
  if (checkpoint.runFingerprint !== runFingerprint) return null;
  const gameNumber = getCurrentDailyFritzGameNumber(attempt.result) ?? attempt.currentGameNumber ?? 1;
  if (checkpoint.gameNumber !== gameNumber) return null;
  if (checkpoint.currentHandIndex !== attempt.currentHandIndex) return null;
  if (checkpoint.authorityRevision !== attempt.revision) return null;
  return checkpoint;
}
