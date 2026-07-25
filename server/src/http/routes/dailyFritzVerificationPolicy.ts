import { DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION } from '@racehorse/game-core';
import type { DailyFritzSetGameNumber, DailyFritzSetGameResult } from '../../dailyFritz';
import type { VerifiedDailyFritzHandRecord } from '../../dailyFritzVerifier';

export const DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION = DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION;

export type VerifiedDailyFritzGameRecord = {
  verificationVersion: number;
  gameNumber: DailyFritzSetGameNumber;
  playerScore: number;
  fritzScore: number;
  handDigests: string[];
  resultDigest: string;
};

export type DailyFritzAuthorityLedger = {
  version: 1;
  hands: VerifiedDailyFritzHandRecord[];
  games: VerifiedDailyFritzGameRecord[];
};

export type DailyFritzVerificationStatus =
  | 'in_progress'
  | 'pending_verification'
  | 'verified'
  | 'rejected'
  | 'legacy_unverified';

export function readAuthorityLedger(result: Record<string, unknown> | null): DailyFritzAuthorityLedger {
  const raw = result?.authority;
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>).hands)) {
    return { version: 1, hands: [], games: [] };
  }
  const authority = raw as { hands: VerifiedDailyFritzHandRecord[]; games?: VerifiedDailyFritzGameRecord[] };
  return {
    version: 1,
    hands: authority.hands,
    games: Array.isArray(authority.games) ? authority.games : [],
  };
}

export function getDailyFritzVerificationStatus(
  result: Record<string, unknown> | null,
): DailyFritzVerificationStatus {
  const value = result?.verification_status;
  return value === 'in_progress'
    || value === 'pending_verification'
    || value === 'verified'
    || value === 'rejected'
    ? value
    : 'legacy_unverified';
}

export function requiresVerifiedDailyFritzEvidence(result: Record<string, unknown> | null): boolean {
  const protocol = Number(result?.verification_protocol_version);
  return (protocol === 1 || protocol === DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION)
    && getDailyFritzVerificationStatus(result) !== 'legacy_unverified';
}

/**
 * Merges set-result scores onto the attempt result without dropping verifier pinning.
 * Previous bug: spreading setResult alone wiped verification_protocol_version mid-set,
 * which reopened legacy score-only next-hand submissions.
 */
export function buildRecordedDailyFritzAttemptResult(input: {
  previousResult: Record<string, unknown> | null;
  setResult: object;
  hasTranscript: boolean;
}): Record<string, unknown> {
  const previous = input.previousResult ?? {};
  const authority = readAuthorityLedger(previous);
  if (!input.hasTranscript) {
    return {
      ...input.setResult as Record<string, unknown>,
      authority,
      verification_status: 'legacy_unverified',
    };
  }
  const previousStatus = getDailyFritzVerificationStatus(previous);
  return {
    ...input.setResult as Record<string, unknown>,
    authority,
    verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
    verification_status: previousStatus === 'verified' ? 'verified' : 'in_progress',
  };
}

export function hasCompleteDailyFritzGameAuthority(
  result: Record<string, unknown> | null,
  setResult: { games: DailyFritzSetGameResult[] },
): boolean {
  const ledger = readAuthorityLedger(result);
  return setResult.games.length > 0 && !setResult.games.some((game) => {
    const verifiedGame = ledger.games.find((candidate) => candidate.gameNumber === game.gameNumber);
    return !verifiedGame
      || verifiedGame.playerScore !== game.playerScore
      || verifiedGame.fritzScore !== game.fritzScore
      || verifiedGame.handDigests.length === 0;
  });
}

/** True when every already-recorded set game has a matching authority receipt. */
export function hasPriorDailyFritzGameAuthority(
  result: Record<string, unknown> | null,
  setResult: { games: DailyFritzSetGameResult[] },
): boolean {
  if (setResult.games.length === 0) return true;
  return hasCompleteDailyFritzGameAuthority(result, setResult);
}

export function canFinalizeDailyFritzAttempt(
  result: Record<string, unknown> | null,
  setResult: { games: DailyFritzSetGameResult[] },
): boolean {
  if (hasCompleteDailyFritzGameAuthority(result, setResult)) return true;
  if (requiresVerifiedDailyFritzEvidence(result)) return false;
  // Partial authority after a mid-set verifier drop must not finalize as silent unranked.
  const ledger = readAuthorityLedger(result);
  if (ledger.games.length > 0) return false;
  return true;
}

export function isIdenticalDailyFritzGameReplay(
  existing: Pick<DailyFritzSetGameResult, 'playerScore' | 'fritzScore' | 'movesUsed' | 'handsPlayed'>,
  submitted: { playerScore: number; fritzScore: number; movesUsed: number; handsPlayed: number },
): boolean {
  return existing.playerScore === Math.round(submitted.playerScore)
    && existing.fritzScore === Math.round(submitted.fritzScore)
    && existing.movesUsed === Math.round(submitted.movesUsed)
    && existing.handsPlayed === Math.round(submitted.handsPlayed);
}
