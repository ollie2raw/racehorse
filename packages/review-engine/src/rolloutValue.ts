/**
 * Rollout value: the long view the review's own search does not take. The review's search values a position at its horizon as the CURRENT SCORE DIFFERENCE
 * (solveMidgameDeterminization's leafValue), so it never sees the rest of the hand. A rollout plays a candidate move, then lets both sides continue with a fixed
 * policy to the end of the hand (including the end-of-hand award) against an opponent hand sampled consistently with what the reviewed player could know.
 *
 * Shared by `reviewRolloutCalibration.ts` (does the review agree with the long view?) and `reviewRolloutMatch.ts` (does choosing by the long view play better?).
 */
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  DEFAULT_CONFIG,
  type FritzTier,
  type GameCommand,
  type GameState,
} from '@racehorse/game-core';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { sampleHiddenAllocation } from './sampleHiddenAllocation';
import { commandForAction } from './searchGameTree';

export type HiddenAllocation = NonNullable<ReturnType<typeof sampleHiddenAllocation>>;

export function rootState(snapshot: ReviewPositionSnapshotV2, alloc: HiddenAllocation): GameState {
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen } = snapshot.preAction;
  return {
    config: DEFAULT_CONFIG,
    playerIds: [actorId, opponentId],
    players: {
      [actorId]: { id: actorId, hand: [...actorHand], score: scores.actor },
      [opponentId]: { id: opponentId, hand: [...alloc.opponentHand], score: scores.opponent },
    },
    board,
    boneyard: [...alloc.boneyardDrawable, ...alloc.boneyardDead],
    deadTiles: [...alloc.boneyardDead],
    currentPlayerIndex: 0,
    handNumber,
    handOpen,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses,
    sequence: 0,
  } as GameState;
}

/** Points the reviewed player gains over the opponent from this decision to the end of the hand, if `action` is played and both sides then follow the policy. */
export function rolloutGain(snapshot: ReviewPositionSnapshotV2, alloc: HiddenAllocation, action: ReviewAction, tier: FritzTier): number {
  const { actorId, opponentId } = snapshot.identifiers;
  let state = rootState(snapshot, alloc);
  const start = state.players[actorId]!.score - state.players[opponentId]!.score;
  state = applyGameCommand(state, commandForAction(state, actorId, action)).state;
  for (let i = 0; i < 400 && !state.handOver && !state.gameOver; i += 1) {
    const mover = state.playerIds[state.currentPlayerIndex]!;
    const d = chooseOfficialFritzDecision({ state, participantId: mover, tier });
    const command = (d.kind === 'play'
      ? { version: 1, commandId: `rollout:${i}`, sequence: state.sequence, actorId: mover, kind: 'play', tile: d.tile, position: d.position }
      : { version: 1, commandId: `rollout:${i}`, sequence: state.sequence, actorId: mover, kind: d.kind }) as GameCommand;
    state = applyGameCommand(state, command).state;
  }
  return state.players[actorId]!.score - state.players[opponentId]!.score - start;
}

/** Draws up to `count` hidden-hand samples for this position (fewer if the evidence leaves no consistent hand). */
export function sampleAllocations(snapshot: ReviewPositionSnapshotV2, tag: string, count: number): HiddenAllocation[] {
  return Array.from({ length: count }, (_, i) => sampleHiddenAllocation(snapshot, `rollout:${tag}:${snapshot.identifiers.decisionId}:${i}`)).filter(
    (a): a is HiddenAllocation => a !== null,
  );
}
