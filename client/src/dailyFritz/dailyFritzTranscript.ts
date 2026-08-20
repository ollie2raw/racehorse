import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
  GAME_RULES_VERSION,
  toDailyFritzTranscriptActions,
  type DailyFritzJournal,
  type DailyFritzTranscript,
  type DailyFritzTranscriptAction,
} from '@racehorse/game-core';
import type { MoveEntry } from '../game/moveLogger.ts';
import { canonicalizeDailyFritzMoveLog } from './dailyFritzMoveEvidence.ts';
import { stripPostPlayRecoveryTranscriptActions } from './dailyFritzPostPlayRecovery.ts';

type TranscriptActor = DailyFritzTranscriptAction['actor'];

function otherActor(actor: TranscriptActor): TranscriptActor {
  return actor === 'player' ? 'fritz' : 'player';
}

/**
 * Official passes still required for a blocked hand.
 *
 * IMPORTANT: this must never be re-derived by pattern-matching the move log
 * (player/action/tile/pointsScored). A scoring play or double keeps the turn
 * ("extra turn") ONLY when the boneyard was already empty at the moment of
 * the play. When the play's forced-draw chain itself drains the boneyard to
 * empty while the actor still has no legal play,
 * packages/game-core/src/engine.ts's applyMove embeds a silent internal pass
 * for that same actor inside the single 'play' command — flipping the turn
 * and incrementing the engine's true consecutivePasses count with no
 * separate MoveEntry ever produced for it (by design; see the comment in
 * engine.ts near the forced-draw chain). A move-log-only heuristic cannot
 * distinguish these two cases (the log carries no boneyard information), so
 * it silently undercounts consecutivePasses and can append a synthetic pass
 * action after a hand that already reached handOver inside the preceding
 * play — which the server verifier rejects as 'post_terminal_action'
 * (production incident: players stuck on Hand Over after two-sided blocks).
 *
 * The caller must instead supply the actual authoritative post-hand state
 * (e.g. BotMatchState.consecutivePasses / currentPlayer from the real local
 * engine run of this hand) so this only ever pads what the real engine says
 * is still missing — including padding zero passes when the hand already
 * resolved entirely inside a preceding play action.
 */
export function missingBlockedHandPassActors(authoritative: {
  consecutivePasses: number;
  nextActor: TranscriptActor;
}): TranscriptActor[] {
  let consecutivePasses = authoritative.consecutivePasses;
  let nextActor = authoritative.nextActor;

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
  authoritative: { consecutivePasses: number; nextActor: TranscriptActor },
): DailyFritzTranscript {
  const missing = missingBlockedHandPassActors(authoritative);
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
  /**
   * When the local hand ended blocked, append any official passes still
   * missing to reach the real (authoritative) terminal state — e.g. from
   * BotMatchState.consecutivePasses / currentPlayer after the real local
   * engine ran this hand. Must come from the authoritative engine state, not
   * be re-derived from the move log (see missingBlockedHandPassActors).
   * Pass `null`/omit when the hand is not being sealed.
   */
  sealBlockedHand?: { consecutivePasses: number; nextActor: 'player' | 'fritz' } | null;
  /**
   * Authoritative evidence: the engine's own record of the commands it applied
   * for this hand (BotMatchState.officialJournal). When present it is used
   * verbatim — no reconstruction, no sealing, no inferred draws.
   *
   * The move-log path below remains only for states captured before the
   * journal existed (an in-flight attempt resumed across the deploy).
   */
  journal?: DailyFritzJournal | null;
  /**
   * Explicit legacy gate: move-log reconstruction is allowed only for attempts
   * that predate the journal rollout.
   */
  attemptPredatesJournalRollout?: boolean;
}): DailyFritzTranscript {
  const journalActions = toDailyFritzTranscriptActions(input.journal, input.handNumber);
  const hasJournal = Boolean(journalActions);
  // Contract: reconstruct from move-log only when there is no journal AND this
  // is a pre-journal legacy attempt.
  const useLegacyMoveLogReconstruction = !hasJournal && input.attemptPredatesJournalRollout === true;
  if (!hasJournal && !useLegacyMoveLogReconstruction) {
    throw new Error('Daily Fritz official journal is required for post-journal attempts.');
  }
  const entries = useLegacyMoveLogReconstruction
    ? canonicalizeDailyFritzMoveLog(input.moveLog)
      .filter((entry) => entry.handNumber === input.handNumber)
    : [];
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

  // Journal is the preferred evidence, but a presentation-layer race can still
  // append a spurious draw after a play whose applyMove already absorbed the
  // recovery chain. Strip those before sealing/submit (protocol-2 contract).
  const rawActions = journalActions ?? actions;
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
    actions: stripPostPlayRecoveryTranscriptActions(rawActions),
  };

  // A journalled transcript is already exactly what the engine applied; sealing
  // it could only add an action the engine never accepted.
  if (hasJournal) return transcript;

  return input.sealBlockedHand
    ? sealBlockedDailyFritzTranscript(transcript, input.sealBlockedHand)
    : transcript;
}
