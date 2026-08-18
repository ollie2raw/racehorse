import {
  DEFAULT_CONFIG,
  applyGameCommand,
  chooseOfficialFritzDecision,
  chooseOfficialFritzDecisionForVersion,
  isSupportedFritzPolicyVersion,
  applyMove as applyCoreMove,
  computeGoOutBonusPoints,
  computeHandPenalty,
  computePlayScore as computeCorePlayScore,
  getLegalMoves as getCoreLegalMoves,
  getLegalMoves as getLegalMovesCoreState,
  simulatePlacement as simulateCorePlacement,
  getDailyFritzAuthorityStateDigest,
  appendDailyFritzJournalAction,
  type DailyFritzJournalAction,
  type DailyFritzJournalActionInput,
  type GameState as CoreGameState,
  type Move as CoreMove,
} from '@racehorse/game-core';
import type { BoardState, Move, PlacementPosition, Tile } from '../../../types.ts';
import type {
  BotActionError,
  BotActionResult,
  BotHandEndReason,
  BotMatchState,
  BotPlayerId,
} from './botEngine.ts';
import type { BotChoice, BotDifficulty } from '../../fritz/botHeuristics.ts';

function cloneTile(tile: Readonly<Tile>): Tile {
  return { low: tile.low, high: tile.high };
}

function actionFailure(state: BotMatchState, code: string, message: string): BotActionResult {
  return { state, error: { code, message } satisfies BotActionError };
}

/**
 * Record one accepted official command on the state it produced.
 *
 * This is the ONLY place Daily Fritz verification evidence is written. It runs
 * inside the state transition, so the journal can never drift from the state:
 * see packages/game-core/src/dailyFritzJournal.ts for why reconstructing this
 * from the UI move log is unfixable.
 *
 * `coreBefore` must be the authoritative pre-command state (both hands
 * visible, never a participant-masked projection) so the recorded digest
 * matches the one the server computes while replaying.
 */
function journalOfficialAction(
  next: BotMatchState,
  previous: BotMatchState,
  coreBefore: CoreGameState,
  actor: BotPlayerId,
  action: DailyFritzJournalActionInput,
): BotMatchState {
  // Only Fritz actions carry a digest: those are the ones the server compares
  // (player digests are ignored on replay) and every extra field counts
  // against the transcript's size cap on long hands.
  const journalActor = actor === 'you' ? 'player' : 'fritz';
  return {
    ...next,
    officialJournal: appendDailyFritzJournalAction(
      previous.officialJournal,
      previous.handNumber,
      {
        ...action,
        actor: journalActor,
        ...(journalActor === 'fritz'
          ? { preStateDigest: getDailyFritzAuthorityStateDigest(coreBefore) }
          : {}),
      } as DailyFritzJournalAction,
    ),
  };
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
      deadTileCount: state.dealSize === 14 ? 0 : state.deadTiles.length,
      winningScore: state.winningScore,
      skipPregameDraw: true,
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
  try {
    const coreBefore = toCoreGameState(state);
    const immediateScore = computeCorePlayScore(
      simulateCorePlacement(coreBefore.board, move.tile, move.position),
      coreBefore.config,
    );
    const result = applyCoreMove(coreBefore, player, {
      type: 'play',
      tile: move.tile,
      position: move.position,
    });
    const details = handEndDetails(state, result.state);
    const next = journalOfficialAction(
      fromCoreGameState(result.state, state, details.winner, details.reason),
      state,
      coreBefore,
      player,
      { kind: 'play', tile: cloneTile(move.tile), position: move.position },
    );
    return {
      state: next,
      ...(immediateScore > 0 ? { scored: { player, points: immediateScore } } : {}),
      ...(result.forcedDraw ? { drew: { player, tile: cloneTile(result.forcedDraw) } } : {}),
      ...(details.handEnded ? { handEnded: details.handEnded } : {}),
    };
  } catch (error) {
    return actionFailure(
      state,
      'core_play_rejected',
      error instanceof Error ? error.message : 'The move could not be applied. Try again.',
    );
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
      state: journalOfficialAction(
        fromCoreGameState(result.state, state),
        state,
        coreState,
        player,
        { kind: 'draw' },
      ),
      drew: { player, tile: cloneTile(drawn) },
    };
  } catch (error) {
    return actionFailure(
      state,
      'core_draw_rejected',
      error instanceof Error ? error.message : 'The draw could not be applied. Try again.',
    );
  }
}

export function passCoreTurn(state: BotMatchState, player: BotPlayerId): BotActionResult {
  try {
    const coreBefore = toCoreGameState(state);
    const result = applyCoreMove(coreBefore, player, { type: 'pass' } as CoreMove);
    const details = handEndDetails(state, result.state, 'blocked');
    return {
      state: journalOfficialAction(
        fromCoreGameState(result.state, state, details.winner, details.reason),
        state,
        coreBefore,
        player,
        { kind: 'pass' },
      ),
      passed: { player },
      ...(details.handEnded ? { handEnded: details.handEnded } : {}),
    };
  } catch (error) {
    return actionFailure(
      state,
      'core_pass_rejected',
      error instanceof Error ? error.message : 'The pass could not be applied. Try again.',
    );
  }
}

export function drawUntilPlayableOrEmptyCoreState(
  state: BotMatchState,
  player: BotPlayerId,
): BotActionResult {
  const startingBoneyard = state.boneyard.length;
  try {
    // Drawn one tile at a time through drawCoreTile rather than in a single
    // bulk core call, so every drawn tile lands in the official journal with
    // its own pre-action digest. A bulk draw would advance the state by N
    // commands while recording none of them.
    let current = state;
    let lastDrawn: Tile | undefined;
    const maxDraws = startingBoneyard;
    for (let index = 0; index < maxDraws; index += 1) {
      const coreCurrent = toCoreGameState(current);
      if (getLegalMovesCoreState(coreCurrent, player).some((move) => move.type === 'play')) break;
      const step = drawCoreTile(current, player);
      if (step.error) return step;
      if (!step.drew) break;
      lastDrawn = step.drew.tile;
      current = step.state;
    }

    const stillStuck = !getLegalMovesCoreState(toCoreGameState(current), player).some(
      (move) => move.type === 'play',
    );
    if (current.boneyard.length === startingBoneyard && stillStuck) {
      const passed = passCoreTurn(current, player);
      return {
        ...passed,
        ...(lastDrawn ? { drew: { player, tile: cloneTile(lastDrawn) } } : {}),
      };
    }
    return {
      state: current,
      ...(lastDrawn ? { drew: { player, tile: cloneTile(lastDrawn) } } : {}),
    };
  } catch (error) {
    return actionFailure(
      state,
      'core_draw_sequence_rejected',
      error instanceof Error ? error.message : 'The draw sequence could not be applied. Try again.',
    );
  }
}

export function chooseOfficialFritzBotChoice(
  state: BotMatchState,
  difficulty: BotDifficulty,
  policyVersion?: number,
): BotChoice | null {
  const tier = difficulty === 'casual'
    ? 'rookie'
    : difficulty === 'hard'
      ? 'elite'
      : difficulty;
  const decision = isSupportedFritzPolicyVersion(policyVersion)
    ? chooseOfficialFritzDecisionForVersion({
        version: policyVersion,
        state: toCoreGameState(state),
        participantId: 'bot',
        tier,
      })
    : chooseOfficialFritzDecision({
        state: toCoreGameState(state),
        participantId: 'bot',
        tier,
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
