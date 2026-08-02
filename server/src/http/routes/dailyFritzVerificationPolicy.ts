import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
  type FritzPolicyVersion,
} from '@racehorse/game-core';
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

export type DailyFritzAttemptAuthorityContract = {
  version: 1;
  transcriptProtocolVersion: number;
  gameRulesVersion: number;
  fritzPolicyVersion: FritzPolicyVersion;
  fritzPolicyContract: string;
  stateDigestVersion: 1;
  stateDigestRequired: boolean;
  challengeId: string;
  runFingerprint: string;
  clientRelease: string | null;
};

export type DailyFritzClientAuthorityCapabilities = {
  transcriptProtocolVersions: readonly number[];
  gameRulesVersion: number;
  fritzPolicies: readonly { version: FritzPolicyVersion; contract: string }[];
  stateDigestVersions: readonly number[];
};

export function clientSupportsDailyFritzAuthorityContract(
  contract: DailyFritzAttemptAuthorityContract,
  capabilities: DailyFritzClientAuthorityCapabilities,
): boolean {
  return capabilities.transcriptProtocolVersions.includes(contract.transcriptProtocolVersion)
    && capabilities.gameRulesVersion === contract.gameRulesVersion
    && capabilities.fritzPolicies.some(
      (policy) => policy.version === contract.fritzPolicyVersion
        && policy.contract === contract.fritzPolicyContract,
    )
    && (
      !contract.stateDigestRequired
      || capabilities.stateDigestVersions.includes(contract.stateDigestVersion)
    );
}

export function readDailyFritzAuthorityContract(
  result: Record<string, unknown> | null,
): DailyFritzAttemptAuthorityContract | null {
  const raw = result?.authority_contract;
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (
    rec.version !== 1
    || (rec.transcriptProtocolVersion !== 1 && rec.transcriptProtocolVersion !== 2)
    || rec.gameRulesVersion !== GAME_RULES_VERSION
    || !isSupportedFritzPolicyVersion(rec.fritzPolicyVersion)
    || rec.fritzPolicyContract !== getFritzPolicyContract(rec.fritzPolicyVersion)
    || rec.stateDigestVersion !== DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION
    || typeof rec.stateDigestRequired !== 'boolean'
    || typeof rec.challengeId !== 'string'
    || typeof rec.runFingerprint !== 'string'
  ) return null;
  return {
    version: 1,
    transcriptProtocolVersion: rec.transcriptProtocolVersion,
    gameRulesVersion: rec.gameRulesVersion,
    fritzPolicyVersion: rec.fritzPolicyVersion,
    fritzPolicyContract: rec.fritzPolicyContract,
    stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    stateDigestRequired: rec.stateDigestRequired,
    challengeId: rec.challengeId,
    runFingerprint: rec.runFingerprint,
    clientRelease: typeof rec.clientRelease === 'string' ? rec.clientRelease : null,
  };
}

export function buildDailyFritzAuthorityContract(input: {
  fritzPolicyVersion: FritzPolicyVersion;
  challengeId: string;
  runFingerprint: string;
  clientRelease?: string | null;
  transcriptProtocolVersion?: number;
  stateDigestRequired?: boolean;
}): DailyFritzAttemptAuthorityContract {
  return {
    version: 1,
    transcriptProtocolVersion:
      input.transcriptProtocolVersion ?? DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    gameRulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion: input.fritzPolicyVersion,
    fritzPolicyContract: getFritzPolicyContract(input.fritzPolicyVersion),
    stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    stateDigestRequired: input.stateDigestRequired ?? true,
    challengeId: input.challengeId,
    runFingerprint: input.runFingerprint,
    clientRelease: input.clientRelease?.trim().slice(0, 120) || null,
  };
}

export function writeDailyFritzAuthorityContract(
  result: Record<string, unknown> | null,
  contract: DailyFritzAttemptAuthorityContract,
): Record<string, unknown> {
  return {
    ...(result ?? {}),
    authority_contract: contract,
    verification_protocol_version: contract.transcriptProtocolVersion,
  };
}

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

export type DailyFritzGameRecordingPosition =
  | { kind: 'next' }
  | { kind: 'replay'; existing: DailyFritzSetGameResult }
  | { kind: 'set_decided' }
  | { kind: 'invalid_order' };

/**
 * Durable replay always wins over terminal-set rejection. A duplicate response
 * retry must remain idempotent even when game one clinched the set by skunk.
 */
export function classifyDailyFritzGameRecordingPosition(
  setResult: { games: DailyFritzSetGameResult[]; setWinner?: 'player' | 'fritz' },
  gameNumber: DailyFritzSetGameNumber,
): DailyFritzGameRecordingPosition {
  const existing = setResult.games.find((game) => game.gameNumber === gameNumber);
  if (existing) return { kind: 'replay', existing };
  if (setResult.setWinner) return { kind: 'set_decided' };
  if (gameNumber !== setResult.games.length + 1) return { kind: 'invalid_order' };
  return { kind: 'next' };
}
