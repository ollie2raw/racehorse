import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotHandReveal } from '../match/types.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import { createDailyFritzChallengeIdentity, isDailyFritzChallengeCurrent, type DailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import type { DailyFritzTranscript } from '@racehorse/game-core';
import { canonicalizeDailyFritzMoveLog } from '../../dailyFritz/dailyFritzMoveEvidence.ts';

// Bump when the local match state is no longer safe to replay against the
// server verifier. Version 9 binds every checkpoint to the server authority
// revision and rejects match/index pairs torn across a hand transition.
export const DAILY_FRITZ_SESSION_SCHEMA_VERSION = 9;
export type DailyFritzPersistedPhase = 'active_hand' | 'hand_transition' | 'completed';

export type DailyFritzAuthorityCursor = {
  gameNumber: number;
  handIndex: number;
  revision: number;
};

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

export type DailyFritzPersistedSnapshot = {
  schemaVersion: 9;
  challenge: DailyFritzChallengeIdentity;
  classification: 'official';
  attemptId: string;
  /** Binds resume to the exact published run (seed/deals/status). */
  runFingerprint: string;
  gameNumber: number;
  currentHandIndex: number;
  /** Server attempt revision from which this hand state was derived. */
  authorityRevision: number;
  lifecyclePhase: DailyFritzPersistedPhase;
  match: BotMatchState;
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
  fritzPolicyVersion?: 1 | 2;
  fritzPolicyContract?: string;
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

export function parseDailyFritzPersistedSnapshot(value: unknown, now = new Date()): DailyFritzPersistedSnapshot | null {
  if (!object(value) || value.schemaVersion !== DAILY_FRITZ_SESSION_SCHEMA_VERSION || value.classification !== 'official') return null;
  if (!validChallenge(value.challenge) || !isDailyFritzChallengeCurrent(value.challenge, now)) return null;
  if (typeof value.attemptId !== 'string' || !value.attemptId || typeof value.runFingerprint !== 'string' || !value.runFingerprint) return null;
  if (!nonNegativeInteger(value.gameNumber) || !nonNegativeInteger(value.currentHandIndex) || !nonNegativeInteger(value.authorityRevision)) return null;
  if (!['active_hand','hand_transition','completed'].includes(String(value.lifecyclePhase)) || !validMatch(value.match)) return null;
  if (!nonNegativeInteger(value.movesUsed) || !Array.isArray(value.moveLog) || !validHandResult(value.handResult) || !validIso(value.startedAt) || !validIso(value.lastTransitionAt) || Date.parse(value.lastTransitionAt) < Date.parse(value.startedAt) || !nonNegativeInteger(value.checkpointRevision)) return null;
  const phase = value.lifecyclePhase as DailyFritzPersistedPhase;
  const match = value.match as BotMatchState;
  if (phase === 'active_hand' && (match.handOver || match.gameOver)) return null;
  if (phase === 'hand_transition' && (!match.handOver || match.gameOver || value.handResult === null)) return null;
  if (phase === 'completed' && !match.gameOver) return null;
  if (match.handNumber !== Number(value.currentHandIndex) + 1) return null;
  const verificationPhase = value.verificationPhase === 'pending' ? 'pending' : 'collecting';
  const transcriptProtocolVersion = value.transcriptProtocolVersion === 2 ? 2 : 1;
  if (value.fritzPolicyVersion != null && value.fritzPolicyVersion !== 1 && value.fritzPolicyVersion !== 2) return null;
  if (value.fritzPolicyContract != null && typeof value.fritzPolicyContract !== 'string') return null;
  return {
    ...value,
    schemaVersion: DAILY_FRITZ_SESSION_SCHEMA_VERSION,
    runFingerprint: value.runFingerprint,
    transcript: object(value.transcript) ? value.transcript as unknown as DailyFritzTranscript : null,
    moveLog: canonicalizeDailyFritzMoveLog(value.moveLog as MoveEntry[]),
    verificationPhase,
    transcriptProtocolVersion,
  } as unknown as DailyFritzPersistedSnapshot;
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
  if (snapshot.gameNumber !== authority.cursor.gameNumber) return { accepted: false, reason: 'game_mismatch' };
  if (snapshot.currentHandIndex !== authority.cursor.handIndex) return { accepted: false, reason: 'hand_mismatch' };
  if (snapshot.authorityRevision !== authority.cursor.revision) return { accepted: false, reason: 'revision_mismatch' };
  if (snapshot.match.handNumber !== authority.cursor.handIndex + 1) {
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
    schemaVersion: DAILY_FRITZ_SESSION_SCHEMA_VERSION,
    classification: 'official',
    challenge: validChallenge(checkpoint.challenge)
      ? checkpoint.challenge
      : createDailyFritzChallengeIdentity(runDate),
  };
  return parseDailyFritzPersistedSnapshot(withChallenge, now);
}

export function persistDailyFritzSnapshot(storageKey: string, snapshot: DailyFritzPersistedSnapshot): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const existingRaw = window.localStorage.getItem(storageKey);
    const existing = existingRaw ? JSON.parse(existingRaw) as unknown : null;
    if (object(existing) && existing.schemaVersion === DAILY_FRITZ_SESSION_SCHEMA_VERSION) {
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
