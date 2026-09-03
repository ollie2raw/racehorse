import * as Sentry from '@sentry/node';
import { parseDailyFritzTranscript, type DailyFritzTranscript } from '@racehorse/game-core';
import type { Response } from 'express';
import {
  getDailyFritzSeed,
  resolveDailyFritzDrawWinner,
  type DailyFritzSetGameNumber,
} from '../../dailyFritz';
import { buildDailyFritzChallengeId } from '../../dailyFritzIdentity';
import {
  DailyFritzVerificationError,
  createOfficialDailyFritzHandState,
  digestDailyFritzTranscript,
  verifyDailyFritzHand,
  type VerifiedDailyFritzHandRecord,
} from '../../dailyFritzVerifier';
import {
  buildDailyFritzRunFingerprint,
  getDailyFritzHandForGame,
  type DailyFritzAttemptRecord,
  type DailyFritzRunRecord,
} from '../stores/dailyFritzStore';
import {
  DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  readAuthorityLedger,
  buildDailyFritzAuthorityContract,
  readDailyFritzAuthorityContract,
  writeDailyFritzAuthorityContract,
  type VerifiedDailyFritzGameRecord,
} from './dailyFritzVerificationPolicy';
import {
  countRecentDailyFritzVerificationFailures,
  recordDailyFritzEvent,
  type DailyFritzEventInput,
} from '../stores/dailyFritzEventStore';
import { incrementDailyFritzMetric } from './dailyFritzMetrics';
import { resolveDailyFritzPublishedGameAuthority } from './dailyFritzPublishedAuthority';
import type { DailyFritzPublishedChallenge } from '../../dailyFritzPublishedChallenge';
import { isDailyFritzTransactionalAuthorityEnabled } from '../../dailyFritzAuthorityFeature';
import { log, capture500 } from './dailyFritzRouteErrors';

/**
 * Mirrors client/src/dailyFritz/dailyFritzNextHandFailurePolicy.ts's
 * REBUILD_CODES. Any verifier code NOT in this set makes the client fall
 * straight through to the permanently-stuck "Couldn't verify this hand yet"
 * Hand Over banner with no auto-retry — i.e. this is exactly the set of
 * codes a real player is stranded on. Keep in sync with the client file.
 */
const CLIENT_STUCK_CODES = new Set([
  'malformed_transcript',
  'challenge_mismatch',
  'attempt_mismatch',
  'game_mismatch',
  'hand_mismatch',
  'illegal_action',
  'post_play_recovery_draw',
  'post_terminal_action',
  'fritz_recovery_failed',
  'fritz_policy_version_mismatch',
  'fritz_policy_contract_mismatch',
]);

/**
 * How many times a client must have failed to get a hand verified before the
 * server will let the run continue without a verification receipt.
 *
 * Keep in sync with client
 * `DAILY_FRITZ_UNVERIFIED_FALLBACK_AFTER_ATTEMPTS` (currently 2): the client
 * starts sending `unverified_fallback` once failureAttempt reaches that floor.
 */
export const DAILY_FRITZ_UNVERIFIED_FALLBACK_MIN_ATTEMPTS = 2;

export function readDailyFritzUnverifiedFallbackRequest(body: unknown): number | null {
  const record = (body ?? {}) as Record<string, unknown>;
  if (record.unverified_fallback !== true) return null;
  const attempts = Number(record.verification_attempts);
  if (!Number.isFinite(attempts)) return null;
  const rounded = Math.floor(attempts);
  return rounded >= DAILY_FRITZ_UNVERIFIED_FALLBACK_MIN_ATTEMPTS ? rounded : null;
}

/**
 * Infrastructure verifier codes must not burn a competitive run on the first
 * failure. The client retries, then explicitly sends unverified_fallback; only
 * then may we never-strand. Genuine transcript failures still never-strand
 * without that flag (existing /next-hand behavior).
 */
export function canNeverStrandDailyFritzVerification(input: {
  verifierCode: string;
  unverifiedFallbackAttempts: number | null;
}): boolean {
  if (!DAILY_FRITZ_INFRASTRUCTURE_VERIFIER_CODES.has(input.verifierCode)) return true;
  return input.unverifiedFallbackAttempts != null;
}

/**
 * Record that a hand advanced without a verification receipt.
 *
 * `verification_status: 'rejected'` is what removes the run from the
 * leaderboard (isDailyFritzAttemptLeaderboardEligible admits only 'verified'),
 * and it is sticky: no later hand can promote the attempt back to verified.
 * The authority ledger is deliberately left untouched, so the missing receipt
 * remains visible for review.
 */
export function writeUnverifiedDailyFritzHand(
  result: Record<string, unknown> | null,
  input: {
    gameNumber: DailyFritzSetGameNumber;
    handIndex: number;
    verifierCode: string;
    /**
     * Scores after this hand, as reported. NOT authoritative — the attempt is
     * already `rejected` — but they keep the hand-start chain continuous for
     * every later hand. Without them, one unverified hand made every
     * subsequent hand fail with missing_hand_start_progress.
     */
    playerScoreAfter?: number;
    fritzScoreAfter?: number;
  },
): Record<string, unknown> {
  const previous = result ?? {};
  const existing = Array.isArray(previous.unverified_hands) ? previous.unverified_hands : [];
  return {
    ...previous,
    verification_status: 'rejected',
    unverified_hands: [
      ...existing,
      {
        game_number: input.gameNumber,
        hand_index: input.handIndex,
        verifier_code: input.verifierCode,
        recorded_at: new Date().toISOString(),
        ...(Number.isFinite(input.playerScoreAfter) && Number.isFinite(input.fritzScoreAfter)
          ? { player_score_after: input.playerScoreAfter, fritz_score_after: input.fritzScoreAfter }
          : {}),
      },
    ],
  };
}

/**
 * A hand recorded as advanced-without-receipt. Deliberately NOT in the
 * authority ledger: `readAuthorityLedger().hands` is typed as verified
 * records, and anything reading it must keep treating every entry as
 * authoritative. This is the parallel, explicitly-unverified record.
 */
export type UnverifiedDailyFritzHandRecord = {
  gameNumber: number;
  handIndex: number;
  verifierCode: string;
  playerScoreAfter: number | null;
  fritzScoreAfter: number | null;
};

export function findUnverifiedHand(
  result: Record<string, unknown> | null,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
): UnverifiedDailyFritzHandRecord | null {
  const rows = result?.unverified_hands;
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    if (Number(rec.game_number) !== gameNumber || Number(rec.hand_index) !== handIndex) continue;
    const you = Number(rec.player_score_after);
    const fritz = Number(rec.fritz_score_after);
    return {
      gameNumber,
      handIndex,
      verifierCode: String(rec.verifier_code ?? 'unknown'),
      playerScoreAfter: Number.isFinite(you) ? Math.round(you) : null,
      fritzScoreAfter: Number.isFinite(fritz) ? Math.round(fritz) : null,
    };
  }
  return null;
}

export async function recordDailyFritzEventBestEffort(event: DailyFritzEventInput): Promise<void> {
  try {
    await recordDailyFritzEvent(event);
  } catch (error) {
    incrementDailyFritzMetric('event_persistence_failed');
    log.error({
      eventType: event.eventType,
      attemptId: event.attemptId ?? null,
      idempotencyKey: event.idempotencyKey,
      error: error instanceof Error ? error.message : String(error),
    }, '[daily-fritz-event] persistence failed');
  }
}

/**
 * Observability-only: digest + full transcript for reconstruction after
 * verification_failed / advance_unverified / async-schedule. Transcripts are
 * already capped at DAILY_FRITZ_MAX_TRANSCRIPT_BYTES at parse time.
 */
export type DailyFritzTranscriptEvidence = {
  transcriptDigest: string;
  transcript: DailyFritzTranscript;
  actionCount: number;
};

export function buildDailyFritzTranscriptEvidence(
  transcript: DailyFritzTranscript,
): DailyFritzTranscriptEvidence {
  return {
    transcriptDigest: digestDailyFritzTranscript(transcript),
    transcript,
    actionCount: transcript.actions.length,
  };
}

export function dailyFritzTranscriptEvidenceFields(
  transcript: DailyFritzTranscript | null | undefined,
): Pick<DailyFritzEventInput, 'transcriptDigest' | 'payload'> {
  if (!transcript) {
    return { transcriptDigest: null, payload: {} };
  }
  const evidence = buildDailyFritzTranscriptEvidence(transcript);
  return {
    transcriptDigest: evidence.transcriptDigest,
    payload: {
      transcript: evidence.transcript,
      action_count: evidence.actionCount,
    },
  };
}

export type DailyFritzActiveGameProgress = { gameNumber: DailyFritzSetGameNumber; you: number; fritz: number };
export const DAILY_FRITZ_COMPETITIVE_VERIFICATION_AVAILABLE = true;
export const DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED =
  isDailyFritzTransactionalAuthorityEnabled();
export const isRecoverableDailyFritzCommandConflict = (code: string | null): boolean =>
  code === 'stale_revision' || code === 'command_slot_conflict';

export function rejectModernAttemptWhenAuthorityDisabled(
  attempt: DailyFritzAttemptRecord,
  res: Response,
): boolean {
  if (!attempt.challengeId || DAILY_FRITZ_TRANSACTIONAL_COMMANDS_ENABLED) return false;
  res.status(503).json({
    error: 'Daily Fritz verified authority is temporarily unavailable. Your progress is safe.',
    code: 'authority_temporarily_unavailable',
    recoverable: true,
    recovery_action: 'retry',
  });
  return true;
}

export function writeVerifiedHand(
  result: Record<string, unknown> | null,
  hand: VerifiedDailyFritzHandRecord,
): Record<string, unknown> {
  const ledger = readAuthorityLedger(result);
  return {
    ...(result ?? {}),
    authority: { ...ledger, hands: [...ledger.hands, hand] },
    verification_status: 'in_progress',
    verification_protocol_version:
      readDailyFritzAuthorityContract(result)?.transcriptProtocolVersion
      ?? DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  };
}

export function writeVerifiedGame(
  result: Record<string, unknown> | null,
  game: VerifiedDailyFritzGameRecord,
): Record<string, unknown> {
  const ledger = readAuthorityLedger(result);
  return {
    ...(result ?? {}),
    authority: { ...ledger, games: [...ledger.games, game] },
  };
}

export function pinAuthorityContractFromVerifiedTranscript(input: {
  result: Record<string, unknown> | null;
  run: DailyFritzRunRecord;
  transcript: ReturnType<typeof parseDailyFritzTranscript>;
}): Record<string, unknown> {
  if (readDailyFritzAuthorityContract(input.result)) return input.result ?? {};
  return writeDailyFritzAuthorityContract(
    input.result,
    buildDailyFritzAuthorityContract({
      fritzPolicyVersion: input.transcript.fritzPolicyVersion,
      challengeId: buildDailyFritzChallengeId(input.run.runDate),
      runFingerprint: buildDailyFritzRunFingerprint(input.run),
      clientRelease: input.transcript.clientRelease ?? null,
      transcriptProtocolVersion: input.transcript.protocolVersion,
      // Existing in-flight attempts can contain earlier actions without state
      // fingerprints. Pin their policy, but do not retroactively invalidate them.
      stateDigestRequired: false,
    }),
  );
}

export function findVerifiedHand(
  result: Record<string, unknown> | null,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
): VerifiedDailyFritzHandRecord | null {
  return readAuthorityLedger(result).hands.find(
    (hand) => hand.gameNumber === gameNumber && hand.handIndex === handIndex,
  ) ?? null;
}

export function parseTranscriptForRequest(value: unknown) {
  try {
    return parseDailyFritzTranscript(value);
  } catch (error) {
    throw new DailyFritzVerificationError(
      error instanceof Error ? error.message : 'Malformed transcript.',
      'malformed_transcript',
    );
  }
}

export function readActiveGameProgress(result: Record<string, unknown> | null, gameNumber: DailyFritzSetGameNumber): DailyFritzActiveGameProgress {
  const value = result?.active_game;
  if (!value || typeof value !== 'object') return { gameNumber, you: 0, fritz: 0 };
  const rec = value as Record<string, unknown>;
  const you = Number(rec.you);
  const fritz = Number(rec.fritz);
  return Number(rec.game_number) === gameNumber && Number.isFinite(you) && you >= 0 && Number.isFinite(fritz) && fritz >= 0
    ? { gameNumber, you: Math.round(you), fritz: Math.round(fritz) }
    : { gameNumber, you: 0, fritz: 0 };
}

/** Verifier codes that indicate server-side wiring/data loss — not client cheat rejection. */
export const DAILY_FRITZ_INFRASTRUCTURE_VERIFIER_CODES = new Set([
  'missing_hand_start_progress',
]);

/**
 * Hand-start scores for transcript replay. The authority ledger is the durable
 * source of truth; `active_game` is UI/progress bookkeeping and can be wiped
 * (e.g. by `buildRecordedDailyFritzAttemptResult`).
 *
 * Requires a contiguous chain for this game: hands 0..N-1 must all be
 * accounted for before hand N can replay. A hand counts as accounted for if
 * it is verified, or if it is explicitly recorded as advanced-without-receipt
 * — the attempt is already `rejected` in that case, so refusing later hands
 * buys no integrity and only strands the player.
 *
 * A prior hand that is neither is a genuine gap and still fails closed.
 */
export function resolveHandStartScoresForVerification(input: {
  result: Record<string, unknown> | null;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
}): DailyFritzActiveGameProgress {
  const { result, gameNumber, handIndex } = input;
  if (handIndex <= 0) {
    return { gameNumber, you: 0, fritz: 0 };
  }

  for (let priorIndex = 0; priorIndex < handIndex; priorIndex += 1) {
    if (findVerifiedHand(result, gameNumber, priorIndex)) continue;
    const unverified = findUnverifiedHand(result, gameNumber, priorIndex);
    // Recorded but score-less (pre-existing rows, or a writer that had no
    // scores to hand over) cannot seed the chain, so treat it as a real gap.
    if (unverified && unverified.playerScoreAfter != null && unverified.fritzScoreAfter != null) {
      continue;
    }
    throwMissingHandStartProgress({
      gameNumber,
      handIndex,
      missingPriorHandIndex: priorIndex,
    });
  }

  const immediatePrior = findVerifiedHand(result, gameNumber, handIndex - 1);
  if (immediatePrior) {
    return {
      gameNumber,
      you: immediatePrior.playerScoreAfter,
      fritz: immediatePrior.fritzScoreAfter,
    };
  }

  // Loop above guarantees this exists with finite scores.
  const priorUnverified = findUnverifiedHand(result, gameNumber, handIndex - 1)!;
  return {
    gameNumber,
    you: priorUnverified.playerScoreAfter!,
    fritz: priorUnverified.fritzScoreAfter!,
  };
}

function throwMissingHandStartProgress(input: {
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  missingPriorHandIndex: number;
}): never {
  Sentry.captureMessage(
    '[daily-fritz] verification infrastructure failure — hand-start progress unavailable',
    {
      level: 'error',
      tags: {
        daily_fritz_alert: 'verification_infrastructure_error',
        verifier_code: 'missing_hand_start_progress',
      },
      extra: {
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
        missingPriorHandIndex: input.missingPriorHandIndex,
      },
    },
  );
  throw new DailyFritzVerificationError(
    'Daily Fritz hand verification is missing authoritative hand-start scores while prior verified hands exist.',
    'missing_hand_start_progress',
  );
}

export function writeActiveGameProgress(result: Record<string, unknown> | null, progress: DailyFritzActiveGameProgress): Record<string, unknown> {
  return { ...(result ?? {}), active_game: { game_number: progress.gameNumber, you: progress.you, fritz: progress.fritz } };
}

export type AttemptHandVerificationResult =
  | { ok: true; verified: ReturnType<typeof verifyAttemptHand> }
  | { ok: false; error: DailyFritzVerificationError };

/**
 * Run hand verification without throwing. Callers that carry legacy scores can
 * advance the run when verification fails instead of stranding the player.
 */
export function attemptVerifyHand(input: Parameters<typeof verifyAttemptHand>[0]): AttemptHandVerificationResult {
  try {
    return { ok: true, verified: verifyAttemptHand(input) };
  } catch (error) {
    if (error instanceof DailyFritzVerificationError) {
      return { ok: false, error };
    }
    throw error;
  }
}

export function isDailyFritzGameEndingScore(
  you: number,
  fritz: number,
  winningScore: number,
): boolean {
  const leader = Math.max(you, fritz);
  return leader >= winningScore && you !== fritz;
}

/**
 * DF-G2 — number of `verification_failed` events for one user (in the default
 * 7-day window) at or above which the ops alert escalates from `warning` to
 * `error` and is tagged `verification_bypassed_repeat`. One or two failures can
 * be a genuine verifier edge case; three in a week is a pattern worth a human
 * looking at the account.
 */
export const DAILY_FRITZ_VERIFICATION_REPEAT_OFFENDER_THRESHOLD = 3;

export async function recordDailyFritzAdvanceWithoutVerification(input: {
  attemptId: string;
  runDate: string;
  userId: string;
  requestId: string;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  verifierCode: string;
  operation: 'next-hand' | 'record-game';
  message: string;
  /** Observability only — does not affect advance / ranking behavior. */
  transcript?: DailyFritzTranscript | null;
  /**
   * Structured divergence evidence from DailyFritzVerificationError, present
   * for state-mismatch codes. Diagnostic payload only: it is logged, alerted
   * and archived, and nothing branches on it.
   */
  diagnostics?: Record<string, unknown>;
}): Promise<void> {
  incrementDailyFritzMetric('verification_bypassed', input.verifierCode);
  log.error({
    attemptId: input.attemptId,
    runDate: input.runDate,
    userId: input.userId,
    gameNumber: input.gameNumber,
    handIndex: input.handIndex,
    verifierCode: input.verifierCode,
    message: input.message,
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  }, '[daily-fritz] advancing without verification receipt — run is now unranked');
  const evidence = dailyFritzTranscriptEvidenceFields(input.transcript ?? null);
  await recordDailyFritzEventBestEffort({
    attemptId: input.attemptId,
    runDate: input.runDate,
    userId: input.userId,
    requestId: input.requestId,
    eventType: 'verification_failed',
    verifierCode: input.verifierCode,
    gameNumber: input.gameNumber,
    handIndex: input.handIndex,
    transcriptDigest: evidence.transcriptDigest,
    idempotencyKey: `${input.attemptId}:verification_bypassed:${input.operation}:${input.gameNumber}:${input.handIndex}`,
    payload: {
      operation: input.operation,
      outcome: 'advance_unverified',
      message: input.message,
      ...evidence.payload,
      ...(input.diagnostics ? { mismatch_diagnostics: input.diagnostics } : {}),
    },
  });
  const infrastructureFailure = DAILY_FRITZ_INFRASTRUCTURE_VERIFIER_CODES.has(input.verifierCode);
  // Player was not stranded, but verification failed — alert ops so we can
  // chase the bug without waiting for a player report. Infrastructure failures
  // use a distinct alert tag so they are never confused with cheat rejection.
  if (!infrastructureFailure) {
    // DF-G2 — per-user aggregation. An honest client effectively never fails a
    // verdict; a run of failures for one account is a tamper pattern, not a
    // string of one-offs. This event has already been journaled above, so the
    // count includes it.
    const userRecentVerificationFailures = await countRecentDailyFritzVerificationFailures(input.userId);
    const repeatOffender = userRecentVerificationFailures >= DAILY_FRITZ_VERIFICATION_REPEAT_OFFENDER_THRESHOLD;
    Sentry.captureMessage('[daily-fritz] verification bypassed — run advanced unranked', {
      level: repeatOffender ? 'error' : 'warning',
      tags: {
        daily_fritz_alert: repeatOffender ? 'verification_bypassed_repeat' : 'verification_bypassed',
        verifier_code: input.verifierCode,
        operation: input.operation,
      },
      extra: {
        attemptId: input.attemptId,
        runDate: input.runDate,
        userId: input.userId,
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
        message: input.message,
        transcriptDigest: evidence.transcriptDigest,
        userRecentVerificationFailures,
        repeatOffenderThreshold: DAILY_FRITZ_VERIFICATION_REPEAT_OFFENDER_THRESHOLD,
        ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
      },
    });
  }
}

/**
 * Observability only: durable transcript archive before fire-and-forget async
 * verification. Does not gate advance or finalize.
 */
export async function recordDailyFritzAsyncVerificationScheduled(input: {
  attemptId: string;
  runDate: string;
  userId: string;
  requestId: string;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  transcript: DailyFritzTranscript;
  expectedPlayerScore: number;
  expectedFritzScore: number;
}): Promise<void> {
  const evidence = buildDailyFritzTranscriptEvidence(input.transcript);
  await recordDailyFritzEventBestEffort({
    attemptId: input.attemptId,
    runDate: input.runDate,
    userId: input.userId,
    requestId: input.requestId,
    eventType: 'async_verification_scheduled',
    gameNumber: input.gameNumber,
    handIndex: input.handIndex,
    transcriptDigest: evidence.transcriptDigest,
    idempotencyKey: `${input.attemptId}:async_verification_scheduled:${input.gameNumber}:${input.handIndex}:${evidence.transcriptDigest}`,
    payload: {
      operation: 'record-game',
      outcome: 'async_verification_scheduled',
      expected_player_score: input.expectedPlayerScore,
      expected_fritz_score: input.expectedFritzScore,
      transcript: evidence.transcript,
      action_count: evidence.actionCount,
    },
  });
}

export function verifyAttemptHand(input: {
  transcript: unknown;
  attempt: DailyFritzAttemptRecord;
  run: DailyFritzRunRecord;
  userId: string;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  publishedChallenge: DailyFritzPublishedChallenge | null;
}) {
  const expectedSeed = getDailyFritzSeed(input.run.runDate);
  if (input.run.seed !== expectedSeed) {
    throw new DailyFritzVerificationError('Daily Fritz challenge seed is invalid.', 'challenge_mismatch');
  }
  if (buildDailyFritzChallengeId(input.run.runDate) !== buildDailyFritzChallengeId(input.attempt.runDate)) {
    throw new DailyFritzVerificationError('Daily Fritz challenge identity is invalid.', 'challenge_mismatch');
  }
  const startScores = resolveHandStartScoresForVerification({
    result: input.attempt.result,
    gameNumber: input.gameNumber,
    handIndex: input.handIndex,
  });
  const authorityContract = readDailyFritzAuthorityContract(input.attempt.result);
  const publishedAuthority = input.publishedChallenge
    ? resolveDailyFritzPublishedGameAuthority({
        challenge: input.publishedChallenge,
        gameNumber: input.gameNumber,
        handIndex: input.handIndex,
      })
    : null;
  const deal = publishedAuthority?.deal
    ?? getDailyFritzHandForGame(input.run, input.gameNumber, input.handIndex);
  const drawWinner = publishedAuthority?.drawWinner
    ?? resolveDailyFritzDrawWinner({
      runDate: input.run.runDate,
      gameNumber: input.gameNumber,
      metadata: input.run.metadata,
    });
  const challengeId = input.publishedChallenge?.challengeId
    ?? buildDailyFritzChallengeId(input.run.runDate);
  const fritzTier = input.publishedChallenge?.fritzTier ?? input.run.fritzTier;
  const winningScore = input.publishedChallenge?.winningScore ?? input.run.winningScore;
  const dealSize = input.publishedChallenge?.dealSize ?? input.run.dealSize;
  return verifyDailyFritzHand({
    transcript: input.transcript,
    initialState: createOfficialDailyFritzHandState({
      deal,
      handIndex: input.handIndex,
      drawWinner,
      winningScore,
      dealSize,
      playerScore: startScores.you,
      fritzScore: startScores.fritz,
    }),
    expectedChallengeId: challengeId,
    expectedAttemptId: input.attempt.id,
    expectedGameNumber: input.gameNumber,
    expectedHandIndex: input.handIndex,
    userId: input.userId,
    fritzTier,
    expectedFritzPolicyVersion: authorityContract?.fritzPolicyVersion,
    expectedFritzPolicyContract: authorityContract?.fritzPolicyContract,
    requireStateDigests: authorityContract?.stateDigestRequired === true,
  });
}

export function respondVerificationError(
  res: Response,
  error: unknown,
  context?: { attemptId?: string | null; gameNumber?: number | null; handIndex?: number | null },
): boolean {
  if (!(error instanceof DailyFritzVerificationError)) return false;
  const status = error.code.endsWith('_mismatch') || error.code === 'wrong_actor' ? 409 : 400;
  const recoverable = [
    'fritz_action_mismatch',
    'fritz_state_mismatch',
    'fritz_policy_version_mismatch',
    'fritz_policy_contract_mismatch',
    'missing_fritz_state_digest',
  ].includes(error.code);
  if (CLIENT_STUCK_CODES.has(error.code)) {
    // The client has no auto-retry path for this code: a real player is
    // about to land on the permanently-stuck Hand Over banner right now.
    // Surface it loudly instead of waiting for a player screenshot.
    log.error({
      attemptId: context?.attemptId ?? null,
      gameNumber: context?.gameNumber ?? null,
      handIndex: context?.handIndex ?? null,
      verifierCode: error.code,
      message: error.message,
    }, '[daily-fritz] player stranded on Hand Over — non-retryable verification rejection');
    capture500(error, {
      tag: 'daily_fritz_player_stranded',
      attemptId: context?.attemptId ?? null,
      gameNumber: context?.gameNumber ?? null,
      handIndex: context?.handIndex ?? null,
      verifierCode: error.code,
    });
  }
  res.status(status).json({
    error: recoverable
      ? 'Daily Fritz detected a synchronization issue. Refresh to resume from the last verified hand.'
      : error.message,
    code: error.code,
    recoverable,
    recovery_action: recoverable ? 'reload_official_hand' : null,
  });
  return true;
}
