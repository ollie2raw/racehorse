import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
  GAME_RULES_VERSION,
  type DailyFritzTranscript,
} from '@racehorse/game-core';
import type { MoveEntry } from '../game/moveLogger.ts';
import { canonicalizeDailyFritzMoveLog } from './dailyFritzMoveEvidence.ts';

export function buildDailyFritzTranscript(input: {
  challengeId: string;
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  handNumber: number;
  moveLog: readonly MoveEntry[];
  protocolVersion?: 1 | 2;
  fritzPolicyVersion?: number;
  clientRelease?: string;
}): DailyFritzTranscript {
  const entries = canonicalizeDailyFritzMoveLog(input.moveLog)
    .filter((entry) => entry.handNumber === input.handNumber);
  const actions = entries.map((entry, sequence) => {
    const actor = entry.player === 'you' ? 'player' as const : 'fritz' as const;
    if (entry.action === 'place') {
      if (!entry.tile || !entry.position) {
        throw new Error('Daily Fritz play transcript is missing its tile or placement.');
      }
      return {
        sequence,
        actor,
        kind: 'play' as const,
        tile: { low: entry.tile[0], high: entry.tile[1] },
        position: entry.position,
        ...(entry.authorityPreStateDigest ? { preStateDigest: entry.authorityPreStateDigest } : {}),
      };
    }
    return {
      sequence,
      actor,
      kind: entry.action,
      ...(entry.authorityPreStateDigest ? { preStateDigest: entry.authorityPreStateDigest } : {}),
    } as const;
  });

  const fritzPolicyVersion = isSupportedFritzPolicyVersion(input.fritzPolicyVersion)
    ? input.fritzPolicyVersion
    : FRITZ_POLICY_VERSION;

  return {
    protocolVersion: input.protocolVersion ?? DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    fritzPolicyVersion,
    fritzPolicyContract: getFritzPolicyContract(fritzPolicyVersion),
    stateDigestVersion: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
    clientRelease: input.clientRelease ?? import.meta.env.VITE_APP_VERSION ?? 'unknown',
    challengeId: input.challengeId,
    attemptId: input.attemptId,
    gameNumber: input.gameNumber,
    handIndex: input.handIndex,
    actions,
  };
}
