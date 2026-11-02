import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  applyGameCommand,
  chooseOfficialFritzDecisionForVersion,
  getDailyFritzAuthorityStateDigest,
  getFritzPolicyContract,
  getLegalMoves,
  type DailyFritzTranscript,
  type GameCommand,
  type GameState,
} from '@racehorse/game-core';
import { generateSingleDailyFritzGameHand } from './dailyFritz';
import { createOfficialDailyFritzHandState } from './dailyFritzVerifier';

/**
 * Test support: honest, server-authored Daily Fritz hands (one transcript action per engine command; Fritz plays the official policy, the player a seeded
 * random legal tile). Used by the hand replay and hand record tests. Not imported by any production file.
 */

export const RUN_DATE = '2026-11-02';
export const CHALLENGE_ID = 'daily-fritz:2026-11-02';
/** UUIDs, because the stored record's table keys on them. */
export const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const TIER = 'elite' as const;
export const DEAL_SIZE = 7 as const;
export const NOW = () => '2026-11-02T00:00:00.000Z';

export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

export type Action = DailyFritzTranscript['actions'][number];

export type HandStart = { playerScore: number; fritzScore: number; drawWinner: 'you' | 'bot'; winningScore: number; dealSize: 7 | 14 };

export function playHand(
  handIndex: number,
  seed: number,
  start: HandStart = { playerScore: 0, fritzScore: 0, drawWinner: handIndex % 2 === 0 ? 'you' : 'bot', winningScore: 60, dealSize: DEAL_SIZE },
): { initialState: GameState; actions: Action[]; terminal: GameState } {
  const deal = generateSingleDailyFritzGameHand(RUN_DATE, 1, handIndex, start.dealSize);
  const initialState = createOfficialDailyFritzHandState({
    deal, handIndex, drawWinner: start.drawWinner, winningScore: start.winningScore, dealSize: start.dealSize, playerScore: start.playerScore, fritzScore: start.fritzScore,
  });
  const rng = makeRng(seed);
  const actions: Action[] = [];
  let state = initialState;
  for (let sequence = 0; sequence < 400 && !state.handOver && !state.gameOver; sequence += 1) {
    const actor = state.playerIds[state.currentPlayerIndex] as 'player' | 'fritz';
    const official = chooseOfficialFritzDecisionForVersion({ version: FRITZ_POLICY_VERSION, state, participantId: actor, tier: TIER });
    let action: Action;
    if (official.kind !== 'play') {
      action = { sequence, actor, kind: official.kind };
    } else if (actor === 'fritz') {
      action = { sequence, actor, kind: 'play', tile: official.tile, position: official.position, preStateDigest: getDailyFritzAuthorityStateDigest(state, 2) };
    } else {
      const plays = getLegalMoves(state, actor).filter((m) => m.type === 'play');
      const pick = plays[Math.floor(rng() * plays.length)]!;
      action = { sequence, actor, kind: 'play', tile: pick.tile, position: pick.position };
    }
    const command: GameCommand = action.kind === 'play'
      ? { version: 1, commandId: `drv:${sequence}`, sequence: state.sequence, actorId: actor, kind: 'play', tile: action.tile, position: action.position }
      : { version: 1, commandId: `drv:${sequence}`, sequence: state.sequence, actorId: actor, kind: action.kind };
    state = applyGameCommand(state, command).state;
    actions.push(action);
  }
  return { initialState, actions, terminal: state };
}

export function transcriptOf(handIndex: number, actions: Action[]): DailyFritzTranscript {
  return {
    protocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    rulesVersion: 1,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    stateDigestVersion: 2,
    challengeId: CHALLENGE_ID,
    attemptId: ATTEMPT_ID,
    gameNumber: 1,
    handIndex,
    actions: actions.map((a, index) => ({ ...a, sequence: index })),
  } as DailyFritzTranscript;
}

export const inputFor = (handIndex: number, initialState: GameState, transcript: unknown) => ({
  transcript,
  initialState,
  expectedChallengeId: CHALLENGE_ID,
  expectedAttemptId: ATTEMPT_ID,
  expectedGameNumber: 1 as const,
  expectedHandIndex: handIndex,
  userId: USER_ID,
  fritzTier: TIER,
  now: NOW,
});

/**
 * A whole game as the server sees it: hands played in order with the score carried over and the draw winner fixed for the game, until someone has the winning
 * score and the scores are not tied (the same rule as `isDailyFritzGameEndingScore`).
 */
export function playGame(seed: number, options: { winningScore?: number; dealSize?: 7 | 14; drawWinner?: 'you' | 'bot' } = {}) {
  const winningScore = options.winningScore ?? 60;
  const dealSize = options.dealSize ?? DEAL_SIZE;
  const drawWinner = options.drawWinner ?? 'you';
  const hands: Array<{ handIndex: number; initialState: GameState; actions: Action[]; terminal: GameState }> = [];
  let playerScore = 0;
  let fritzScore = 0;
  for (let handIndex = 0; handIndex < 40; handIndex += 1) {
    const hand = playHand(handIndex, seed * 1009 + handIndex, { playerScore, fritzScore, drawWinner, winningScore, dealSize });
    if (!hand.terminal.handOver) return { hands, finished: false as const };
    hands.push({ handIndex, ...hand });
    playerScore = hand.terminal.players.player.score;
    fritzScore = hand.terminal.players.fritz.score;
    if (Math.max(playerScore, fritzScore) >= winningScore && playerScore !== fritzScore) return { hands, finished: true as const };
  }
  return { hands, finished: false as const };
}

export function finishedHands(count = 12) {
  return Array.from({ length: count }, (_, i) => ({ handIndex: i, ...playHand(i, i * 7919 + 13) })).filter((h) => h.terminal.handOver);
}
