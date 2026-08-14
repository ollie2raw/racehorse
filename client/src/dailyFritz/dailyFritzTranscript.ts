import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
  GAME_RULES_VERSION,
  type DailyFritzTranscript,
  type DailyFritzTranscriptAction,
} from '@racehorse/game-core';
import type { MoveEntry } from '../game/moveLogger.ts';
import { canonicalizeDailyFritzMoveLog } from './dailyFritzMoveEvidence.ts';

type TranscriptActor = DailyFritzTranscriptAction['actor'];

function otherActor(actor: TranscriptActor): TranscriptActor {
  return actor === 'player' ? 'fritz' : 'player';
}

/**
 * Official passes still required for a blocked hand. Play resets the streak;
 * a scoring play or double keeps the turn (extra turn).
 */
export function missingBlockedHandPassActors(
  entries: readonly Pick<MoveEntry, 'player' | 'action' | 'tile' | 'pointsScored'>[],
): TranscriptActor[] {
  let consecutivePasses = 0;
  let nextActor: TranscriptActor = 'player';

  for (const entry of entries) {
    const actor: TranscriptActor = entry.player === 'you' ? 'player' : 'fritz';
    if (entry.action === 'place') {
      consecutivePasses = 0;
      const extraTurn = (entry.pointsScored ?? 0) > 0
        || Boolean(entry.tile && entry.tile[0] === entry.tile[1]);
      nextActor = extraTurn ? actor : otherActor(actor);
    } else if (entry.action === 'pass') {
      consecutivePasses += 1;
      nextActor = otherActor(actor);
    } else {
      nextActor = actor;
    }
  }

  const missing: TranscriptActor[] = [];
  while (consecutivePasses < 2) {
    missing.push(nextActor);
    consecutivePasses += 1;
    nextActor = otherActor(nextActor);
  }
  return missing;
}

export function sealBlockedDailyFritzTranscript(
  transcript: DailyFritzTranscript,
  entries: readonly Pick<MoveEntry, 'player' | 'action' | 'tile' | 'pointsScored'>[],
): DailyFritzTranscript {
  const missing = missingBlockedHandPassActors(entries);
  if (missing.length === 0) return transcript;
  const actions = [...transcript.actions];
  for (const actor of missing) {
    actions.push({ sequence: actions.length, actor, kind: 'pass' });
  }
  return { ...transcript, actions };
}

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
  /** When the local hand ended blocked, append any official passes the move log omitted. */
  sealBlockedHand?: boolean;
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

  const transcript: DailyFritzTranscript = {
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

  return input.sealBlockedHand
    ? sealBlockedDailyFritzTranscript(transcript, entries)
    : transcript;
}
