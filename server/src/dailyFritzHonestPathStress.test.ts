/**
 * Deterministic Daily Fritz honest-path stress harness.
 *
 * Generates complete hands with the official policy on both seats (player plays
 * like Fritz for determinism), verifies every hand with verifyDailyFritzHand.
 *
 * Usage (from server/):
 *   npx vitest run src/dailyFritzHonestPathStress.test.ts
 *   DF_STRESS_HANDS=10000 npx vitest run src/dailyFritzHonestPathStress.test.ts
 *   DF_STRESS_SETS=1000 npx vitest run src/dailyFritzHonestPathStress.test.ts
 */
import { describe, expect, it } from 'vitest';
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  listOptimalOfficialFritzPlays,
  type DailyFritzTranscriptAction,
  type FritzDecision,
  type GameState,
} from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand } from './dailyFritz';
import {
  createOfficialDailyFritzHandState,
  verifyDailyFritzHand,
} from './dailyFritzVerifier';
// Import from this worktree's source — root node_modules may point at the
// primary checkout's built package during sibling-worktree investigation.
import {
  digestDailyFritzGameState,
} from '../../packages/game-core/src/dailyFritzDivergenceTrace.ts';

const HAND_BUDGET = Number(process.env.DF_STRESS_HANDS ?? '200');
const SET_BUDGET = Number(process.env.DF_STRESS_SETS ?? '50');
const TIERS = ['standard', 'elite'] as const;

function decisionToAction(
  sequence: number,
  actor: 'player' | 'fritz',
  decision: FritzDecision,
): DailyFritzTranscriptAction {
  if (decision.kind === 'play') {
    return {
      sequence,
      actor,
      kind: 'play',
      tile: decision.tile,
      position: decision.position,
    };
  }
  return { sequence, actor, kind: decision.kind };
}

function playHonestHand(input: {
  challengeId: string;
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  tier: (typeof TIERS)[number];
  runDate: string;
  playerScore: number;
  fritzScore: number;
}): { transcriptActions: DailyFritzTranscriptAction[]; terminal: GameState; digests: string[] } {
  const deal = generateSingleDailyFritzGameHand(
    input.runDate,
    input.gameNumber,
    input.handIndex,
    7,
  );
  let state = createOfficialDailyFritzHandState({
    deal,
    handIndex: input.handIndex,
    drawWinner: 'you',
    winningScore: 60,
    dealSize: 7,
    playerScore: input.playerScore,
    fritzScore: input.fritzScore,
  });

  const actions: DailyFritzTranscriptAction[] = [];
  const digests = [digestDailyFritzGameState(state)];

  for (let guard = 0; guard < 512 && !state.handOver; guard += 1) {
    const actorId = state.playerIds[state.currentPlayerIndex];
    const actor = actorId === 'player' ? 'player' as const : 'fritz' as const;
    const decision = chooseOfficialFritzDecision({
      state,
      participantId: actorId,
      tier: input.tier,
    });
    if (actor === 'fritz' && decision.kind === 'play') {
      const optimal = listOptimalOfficialFritzPlays({
        state,
        participantId: 'fritz',
        tier: input.tier,
      });
      expect(optimal.some((move) =>
        move.tile.low === decision.tile.low
        && move.tile.high === decision.tile.high
        && move.position === decision.position
      )).toBe(true);
    }
    const action = decisionToAction(actions.length, actor, decision);
    actions.push(action);
    state = applyGameCommand(state, {
      version: 1,
      commandId: `stress:${actions.length}`,
      sequence: state.sequence,
      actorId,
      kind: decision.kind,
      ...(decision.kind === 'play'
        ? { tile: decision.tile, position: decision.position }
        : {}),
    } as Parameters<typeof applyGameCommand>[1]).state;
    digests.push(digestDailyFritzGameState(state));
  }

  expect(state.handOver).toBe(true);
  return { transcriptActions: actions, terminal: state, digests };
}

describe('Daily Fritz honest-path stress', () => {
  it(`verifies ${HAND_BUDGET} deterministic hands across tiers`, () => {
    for (let index = 0; index < HAND_BUDGET; index += 1) {
      const tier = TIERS[index % TIERS.length];
      const gameNumber = ((index % 3) + 1) as 1 | 2 | 3;
      const handIndex = index % 8;
      const runDate = `2026-07-${String((index % 28) + 1).padStart(2, '0')}`;
      const challengeId = `daily-fritz:${runDate}:r2:s1`;
      const played = playHonestHand({
        challengeId,
        attemptId: `attempt-${index}`,
        gameNumber,
        handIndex,
        tier,
        runDate,
        playerScore: 0,
        fritzScore: 0,
      });

      expect(() => verifyDailyFritzHand({
        transcript: {
          protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
          rulesVersion: GAME_RULES_VERSION,
          fritzPolicyVersion: FRITZ_POLICY_VERSION,
          challengeId,
          attemptId: `attempt-${index}`,
          gameNumber,
          handIndex,
          actions: played.transcriptActions,
        },
        initialState: createOfficialDailyFritzHandState({
          deal: generateSingleDailyFritzGameHand(runDate, gameNumber, handIndex, 7),
          handIndex,
          drawWinner: 'you',
          winningScore: 60,
          dealSize: 7,
          playerScore: 0,
          fritzScore: 0,
        }),
        expectedChallengeId: challengeId,
        expectedAttemptId: `attempt-${index}`,
        expectedGameNumber: gameNumber,
        expectedHandIndex: handIndex,
        userId: 'stress-user',
        fritzTier: tier,
      })).not.toThrow();
    }
  }, 120_000);

  it(`verifies ${SET_BUDGET} best-of-three score progressions (game1→2→3 hand0)`, () => {
    for (let setIndex = 0; setIndex < SET_BUDGET; setIndex += 1) {
      const tier = TIERS[setIndex % TIERS.length];
      const runDate = `2026-08-${String((setIndex % 28) + 1).padStart(2, '0')}`;
      const challengeId = `daily-fritz:${runDate}:r2:s1`;
      let playerScore = 0;
      let fritzScore = 0;

      for (const gameNumber of [1, 2, 3] as const) {
        const handIndex = 0;
        const attemptId = `set-${setIndex}-g${gameNumber}`;
        const played = playHonestHand({
          challengeId,
          attemptId,
          gameNumber,
          handIndex,
          tier,
          runDate,
          playerScore,
          fritzScore,
        });

        const initialState = createOfficialDailyFritzHandState({
          deal: generateSingleDailyFritzGameHand(runDate, gameNumber, handIndex, 7),
          handIndex,
          drawWinner: 'you',
          winningScore: 60,
          dealSize: 7,
          playerScore,
          fritzScore,
        });

        const verified = verifyDailyFritzHand({
          transcript: {
            protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
            rulesVersion: GAME_RULES_VERSION,
            fritzPolicyVersion: FRITZ_POLICY_VERSION,
            challengeId,
            attemptId,
            gameNumber,
            handIndex,
            actions: played.transcriptActions,
          },
          initialState,
          expectedChallengeId: challengeId,
          expectedAttemptId: attemptId,
          expectedGameNumber: gameNumber,
          expectedHandIndex: handIndex,
          userId: 'stress-user',
          fritzTier: tier,
        });

        playerScore = verified.result.playerScoreAfter;
        fritzScore = verified.result.fritzScoreAfter;
      }
    }
  }, 180_000);
});
