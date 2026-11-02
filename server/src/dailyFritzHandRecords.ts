import type { DailyFritzTranscript } from '@racehorse/game-core';
import { childLogger } from './logger';
import { supabaseFetch } from './supabaseUtils';
import { digestDailyFritzTranscript, type VerifiedDailyFritzHandRecord } from './dailyFritzVerifier';

const log = childLogger('daily-fritz-hand-records');

/**
 * Keeps the verified transcript of a Daily Fritz hand (docs/daily-fritz-review-design.md, DF-2; roadmap 3.14).
 *
 * The server verifies every hand but, until this, kept only a digest and a summary, so a finished game could never be rebuilt and so never reviewed. This stores
 * the transcript exactly as the verifier parsed and accepted it, in `daily_fritz_hand_records`, for the review to replay later.
 *
 * It sits OUTSIDE verification: it is called only after a hand has verified, builds its row in one synchronous pass, and inserts it in the background. It cannot
 * change a verdict, a score, a ranking or the response: every failure is logged and swallowed, and nothing reads the table back except the review.
 *
 * Off unless DF_HAND_RECORDS_ENABLED is exactly "true", which must not happen before supabase/migrations/2026-11-02_daily_fritz_hand_records.sql is applied.
 *
 * A hand can verify more than once, and only the version written to the attempt's ledger is authoritative, so the row is keyed by the transcript digest too. The
 * ledger records that digest per hand; the review picks the row that matches it.
 */

export function dailyFritzHandRecordsEnabled(setting: string | undefined = process.env.DF_HAND_RECORDS_ENABLED): boolean {
  return setting === 'true';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
/** The table refuses a larger transcript (and the protocol's own cap is 64 KiB); so does this. */
const MAX_TRANSCRIPT_JSON_CHARS = 70_000;

/** One row of `daily_fritz_hand_records`, as inserted. */
export type DailyFritzHandRecordRow = {
  user_id: string;
  attempt_id: string;
  challenge_id: string;
  game_number: 1 | 2 | 3;
  hand_index: number;
  transcript_digest: string;
  verification_version: number;
  fritz_policy_version: number;
  action_count: number;
  transcript: DailyFritzTranscript;
};

export type PrepareHandRecordResult = { ok: true; row: DailyFritzHandRecordRow } | { ok: false; reason: string };

/**
 * Builds the row for a verified hand, or says why not. Synchronous and read-only. It re-derives the transcript digest and requires it to equal the verifier's own,
 * so what is stored is provably the transcript that was verified, not something that merely resembles it.
 */
export function prepareDailyFritzHandRecordRow(verified: {
  transcript: DailyFritzTranscript;
  result: VerifiedDailyFritzHandRecord;
}): PrepareHandRecordResult {
  const { transcript, result } = verified;
  if (!UUID.test(result.userId)) return { ok: false, reason: 'user_not_uuid' };
  if (!UUID.test(result.attemptId)) return { ok: false, reason: 'attempt_not_uuid' };
  if (!DIGEST.test(result.transcriptDigest)) return { ok: false, reason: 'digest_malformed' };
  if (digestDailyFritzTranscript(transcript) !== result.transcriptDigest) return { ok: false, reason: 'digest_mismatch' };
  if (transcript.attemptId !== result.attemptId || transcript.gameNumber !== result.gameNumber || transcript.handIndex !== result.handIndex) {
    return { ok: false, reason: 'transcript_result_mismatch' };
  }
  if (!Number.isInteger(result.handIndex) || result.handIndex < 0 || result.handIndex > 255) return { ok: false, reason: 'hand_index_out_of_range' };
  const actionCount = transcript.actions.length;
  if (actionCount < 1 || actionCount > 512) return { ok: false, reason: 'action_count_out_of_range' };
  if (JSON.stringify(transcript).length > MAX_TRANSCRIPT_JSON_CHARS) return { ok: false, reason: 'transcript_too_large' };

  return {
    ok: true,
    row: {
      user_id: result.userId,
      attempt_id: result.attemptId,
      challenge_id: result.challengeId,
      game_number: result.gameNumber,
      hand_index: result.handIndex,
      transcript_digest: result.transcriptDigest,
      verification_version: result.verificationVersion,
      fritz_policy_version: result.fritzPolicyVersion,
      action_count: actionCount,
      transcript,
    },
  };
}

/** Inserts the row idempotently: an identical retry is a no-op. */
export async function insertDailyFritzHandRecordRow(row: DailyFritzHandRecordRow): Promise<void> {
  await supabaseFetch('/rest/v1/daily_fritz_hand_records?on_conflict=user_id,attempt_id,game_number,hand_index,transcript_digest', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify([row]),
  });
}

/** A stored hand as the review reads it back. */
export type StoredDailyFritzHandRecord = { hand_index: number; transcript_digest: string; transcript: unknown };

/** The stored hands of one game of one attempt, owner only (the user id is part of the query). Several rows can share a hand index (see the digest note above). */
export async function loadDailyFritzHandRecords(userId: string, attemptId: string, gameNumber: number): Promise<StoredDailyFritzHandRecord[]> {
  return supabaseFetch<StoredDailyFritzHandRecord[]>(
    `/rest/v1/daily_fritz_hand_records?select=hand_index,transcript_digest,transcript&user_id=eq.${encodeURIComponent(userId)}&attempt_id=eq.${encodeURIComponent(attemptId)}&game_number=eq.${Math.trunc(gameNumber)}&order=hand_index.asc&limit=200`,
    { method: 'GET' },
  );
}

/** Which hands are stored for these attempts, digests only (no transcripts), so a list can say which games are reviewable. */
export async function listDailyFritzHandDigests(
  userId: string,
  attemptIds: readonly string[],
): Promise<Array<{ attempt_id: string; game_number: number; transcript_digest: string }>> {
  const ids = attemptIds.filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  return supabaseFetch<Array<{ attempt_id: string; game_number: number; transcript_digest: string }>>(
    `/rest/v1/daily_fritz_hand_records?select=attempt_id,game_number,transcript_digest&user_id=eq.${encodeURIComponent(userId)}&attempt_id=in.(${ids.join(',')})&limit=3000`,
    { method: 'GET' },
  );
}

/** A missing table (flag set before the migration) would otherwise warn on every verified hand. */
const WARN_EVERY_MS = 60_000;
let lastFailureWarnAt = 0;
export function resetHandRecordWarningThrottleForTests(): void {
  lastFailureWarnAt = 0;
}

/**
 * The hook verification calls once a hand has verified. Returns nothing and throws nothing: the row is built before it returns and the insert runs in the
 * background.
 */
export function saveVerifiedDailyFritzHandRecord(
  verified: { transcript: DailyFritzTranscript; result: VerifiedDailyFritzHandRecord },
  deps: { enabled?: boolean; insert?: typeof insertDailyFritzHandRecordRow; now?: () => number } = {},
): void {
  // Read defensively: this runs inside verification's success path, and a hook that throws would defeat the point of it.
  const where = { attemptId: verified?.result?.attemptId, gameNumber: verified?.result?.gameNumber, handIndex: verified?.result?.handIndex };
  try {
    if (!(deps.enabled ?? dailyFritzHandRecordsEnabled())) return;
    const prepared = prepareDailyFritzHandRecordRow(verified);
    if (!prepared.ok) {
      log.info({ ...where, reason: prepared.reason }, 'daily fritz hand record not saved');
      return;
    }
    const insert = deps.insert ?? insertDailyFritzHandRecordRow;
    const now = deps.now ?? Date.now;
    void insert(prepared.row).catch((err: unknown) => {
      if (now() - lastFailureWarnAt < WARN_EVERY_MS) return;
      lastFailureWarnAt = now();
      log.warn({ err, ...where }, 'daily fritz hand record save failed');
    });
  } catch (err) {
    log.warn({ err, ...where }, 'daily fritz hand record save failed');
  }
}
