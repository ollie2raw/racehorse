import { createHash } from 'crypto';
import {
  DAILY_FRITZ_VERIFIER_VERSION,
  DEFAULT_CONFIG,
  applyGameCommand,
  canDraw,
  chooseOfficialFritzDecisionForVersion,
  getDailyFritzAuthorityStateDigest,
  getFritzPolicyContract,
  isOptimalOfficialFritzPlayForVersion,
  parseDailyFritzTranscript,
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
  fritzPolicyVersion: 1 | 2;
  fritzPolicyContract: string;
  lastAuthorityStateDigest: string | null;
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

function sameDecision(
  state: GameState,
  action: DailyFritzTranscript['actions'][number],
  decision: FritzDecision,
  tier: DailyFritzTier,
  policyVersion: 1 | 2,
): boolean {
  if (action.kind !== decision.kind) return false;
  if (action.kind !== 'play' || decision.kind !== 'play') return true;
  // Accept any top-score official play so historical RNG / sibling-arm ties still verify.
  return isOptimalOfficialFritzPlayForVersion({
    version: policyVersion,
    state,
    participantId: 'fritz',
    tier,
    tile: action.tile,
    position: action.position,
  });
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

function applyOmittedMandatoryDraws(
  state: GameState,
  actorId: string,
  transcriptSequence: number,
): GameState {
  let current = state;
  const maxDraws = state.boneyard.length;
  for (let drawIndex = 0; drawIndex < maxDraws && canDraw(current, actorId); drawIndex += 1) {
    current = applyGameCommand(current, {
      version: 1,
      commandId: `daily-fritz:${transcriptSequence}:inferred-draw:${drawIndex}`,
      sequence: current.sequence,
      actorId,
      kind: 'draw',
    }).state;
  }
  return current;
}

/**
 * A resumed client can persist the player's next action before the preceding
 * Fritz action is visible in its move log. Fritz's action is not user input:
 * it is fully determined by the pinned policy and authoritative state. Apply
 * that one official turn before replaying the submitted player action.
 */
function applyOmittedOfficialFritzTurn(
  state: GameState,
  transcriptSequence: number,
  policyVersion: 1 | 2,
  tier: DailyFritzTier,
): GameState {
  let current = applyOmittedMandatoryDraws(state, 'fritz', transcriptSequence);
  const decision = chooseOfficialFritzDecisionForVersion({
    version: policyVersion,
    state: current,
    participantId: 'fritz',
    tier,
  });
  const action: DailyFritzTranscript['actions'][number] = decision.kind === 'play'
    ? {
        sequence: transcriptSequence,
        actor: 'fritz',
        kind: 'play',
        tile: decision.tile,
        position: decision.position,
      }
    : { sequence: transcriptSequence, actor: 'fritz', kind: decision.kind };
  try {
    return applyGameCommand(current, toCommand(current, action)).state;
  } catch (error) {
    throw new DailyFritzVerificationError(
      `The official Fritz recovery action could not be applied before transcript action ${transcriptSequence}: ${error instanceof Error ? error.message : 'illegal action.'}`,
      'fritz_recovery_failed',
    );
  }
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
  expectedFritzPolicyVersion?: 1 | 2;
  expectedFritzPolicyContract?: string;
  requireStateDigests?: boolean;
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
  if (
    input.expectedFritzPolicyVersion != null
    && transcript.fritzPolicyVersion !== input.expectedFritzPolicyVersion
  ) {
    throw new DailyFritzVerificationError(
      'This Daily Fritz attempt was started with a different Fritz policy. Refresh to resume the official state.',
      'fritz_policy_version_mismatch',
    );
  }
  const policyContract = getFritzPolicyContract(transcript.fritzPolicyVersion);
  if (
    (transcript.fritzPolicyContract != null && transcript.fritzPolicyContract !== policyContract)
    || (
      input.expectedFritzPolicyContract != null
      && transcript.fritzPolicyContract !== input.expectedFritzPolicyContract
    )
  ) {
    throw new DailyFritzVerificationError(
      'This Daily Fritz attempt uses an incompatible Fritz policy contract. Refresh to resume the official state.',
      'fritz_policy_contract_mismatch',
    );
  }
  if (input.requireStateDigests && transcript.stateDigestVersion !== 1) {
    throw new DailyFritzVerificationError(
      'Daily Fritz evidence is missing its authority state digest contract.',
      'missing_fritz_state_digest',
    );
  }

  let state = input.initialState;
  // Protocol 1 only: older clients logged post-score recovery draws/passes as
  // separate transcript actions. applyMove now absorbs that chain (and optional
  // auto-pass) inside the play, so leftover recovery actions must be skipped —
  // including when the turn has already advanced to the opponent.
  // Protocol 2+ must log exactly the actions the engine expects.
  const allowLegacyRecoverySkip = transcript.protocolVersion === 1;
  let lastPlayActor: string | null = null;
  for (const action of transcript.actions) {
    if (state.handOver || state.gameOver) throw new DailyFritzVerificationError('Transcript contains an action after hand completion.', 'post_terminal_action');
    let expectedActor = state.playerIds[state.currentPlayerIndex];
    // Protocol 2 clients should record Fritz actions, but a checkpoint can
    // still capture the player's next action before that append is durable.
    // Recover exactly one omitted official Fritz turn; never infer player
    // actions or accept a player action against the wrong authoritative state.
    if (
      transcript.protocolVersion >= 2
      && action.actor === 'player'
      && expectedActor === 'fritz'
    ) {
      state = applyOmittedOfficialFritzTurn(
        state,
        action.sequence,
        transcript.fritzPolicyVersion,
        input.fritzTier,
      );
      if (state.handOver || state.gameOver) {
        throw new DailyFritzVerificationError('Transcript contains an action after hand completion.', 'post_terminal_action');
      }
      expectedActor = state.playerIds[state.currentPlayerIndex];
    }
    if (
      allowLegacyRecoverySkip
      && lastPlayActor === action.actor
      && (action.kind === 'draw' || action.kind === 'pass')
    ) {
      if (action.actor !== expectedActor) {
        continue;
      }
      if (action.kind === 'draw' && !canDraw(state, action.actor)) {
        continue;
      }
    }
    if (action.actor !== expectedActor) {
      throw new DailyFritzVerificationError(
        `Transcript actor does not own the turn (action ${action.sequence}: got ${action.actor}, expected ${expectedActor}, stateSeq ${state.handNumber}:${state.sequence}).`,
        'wrong_actor',
      );
    }
    // Protocol 2 must not silently skip obsolete post-play recovery draws
    // (protocol 1 still does above). Reject with a distinct code before policy
    // comparison so Sentry can distinguish this class from other failures
    // without a transcript reconstruction dig (aunt G2H6 / 2026-08-20).
    if (
      !allowLegacyRecoverySkip
      && lastPlayActor === action.actor
      && action.kind === 'draw'
    ) {
      throw new DailyFritzVerificationError(
        `Transcript action ${action.sequence} (${action.actor} draw) is a post-play recovery draw that applyMove already embeds.`,
        'post_play_recovery_draw',
      );
    }
    // Draws are deterministic and mandatory whenever `canDraw` is true. Some
    // clients can commit the resulting rack state before the presentation layer
    // appends every draw event. Reconstruct only those omitted forced draws
    // before a submitted play/pass, including Fritz actions before policy
    // comparison. This cannot grant an optional draw: the engine stops at the
    // first legal play and rejects any substituted tile.
    if (action.kind !== 'draw' && canDraw(state, action.actor)) {
      state = applyOmittedMandatoryDraws(state, action.actor, action.sequence);
    }
    if (action.actor === 'fritz') {
      const authorityStateDigest = getDailyFritzAuthorityStateDigest(state);
      // Policy parity only depends on Fritz play decisions. Draw/pass actions
      // are deterministic engine commands and older clients do not log a
      // decision snapshot for them.
      if (input.requireStateDigests && action.kind === 'play' && !action.preStateDigest) {
        throw new DailyFritzVerificationError(
          'Fritz action is missing its official pre-action state fingerprint.',
          'missing_fritz_state_digest',
        );
      }
      if (action.preStateDigest && action.preStateDigest !== authorityStateDigest) {
        throw new DailyFritzVerificationError(
          `Fritz state diverged before action ${action.sequence} (client ${action.preStateDigest}, server ${authorityStateDigest}).`,
          'fritz_state_mismatch',
        );
      }
      const decision = chooseOfficialFritzDecisionForVersion({
        version: transcript.fritzPolicyVersion,
        state,
        participantId: 'fritz',
        tier: input.fritzTier,
      });
      if (!sameDecision(state, action, decision, input.fritzTier, transcript.fritzPolicyVersion)) {
        throw new DailyFritzVerificationError(
          `Fritz action does not match the official policy (seq ${action.sequence}: got ${formatFritzAction(action)}, expected ${formatFritzDecision(decision)}, stateSeq ${state.handNumber}:${state.sequence}, tier ${input.fritzTier}).`,
          'fritz_action_mismatch',
        );
      }
    }
    try {
      state = applyGameCommand(state, toCommand(state, action)).state;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Illegal action.';
      throw new DailyFritzVerificationError(
        `Transcript action ${action.sequence} (${action.actor} ${formatFritzAction(action)}) is illegal: ${reason}`,
        'illegal_action',
      );
    }
    lastPlayActor = action.kind === 'play' ? action.actor : null;
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
      fritzPolicyVersion: transcript.fritzPolicyVersion,
      fritzPolicyContract: policyContract,
      lastAuthorityStateDigest: [...transcript.actions].reverse().find((action) => action.actor === 'fritz')?.preStateDigest ?? null,
      verifiedAt: input.now?.() ?? new Date().toISOString(),
    },
  };
}
