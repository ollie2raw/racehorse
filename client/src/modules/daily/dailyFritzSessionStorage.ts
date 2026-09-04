import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotHandReveal } from '../match/types.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import { createDailyFritzChallengeIdentity, isDailyFritzChallengeCurrent, type DailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import { isSupportedFritzPolicyVersion, type DailyFritzTranscript, type FritzPolicyVersion } from '@racehorse/game-core';
import { canonicalizeDailyFritzMoveLog } from '../../dailyFritz/dailyFritzMoveEvidence.ts';
import type { DailyFritzAuthorityCursor, DailyFritzMatchSession } from './dailyFritzMatchSession.ts';
import { isCoherentDailyFritzSession } from './dailyFritzMatchSession.ts';

/** Canonical client checkpoint schema — stores `session` as the authority blob. */
export const DAILY_FRITZ_SESSION_SCHEMA_VERSION = 10;
/** Legacy flat cursor + match layout (still accepted on read; upgraded in memory). */
export const DAILY_FRITZ_LEGACY_SESSION_SCHEMA_VERSION = 9;
/** Server checkpoint parser version — unchanged until a dedicated server migration. */
export const DAILY_FRITZ_SERVER_CHECKPOINT_SCHEMA_VERSION = 9;

export type DailyFritzPersistedPhase = 'active_hand' | 'hand_transition' | 'completed';

export type DailyFritzResumeRejection =
  | 'attempt_mismatch'
  | 'challenge_mismatch'
  | 'run_mismatch'
  | 'game_mismatch'
  | 'hand_mismatch'
  | 'revision_mismatch'
  | 'match_hand_mismatch'
  | 'policy_mismatch';

export type DailyFritzResumeReconciliation =
  | { accepted: true; snapshot: DailyFritzPersistedSnapshot }
  | { accepted: false; reason: DailyFritzResumeRejection };

/** Normalized in-memory checkpoint (always schema 10 after parse). */
export type DailyFritzPersistedSnapshot = {
  schemaVersion: typeof DAILY_FRITZ_SESSION_SCHEMA_VERSION;
  session: DailyFritzMatchSession;
  challenge: DailyFritzChallengeIdentity;
  classification: 'official';
  attemptId: string;
  /** Binds resume to the exact published run (seed/deals/status). */
  runFingerprint: string;
  /** Denormalized compat fields — derived from `session` on write (one-release bridge). */
  gameNumber: number;
  currentHandIndex: number;
  authorityRevision: number;
  match: BotMatchState;
  lifecyclePhase: DailyFritzPersistedPhase;
  handResult: BotHandReveal | null;
  movesUsed: number;
  moveLog: MoveEntry[];
  transcript: DailyFritzTranscript | null;
  verificationPhase: 'collecting' | 'pending';
  startedAt: string;
  lastTransitionAt: string;
  /** Monotonic local write sequence; never used as server authority. */
  checkpointRevision: number;
  /** Protocol used to encode the persisted move log. Missing means legacy v1. */
  transcriptProtocolVersion?: 1 | 2;
  fritzPolicyVersion?: FritzPolicyVersion;
  fritzPolicyContract?: string;
};

type ParsedCheckpointEnvelope = Omit<
  DailyFritzPersistedSnapshot,
  'schemaVersion' | 'session' | 'gameNumber' | 'currentHandIndex' | 'authorityRevision' | 'match'
> & {
  gameNumber: number;
  currentHandIndex: number;
  authorityRevision: number;
  match: BotMatchState;
};

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validIso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonNegativeInteger = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
const validTile = (value: unknown) => object(value)
  && Number.isInteger(value.low)
  && Number.isInteger(value.high)
  && Number(value.low) >= 0
  && Number(value.low) <= 6
  && Number(value.high) >= 0
  && Number(value.high) <= 6;

function validMatch(value: unknown): value is BotMatchState {
  if (!object(value) || !object(value.players) || !object(value.players.you) || !object(value.players.bot)) return false;
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

function validChallenge(value: unknown): value is DailyFritzChallengeIdentity {
  return object(value) && typeof value.challengeDate === 'string' && typeof value.challengeId === 'string'
    && Number.isInteger(value.rulesVersion) && Number.isInteger(value.seedVersion);
}

function validHandResult(value: unknown): value is BotHandReveal | null {
  if (value === null) return true;
  return object(value) && (value.winner === 'you' || value.winner === 'bot' || value.winner === null)
    && (value.reason === 'domino' || value.reason === 'blocked')
    && Number.isFinite(value.pointsAwarded) && Number(value.pointsAwarded) >= 0
    && Array.isArray(value.yourRemainingTiles) && value.yourRemainingTiles.every(validTile)
    && Array.isArray(value.botRemainingTiles) && value.botRemainingTiles.every(validTile);
}

function validSessionCursor(value: unknown): value is DailyFritzAuthorityCursor {
  if (!object(value)) return false;
  const gameNumber = Number(value.gameNumber);
  if (gameNumber !== 1 && gameNumber !== 2 && gameNumber !== 3) return false;
  return nonNegativeInteger(value.handIndex) && nonNegativeInteger(value.revision);
}

function validSession(value: unknown): value is DailyFritzMatchSession {
  if (!object(value) || !validSessionCursor(value.cursor) || !validMatch(value.match)) return false;
  return isCoherentDailyFritzSession({
    cursor: {
      gameNumber: Number(value.cursor.gameNumber) as DailyFritzAuthorityCursor['gameNumber'],
      handIndex: Number(value.cursor.handIndex),
      revision: Number(value.cursor.revision),
    },
    match: value.match as BotMatchState,
  });
}

function denormalizedFieldsMatchSession(
  session: DailyFritzMatchSession,
  gameNumber: number,
  currentHandIndex: number,
  authorityRevision: number,
  match: BotMatchState,
): boolean {
  return session.cursor.gameNumber === gameNumber
    && session.cursor.handIndex === currentHandIndex
    && session.cursor.revision === authorityRevision
    && match.handNumber === session.match.handNumber
    && match.handNumber === currentHandIndex + 1
    && match.handOver === session.match.handOver
    && match.gameOver === session.match.gameOver;
}

export function buildDailyFritzMatchSessionFromLegacyFields(input: {
  gameNumber: number;
  currentHandIndex: number;
  authorityRevision: number;
  match: BotMatchState;
}): DailyFritzMatchSession {
  return {
    cursor: {
      gameNumber: input.gameNumber as DailyFritzAuthorityCursor['gameNumber'],
      handIndex: input.currentHandIndex,
      revision: input.authorityRevision,
    },
    match: input.match,
  };
}

export function deriveLegacyFieldsFromSession(session: DailyFritzMatchSession): {
  gameNumber: number;
  currentHandIndex: number;
  authorityRevision: number;
  match: BotMatchState;
} {
  return {
    gameNumber: session.cursor.gameNumber,
    currentHandIndex: session.cursor.handIndex,
    authorityRevision: session.cursor.revision,
    match: session.match,
  };
}

function finalizeParsedCheckpoint(
  envelope: ParsedCheckpointEnvelope,
  session: DailyFritzMatchSession,
): DailyFritzPersistedSnapshot {
  const legacy = deriveLegacyFieldsFromSession(session);
  return {
    ...envelope,
    schemaVersion: DAILY_FRITZ_SESSION_SCHEMA_VERSION,
    session,
    gameNumber: legacy.gameNumber,
    currentHandIndex: legacy.currentHandIndex,
    authorityRevision: legacy.authorityRevision,
    match: legacy.match,
  };
}

function parseCheckpointEnvelope(value: Record<string, unknown>, now: Date): ParsedCheckpointEnvelope | null {
  if (value.classification !== 'official') return null;
  if (!validChallenge(value.challenge) || !isDailyFritzChallengeCurrent(value.challenge, now)) return null;
  if (typeof value.attemptId !== 'string' || !value.attemptId || typeof value.runFingerprint !== 'string' || !value.runFingerprint) return null;
  if (!nonNegativeInteger(value.gameNumber) || !nonNegativeInteger(value.currentHandIndex) || !nonNegativeInteger(value.authorityRevision)) return null;
  if (!['active_hand', 'hand_transition', 'completed'].includes(String(value.lifecyclePhase)) || !validMatch(value.match)) return null;
  if (!nonNegativeInteger(value.movesUsed) || !Array.isArray(value.moveLog) || !validHandResult(value.handResult) || !validIso(value.startedAt) || !validIso(value.lastTransitionAt) || Date.parse(String(value.lastTransitionAt)) < Date.parse(String(value.startedAt)) || !nonNegativeInteger(value.checkpointRevision)) return null;

  const phase = value.lifecyclePhase as DailyFritzPersistedPhase;
  const match = value.match as BotMatchState;
  if (phase === 'active_hand' && (match.handOver || match.gameOver)) return null;
  if (phase === 'hand_transition' && (!match.handOver || match.gameOver || value.handResult === null)) return null;
  if (phase === 'completed' && !match.gameOver) return null;
  if (match.handNumber !== Number(value.currentHandIndex) + 1) return null;

  const verificationPhase = value.verificationPhase === 'pending' ? 'pending' : 'collecting';
  const transcriptProtocolVersion = value.transcriptProtocolVersion === 2 ? 2 : 1;
  if (value.fritzPolicyVersion != null && !isSupportedFritzPolicyVersion(value.fritzPolicyVersion)) return null;
  if (value.fritzPolicyContract != null && typeof value.fritzPolicyContract !== 'string') return null;

  return {
    challenge: value.challenge,
    classification: 'official',
    attemptId: value.attemptId,
    runFingerprint: value.runFingerprint,
    gameNumber: Number(value.gameNumber),
    currentHandIndex: Number(value.currentHandIndex),
    authorityRevision: Number(value.authorityRevision),
    lifecyclePhase: phase,
    match,
    handResult: value.handResult as BotHandReveal | null,
    movesUsed: Number(value.movesUsed),
    moveLog: canonicalizeDailyFritzMoveLog(value.moveLog as MoveEntry[]),
    transcript: object(value.transcript) ? value.transcript as unknown as DailyFritzTranscript : null,
    verificationPhase,
    startedAt: String(value.startedAt),
    lastTransitionAt: String(value.lastTransitionAt),
    checkpointRevision: Number(value.checkpointRevision),
    transcriptProtocolVersion,
    ...(isSupportedFritzPolicyVersion(value.fritzPolicyVersion)
      ? { fritzPolicyVersion: value.fritzPolicyVersion }
      : {}),
    ...(typeof value.fritzPolicyContract === 'string'
      ? { fritzPolicyContract: value.fritzPolicyContract }
      : {}),
  };
}

function parseSchema10Checkpoint(value: Record<string, unknown>, now: Date): DailyFritzPersistedSnapshot | null {
  if (!validSession(value.session)) return null;
  const envelope = parseCheckpointEnvelope(value, now);
  if (!envelope) return null;
  const session = value.session as DailyFritzMatchSession;
  if (!denormalizedFieldsMatchSession(
    session,
    envelope.gameNumber,
    envelope.currentHandIndex,
    envelope.authorityRevision,
    envelope.match,
  )) {
    return null;
  }
  return finalizeParsedCheckpoint(envelope, session);
}

function parseLegacySchema9Checkpoint(value: Record<string, unknown>, now: Date): DailyFritzPersistedSnapshot | null {
  const envelope = parseCheckpointEnvelope(value, now);
  if (!envelope) return null;
  const session = buildDailyFritzMatchSessionFromLegacyFields({
    gameNumber: envelope.gameNumber,
    currentHandIndex: envelope.currentHandIndex,
    authorityRevision: envelope.authorityRevision,
    match: envelope.match,
  });
  return finalizeParsedCheckpoint(envelope, session);
}

export function parseDailyFritzPersistedSnapshot(value: unknown, now = new Date()): DailyFritzPersistedSnapshot | null {
  if (!object(value)) return null;
  if (value.schemaVersion === DAILY_FRITZ_SESSION_SCHEMA_VERSION) {
    return parseSchema10Checkpoint(value, now);
  }
  if (value.schemaVersion === DAILY_FRITZ_LEGACY_SESSION_SCHEMA_VERSION) {
    return parseLegacySchema9Checkpoint(value, now);
  }
  return null;
}

/** Build a schema-10 checkpoint with denormalized compat fields derived from `session`. */
export function buildDailyFritzPersistedSnapshot(
  session: DailyFritzMatchSession,
  fields: Omit<
    ParsedCheckpointEnvelope,
    'gameNumber' | 'currentHandIndex' | 'authorityRevision' | 'match'
  >,
): DailyFritzPersistedSnapshot {
  const legacy = deriveLegacyFieldsFromSession(session);
  return finalizeParsedCheckpoint({
    ...fields,
    gameNumber: legacy.gameNumber,
    currentHandIndex: legacy.currentHandIndex,
    authorityRevision: legacy.authorityRevision,
    match: legacy.match,
  }, session);
}

/**
 * Server checkpoint route still validates schema 9 flat layout.
 * Strip `session` and emit v9 wire fields derived from the canonical blob.
 */
export function serializeDailyFritzCheckpointForServer(
  snapshot: DailyFritzPersistedSnapshot,
): Record<string, unknown> {
  const legacy = deriveLegacyFieldsFromSession(snapshot.session);
  const { session: _session, schemaVersion: _schemaVersion, ...rest } = snapshot;
  return {
    ...rest,
    schemaVersion: DAILY_FRITZ_SERVER_CHECKPOINT_SCHEMA_VERSION,
    gameNumber: legacy.gameNumber,
    currentHandIndex: legacy.currentHandIndex,
    authorityRevision: legacy.authorityRevision,
    match: legacy.match,
  };
}

export function reconcileDailyFritzResume(
  snapshot: DailyFritzPersistedSnapshot,
  authority: {
    attemptId: string;
    challengeId: string;
    runFingerprint?: string | null;
    cursor: DailyFritzAuthorityCursor;
    fritzPolicyVersion?: number | null;
    fritzPolicyContract?: string | null;
  },
): DailyFritzResumeReconciliation {
  if (snapshot.attemptId !== authority.attemptId) return { accepted: false, reason: 'attempt_mismatch' };
  if (snapshot.challenge.challengeId !== authority.challengeId) return { accepted: false, reason: 'challenge_mismatch' };
  if (authority.runFingerprint && snapshot.runFingerprint !== authority.runFingerprint) {
    return { accepted: false, reason: 'run_mismatch' };
  }
  const { cursor, match } = snapshot.session;
  if (cursor.gameNumber !== authority.cursor.gameNumber) return { accepted: false, reason: 'game_mismatch' };
  if (cursor.handIndex !== authority.cursor.handIndex) return { accepted: false, reason: 'hand_mismatch' };
  if (cursor.revision !== authority.cursor.revision) return { accepted: false, reason: 'revision_mismatch' };
  if (match.handNumber !== authority.cursor.handIndex + 1) {
    return { accepted: false, reason: 'match_hand_mismatch' };
  }
  if (
    authority.fritzPolicyVersion != null
    && snapshot.fritzPolicyVersion !== authority.fritzPolicyVersion
  ) return { accepted: false, reason: 'policy_mismatch' };
  if (
    authority.fritzPolicyContract
    && snapshot.fritzPolicyContract !== authority.fritzPolicyContract
  ) return { accepted: false, reason: 'policy_mismatch' };
  return { accepted: true, snapshot };
}

export function buildDailyFritzStorageKey(attemptId: string, gameNumber: number): string {
  return `racehorse:daily-fritz:v3:${attemptId}:game:${gameNumber}`;
}

export function resolveDailyFritzStorageKey(mode: string, dailyFritzPackage: DailyFritzStartResponse | null | undefined): string | null {
  if (mode !== 'daily-fritz' || !dailyFritzPackage) return null;
  return buildDailyFritzStorageKey(dailyFritzPackage.attempt_id, dailyFritzPackage.current_game_number ?? 1);
}

export function dailyFritzServerCheckpointToSnapshot(
  checkpoint: Record<string, unknown>,
  runDate: string,
  now = new Date(),
): DailyFritzPersistedSnapshot | null {
  const withChallenge = {
    ...checkpoint,
    schemaVersion: checkpoint.schemaVersion ?? DAILY_FRITZ_LEGACY_SESSION_SCHEMA_VERSION,
    classification: checkpoint.classification ?? 'official',
    challenge: validChallenge(checkpoint.challenge)
      ? checkpoint.challenge
      : createDailyFritzChallengeIdentity(runDate),
  };
  return parseDailyFritzPersistedSnapshot(withChallenge, now);
}

function isKnownCheckpointSchemaVersion(schemaVersion: unknown): boolean {
  return schemaVersion === DAILY_FRITZ_SESSION_SCHEMA_VERSION
    || schemaVersion === DAILY_FRITZ_LEGACY_SESSION_SCHEMA_VERSION;
}

export function persistDailyFritzSnapshot(storageKey: string, snapshot: DailyFritzPersistedSnapshot): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const existingRaw = window.localStorage.getItem(storageKey);
    const existing = existingRaw ? JSON.parse(existingRaw) as unknown : null;
    if (object(existing) && isKnownCheckpointSchemaVersion(existing.schemaVersion)) {
      const revision = Number(existing.checkpointRevision);
      const transitionAt = typeof existing.lastTransitionAt === 'string'
        ? Date.parse(existing.lastTransitionAt)
        : Number.NaN;
      if (
        (Number.isInteger(revision) && revision > snapshot.checkpointRevision)
        || (Number.isFinite(transitionAt) && transitionAt > Date.parse(snapshot.lastTransitionAt))
      ) return false;
    }
    window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    return true;
  } catch { return false; }
}

export function discardDailyFritzSnapshot(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    /* localStorage may be unavailable */
  }
}

/** Remove any checkpoint re-persisted after an authority rejection, then reload. */
export function discardDailyFritzSnapshotBeforeReload(
  storageKey: string,
  reload: () => void,
): void {
  discardDailyFritzSnapshot(storageKey);
  reload();
}

export function pruneNonPlayableDailyFritzSnapshot(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try { const raw=window.localStorage.getItem(storageKey); if(raw && !parseDailyFritzPersistedSnapshot(JSON.parse(raw))) window.localStorage.removeItem(storageKey); } catch { window.localStorage.removeItem(storageKey); }
}
