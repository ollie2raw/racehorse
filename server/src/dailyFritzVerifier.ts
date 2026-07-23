import { createHash } from 'crypto';
import {
  DAILY_FRITZ_VERIFIER_VERSION,
  DEFAULT_CONFIG,
  applyGameCommand,
  chooseOfficialFritzDecision,
  createDeterministicRandom,
  getOfficialFritzDecisionSeed,
  parseDailyFritzTranscript,
  tileEquals,
  type DailyFritzTranscript,
  type FritzDecision,
  type GameCommand,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import type { DailyFritzDrawWinner, DailyFritzHandDeal, DailyFritzTier } from './dailyFritz';

export type VerifiedDailyFritzHandRecord = {
  verificationVersion: number;
  transcriptDigest: string;
  challengeId: string;
  attemptId: string;
  userId: string;
  gameNumber: 1 | 2 | 3;
  handIndex: number;
  winner: 'player' | 'fritz' | null;
  reason: 'domino' | 'blocked';
  pointsAwarded: number;
  playerScoreBefore: number;
  fritzScoreBefore: number;
  playerScoreAfter: number;
  fritzScoreAfter: number;
  actionCount: number;
  verifiedAt: string;
};

export class DailyFritzVerificationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'DailyFritzVerificationError';
  }
}

function cloneTiles(tiles: readonly Tile[]): Tile[] {
  return tiles.map((tile) => ({ low: tile.low, high: tile.high }));
}

export function createOfficialDailyFritzHandState(input: {
  deal: DailyFritzHandDeal;
  handIndex: number;
  drawWinner: DailyFritzDrawWinner;
  winningScore: number;
  dealSize: 7 | 14;
  playerScore: number;
  fritzScore: number;
}): GameState {
  const matchStarter = input.drawWinner === 'you' ? 'player' : 'fritz';
  const starter = input.handIndex % 2 === 0
    ? matchStarter
    : matchStarter === 'player' ? 'fritz' : 'player';
  return {
    config: {
      ...DEFAULT_CONFIG,
      tilesPerPlayer: input.dealSize,
      deadTileCount: input.dealSize === 14 ? 0 : input.deal.locked.length,
      winningScore: input.winningScore,
      skipPregameDraw: true,
    },
    playerIds: ['player', 'fritz'],
    players: {
      player: { id: 'player', hand: cloneTiles(input.deal.player_tiles), score: input.playerScore },
      fritz: { id: 'fritz', hand: cloneTiles(input.deal.fritz_tiles), score: input.fritzScore },
    },
    board: null,
    boneyard: cloneTiles(input.deal.boneyard),
    deadTiles: cloneTiles(input.deal.locked),
    currentPlayerIndex: starter === 'player' ? 0 : 1,
    handNumber: input.handIndex + 1,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
    handStarters: [starter],
  };
}

function sameDecision(action: DailyFritzTranscript['actions'][number], decision: FritzDecision): boolean {
  if (action.kind !== decision.kind) return false;
  return action.kind !== 'play'
    || (decision.kind === 'play'
      && tileEquals(action.tile, decision.tile)
      && action.position === decision.position);
}

function formatFritzDecision(decision: FritzDecision): string {
  if (decision.kind !== 'play') return decision.kind;
  return `play ${decision.tile.low}|${decision.tile.high} @ ${decision.position}`;
}

function formatFritzAction(action: DailyFritzTranscript['actions'][number]): string {
  if (action.kind !== 'play') return action.kind;
  return `play ${action.tile.low}|${action.tile.high} @ ${action.position}`;
}

function toCommand(state: GameState, action: DailyFritzTranscript['actions'][number]): GameCommand {
  const base = {
    version: 1 as const,
    commandId: `daily-fritz:${action.sequence}`,
    sequence: state.sequence,
    actorId: action.actor,
  };
  return action.kind === 'play'
    ? { ...base, kind: 'play', tile: action.tile, position: action.position }
    : { ...base, kind: action.kind };
}

export function digestDailyFritzTranscript(transcript: DailyFritzTranscript): string {
  return createHash('sha256').update(JSON.stringify(transcript)).digest('hex');
}

export function verifyDailyFritzHand(input: {
  transcript: unknown;
  initialState: GameState;
  expectedChallengeId: string;
  expectedAttemptId: string;
  expectedGameNumber: 1 | 2 | 3;
  expectedHandIndex: number;
  userId: string;
  fritzTier: DailyFritzTier;
  now?: () => string;
}): { transcript: DailyFritzTranscript; result: VerifiedDailyFritzHandRecord; terminalState: GameState } {
  let transcript: DailyFritzTranscript;
  try {
    transcript = parseDailyFritzTranscript(input.transcript);
  } catch (error) {
    throw new DailyFritzVerificationError(
      error instanceof Error ? error.message : 'Malformed transcript.',
      'malformed_transcript',
    );
  }
  if (transcript.challengeId !== input.expectedChallengeId) throw new DailyFritzVerificationError('Challenge mismatch.', 'challenge_mismatch');
  if (transcript.attemptId !== input.expectedAttemptId) throw new DailyFritzVerificationError('Attempt mismatch.', 'attempt_mismatch');
  if (transcript.gameNumber !== input.expectedGameNumber) throw new DailyFritzVerificationError('Game mismatch.', 'game_mismatch');
  if (transcript.handIndex !== input.expectedHandIndex) throw new DailyFritzVerificationError('Hand mismatch.', 'hand_mismatch');

  let state = input.initialState;
  for (const action of transcript.actions) {
    if (state.handOver || state.gameOver) throw new DailyFritzVerificationError('Transcript contains an action after hand completion.', 'post_terminal_action');
    const expectedActor = state.playerIds[state.currentPlayerIndex];
    if (action.actor !== expectedActor) throw new DailyFritzVerificationError('Transcript actor does not own the turn.', 'wrong_actor');
    if (action.actor === 'fritz') {
      const decision = chooseOfficialFritzDecision({
        state,
        participantId: 'fritz',
        tier: input.fritzTier,
        random: createDeterministicRandom(getOfficialFritzDecisionSeed(state)),
      });
      if (!sameDecision(action, decision)) {
        throw new DailyFritzVerificationError(
          `Fritz action does not match the official policy (seq ${action.sequence}: got ${formatFritzAction(action)}, expected ${formatFritzDecision(decision)}, seed ${getOfficialFritzDecisionSeed(state)}, tier ${input.fritzTier}).`,
          'fritz_action_mismatch',
        );
      }
    }
    try {
      state = applyGameCommand(state, toCommand(state, action)).state;
    } catch (error) {
      throw new DailyFritzVerificationError(
        error instanceof Error ? error.message : 'Illegal action.',
        'illegal_action',
      );
    }
  }
  if (!state.handOver) throw new DailyFritzVerificationError('Transcript does not complete the hand.', 'incomplete_transcript');

  const playerBefore = input.initialState.players.player.score;
  const fritzBefore = input.initialState.players.fritz.score;
  const playerAfter = state.players.player.score;
  const fritzAfter = state.players.fritz.score;
  const winner = state.winnerId === 'player' || state.winnerId === 'fritz'
    ? state.winnerId
    : playerAfter > playerBefore ? 'player' : fritzAfter > fritzBefore ? 'fritz' : null;
  const domino = state.players.player.hand.length === 0 || state.players.fritz.hand.length === 0;
  return {
    transcript,
    terminalState: state,
    result: {
      verificationVersion: DAILY_FRITZ_VERIFIER_VERSION,
      transcriptDigest: digestDailyFritzTranscript(transcript),
      challengeId: transcript.challengeId,
      attemptId: transcript.attemptId,
      userId: input.userId,
      gameNumber: transcript.gameNumber,
      handIndex: transcript.handIndex,
      winner,
      reason: domino ? 'domino' : 'blocked',
      pointsAwarded: Math.max(playerAfter - playerBefore, fritzAfter - fritzBefore),
      playerScoreBefore: playerBefore,
      fritzScoreBefore: fritzBefore,
      playerScoreAfter: playerAfter,
      fritzScoreAfter: fritzAfter,
      actionCount: transcript.actions.length,
      verifiedAt: input.now?.() ?? new Date().toISOString(),
    },
  };
}

