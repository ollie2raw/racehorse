import {
  DEFAULT_CONFIG,
  applyGameCommand,
  chooseOfficialFritzDecision,
  createDeterministicRandom,
  getOfficialFritzDecisionSeed,
  applyMove as applyCoreMove,
  drawUntilPlayableOrEmpty as drawUntilPlayableOrEmptyCore,
  computeGoOutBonusPoints,
  computeHandPenalty,
  computePlayScore as computeCorePlayScore,
  getLegalMoves as getCoreLegalMoves,
  getLegalMoves as getLegalMovesCoreState,
  simulatePlacement as simulateCorePlacement,
  type GameState as CoreGameState,
  type Move as CoreMove,
} from '@racehorse/game-core';
import type { BoardState, Move, PlacementPosition, Tile } from '../../../types.ts';
import type {
  BotActionResult,
  BotHandEndReason,
  BotMatchState,
  BotPlayerId,
} from './botEngine.ts';
import type { BotChoice, BotDifficulty } from '../../fritz/botHeuristics.ts';

function cloneTile(tile: Readonly<Tile>): Tile {
  return { low: tile.low, high: tile.high };
}

function cloneBoard(board: CoreGameState['board']): BoardState | null {
  if (!board) return null;
  return {
    ...board,
    mainLine: board.mainLine.map((placed) => ({
      tile: cloneTile(placed.tile),
      orientation: placed.orientation,
    })),
    hubDoubles: board.hubDoubles.map((hub) => ({
      ...hub,
      branches: hub.branches.map((branch) =>
        branch
          ? {
              ...branch,
              tiles: branch.tiles.map((placed) => ({
                tile: cloneTile(placed.tile),
                orientation: placed.orientation,
              })),
            }
          : null,
      ),
    })),
  };
}

export function toCoreGameState(state: BotMatchState, visibleParticipant?: BotPlayerId): CoreGameState {
  const currentPlayerIndex = state.currentPlayer === 'you' ? 0 : 1;
  const visibleHand = (participant: BotPlayerId): Tile[] =>
    visibleParticipant && visibleParticipant !== participant
      ? []
      : state.players[participant].hand.map(cloneTile);
  return {
    config: {
      ...DEFAULT_CONFIG,
      tilesPerPlayer: state.dealSize,
      deadTileCount: state.dealSize === 14 ? 0 : 2,
      winningScore: state.winningScore,
    },
    playerIds: ['you', 'bot'],
    players: {
      you: { id: 'you', hand: visibleHand('you'), score: state.players.you.score },
      bot: { id: 'bot', hand: visibleHand('bot'), score: state.players.bot.score },
    },
    board: cloneBoard(state.board as CoreGameState['board']),
    boneyard: state.boneyard.map(cloneTile),
    deadTiles: state.deadTiles.map(cloneTile),
    currentPlayerIndex,
    handNumber: state.handNumber,
    handOpen: state.handOpen,
    handOver: state.handOver,
    gameOver: state.gameOver,
    winnerId: state.winnerId,
    consecutivePasses: state.consecutivePasses,
    sequence: state.turnIndex ?? 0,
    handStarters: state.matchStarter ? [state.matchStarter] : [],
  };
}

export function fromCoreGameState(
  state: CoreGameState,
  previous: BotMatchState,
  handWinner: BotPlayerId | null = previous.lastHandWinner,
  handReason: BotHandEndReason | null = previous.lastHandReason,
): BotMatchState {
  return {
    ...previous,
    players: {
      you: {
        hand: state.players.you.hand.map(cloneTile),
        score: state.players.you.score,
      },
      bot: {
        hand: state.players.bot.hand.map(cloneTile),
        score: state.players.bot.score,
      },
    },
    board: cloneBoard(state.board),
    boneyard: state.boneyard.map(cloneTile),
    deadTiles: state.deadTiles.map(cloneTile),
    currentPlayer: state.playerIds[state.currentPlayerIndex] as BotPlayerId,
    consecutivePasses: state.consecutivePasses,
    handNumber: state.handNumber,
    handOpen: state.handOpen,
    handOver: state.handOver,
    gameOver: state.gameOver,
    winnerId: state.winnerId as BotPlayerId | null,
    turnIndex: state.sequence,
    lastHandWinner: handWinner,
    lastHandReason: handReason,
  };
}

export function getCoreMoves(state: BotMatchState, player: BotPlayerId): Move[] {
  try {
    return getCoreLegalMoves(toCoreGameState(state, player), player).map((move) =>
      move.type === 'pass'
        ? { type: 'pass' }
        : { type: 'play', tile: cloneTile(move.tile), position: move.position },
    );
  } catch (error) {
    if (import.meta.env?.DEV) console.warn('[game-core] legal move projection failed', error);
    return [];
  }
}

export function previewCorePlacement(
  board: BoardState | null,
  tile: Tile,
  position: PlacementPosition,
): BoardState {
  return cloneBoard(simulateCorePlacement(board, tile, position))!;
}

export function scoreCoreBoard(board: BoardState): number {
  return computeCorePlayScore(board, DEFAULT_CONFIG);
}

function handEndDetails(
  before: BotMatchState,
  after: CoreGameState,
  forcedReason?: BotHandEndReason,
): Pick<BotActionResult, 'handEnded'> & {
  winner: BotPlayerId | null;
  reason: BotHandEndReason | null;
} {
  if (!after.handOver || before.handOver) return { winner: null, reason: null };
  const beforeScores = { you: before.players.you.score, bot: before.players.bot.score };
  const deltas = {
    you: after.players.you.score - beforeScores.you,
    bot: after.players.bot.score - beforeScores.bot,
  };
  const winner: BotPlayerId | null = deltas.you > deltas.bot ? 'you' : deltas.bot > deltas.you ? 'bot' : null;
  const reason: BotHandEndReason = forcedReason ??
    (after.players.you.hand.length === 0 || after.players.bot.hand.length === 0 ? 'domino' : 'blocked');
  const loser = winner === 'you' ? 'bot' : 'you';
  const loserPips = after.players[loser].hand.reduce((sum, tile) => sum + tile.low + tile.high, 0);
  const pointsAwarded = winner
    ? reason === 'domino'
      ? computeGoOutBonusPoints(after.players[loser].hand, after.config)
      : computeHandPenalty(after.players[loser].hand, after.config)
    : 0;
  return {
    winner,
    reason,
    handEnded: {
      winner,
      reason,
      pointsAwarded,
      loserPips,
      calcText: winner ? `round(${loserPips}/5) = ${pointsAwarded}` : 'tie — no hand bonus',
    },
  };
}

export function applyCorePlay(
  state: BotMatchState,
  player: BotPlayerId,
  move: Move,
): BotActionResult {
  if (move.type !== 'play' || !move.tile || !move.position) return { state };
  const coreBefore = toCoreGameState(state);
  const immediateScore = computeCorePlayScore(
    simulateCorePlacement(coreBefore.board, move.tile, move.position),
    coreBefore.config,
  );
  try {
    const result = applyCoreMove(coreBefore, player, {
      type: 'play',
      tile: move.tile,
      position: move.position,
    });
    const details = handEndDetails(state, result.state);
    const next = fromCoreGameState(result.state, state, details.winner, details.reason);
    return {
      state: next,
      ...(immediateScore > 0 ? { scored: { player, points: immediateScore } } : {}),
      ...(result.forcedDraw ? { drew: { player, tile: cloneTile(result.forcedDraw) } } : {}),
      ...(details.handEnded ? { handEnded: details.handEnded } : {}),
    };
  } catch {
    return { state };
  }
}

export function drawCoreTile(state: BotMatchState, player: BotPlayerId): BotActionResult {
  const coreState = toCoreGameState(state);
  const drawn = coreState.boneyard[0];
  if (!drawn) return { state };
  try {
    const result = applyGameCommand(coreState, {
      version: 1,
      commandId: `bot-match:${state.handNumber}:${state.turnIndex ?? 0}:draw`,
      sequence: coreState.sequence,
      actorId: player,
      kind: 'draw',
    });
    return {
      state: fromCoreGameState(result.state, state),
      drew: { player, tile: cloneTile(drawn) },
    };
  } catch {
    return { state };
  }
}

export function passCoreTurn(state: BotMatchState, player: BotPlayerId): BotActionResult {
  try {
    const result = applyCoreMove(toCoreGameState(state), player, { type: 'pass' } as CoreMove);
    const details = handEndDetails(state, result.state, 'blocked');
    return {
      state: fromCoreGameState(result.state, state, details.winner, details.reason),
      passed: { player },
      ...(details.handEnded ? { handEnded: details.handEnded } : {}),
    };
  } catch {
    return { state };
  }
}

export function drawUntilPlayableOrEmptyCoreState(
  state: BotMatchState,
  player: BotPlayerId,
): BotActionResult {
  const coreState = toCoreGameState(state);
  try {
    const result = drawUntilPlayableOrEmptyCore(coreState, player);
    const drewCount = coreState.boneyard.length - result.state.boneyard.length;
    const lastDrawn = drewCount > 0 ? coreState.boneyard[drewCount - 1] : undefined;
    if (result.state.boneyard.length === coreState.boneyard.length && !getLegalMovesCoreState(result.state, player).some((move) => move.type === 'play')) {
      const passed = passCoreTurn(fromCoreGameState(result.state, state), player);
      return {
        ...passed,
        ...(lastDrawn ? { drew: { player, tile: cloneTile(lastDrawn) } } : {}),
      };
    }
    return {
      state: fromCoreGameState(result.state, state),
      ...(lastDrawn ? { drew: { player, tile: cloneTile(lastDrawn) } } : {}),
    };
  } catch {
    return { state };
  }
}

export function chooseOfficialFritzBotChoice(
  state: BotMatchState,
  difficulty: BotDifficulty,
): BotChoice | null {
  const tier = difficulty === 'casual'
    ? 'rookie'
    : difficulty === 'hard'
      ? 'elite'
      : difficulty;
  const decision = chooseOfficialFritzDecision({
    state: toCoreGameState(state),
    participantId: 'bot',
    tier,
    random: createDeterministicRandom(getOfficialFritzDecisionSeed(toCoreGameState(state))),
  });
  if (decision.kind !== 'play') return null;
  const move: Move = {
    type: 'play',
    tile: cloneTile(decision.tile),
    position: decision.position,
  };
  const preview = previewCorePlacement(state.board, move.tile!, move.position!);
  const immediate = scoreCoreBoard(preview);
  return {
    move,
    score: immediate * 100,
    explanation: 'Official deterministic Fritz policy.',
    breakdown: {
      immediate,
      doubleBias: decision.tile.low === decision.tile.high ? 1 : 0,
      mobility: 0,
      denial: 0,
      unload: decision.tile.low + decision.tile.high,
      replyRisk: 0,
    },
  };
}
