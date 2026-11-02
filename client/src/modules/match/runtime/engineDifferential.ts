/**
 * Differential driver: the client's match engine against @racehorse/game-core, step by step, on the same seeded games.
 *
 * The client engine (botEngine.ts + gameCoreAdapter.ts) delegates plays, draws, passes and scoring to game-core, but it
 * still computes some things itself: which open ends a tile can go on (getMatchableOpenEnds / getPlacementTargetsForTile),
 * the move preview the bot and the coach read (previewPlayMove), and the hand-end report (winner, reason, points) that the
 * UI shows. This plays whole matches through the client wrappers while an independent game-core state machine, built from the
 * same deals and the same chosen moves, runs beside it, and records every point where the two disagree.
 *
 * Tests and devtools only. Nothing here changes either engine.
 */
import {
  DEFAULT_CONFIG,
  applyMove as coreApplyMove,
  computePlayScore as coreComputePlayScore,
  createDeterministicDoubleSixDeal,
  createInitialState,
  drawOne as coreDrawOne,
  getLegalMoves as coreGetLegalMoves,
  getOpenEnds as coreGetOpenEnds,
  startNewHand as coreStartNewHand,
  type Config,
  type GameState as CoreState,
  type Move as CoreMove,
  type Tile as CoreTile,
} from '@racehorse/game-core';
import type { Move, Tile } from '../../../types.ts';
import {
  applyPlayMove,
  createFixedBotMatch,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  getMatchableOpenEnds,
  getPlacementTargetsForTile,
  previewPlayMove,
  startNextFixedBotHand,
  type BotActionResult,
  type BotHandDeal,
  type BotMatchState,
  type BotPlayerId,
  type MatchRuleOverrides,
} from './botEngine.ts';
import { resolveMatchConfig } from './gameCoreAdapter.ts';

export interface DifferentialVariant {
  readonly name: string;
  readonly dealSize: 7 | 14;
  readonly winningScore: number;
  readonly rules: MatchRuleOverrides;
}

export interface Divergence {
  readonly seed: number;
  readonly variant: string;
  readonly handNumber: number;
  readonly step: number;
  /** Stable code so a known divergence can be named in a test. */
  readonly kind: string;
  readonly detail: string;
  readonly client: unknown;
  readonly core: unknown;
}

/** What a run actually exercised, so a green result can be told apart from a run that never reached the interesting positions. */
export interface DifferentialCoverage {
  plays: number;
  scoringPlays: number;
  doublePlays: number;
  branchPlays: number;
  drawSequences: number;
  passes: number;
  autoPassesAfterScoringPlay: number;
  handsWentOut: number;
  handsBlocked: number;
  previewsChecked: number;
}

const emptyCoverage = (): DifferentialCoverage => ({
  plays: 0,
  scoringPlays: 0,
  doublePlays: 0,
  branchPlays: 0,
  drawSequences: 0,
  passes: 0,
  autoPassesAfterScoringPlay: 0,
  handsWentOut: 0,
  handsBlocked: 0,
  previewsChecked: 0,
});

export interface DifferentialGameReport {
  readonly seed: number;
  readonly variant: string;
  readonly steps: number;
  readonly hands: number;
  readonly finished: boolean;
  readonly divergences: Divergence[];
  readonly coverage: DifferentialCoverage;
}

export const DIFFERENTIAL_VARIANTS: readonly DifferentialVariant[] = [
  { name: 'standard-7', dealSize: 7, winningScore: 60, rules: {} },
  { name: 'standard-7-short', dealSize: 7, winningScore: 20, rules: {} },
  { name: 'deal-14', dealSize: 14, winningScore: 40, rules: {} },
  { name: 'blocked-noScore', dealSize: 7, winningScore: 40, rules: { blockedHandRule: 'noScore' } },
  { name: 'bonus-none', dealSize: 7, winningScore: 40, rules: { endHandBonus: 'none' } },
  { name: 'multiple-10', dealSize: 7, winningScore: 30, rules: { scoringMultiple: 10 } },
];

const MAX_STEPS = 3000;
const PLAYERS: readonly BotPlayerId[] = ['you', 'bot'];

/** Deep equality for the plain data compared here (numbers, strings, booleans, null, arrays, plain objects). */
function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined);
  const bKeys = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => isDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

const tileKey = (tile: Readonly<Tile | CoreTile>): string => `${tile.low}-${tile.high}`;
const moveKey = (move: Move | CoreMove): string =>
  move.type === 'pass' ? 'pass' : `${tileKey(move.tile!)}@${move.position}`;
const pips = (hand: readonly (Tile | CoreTile)[]): number => hand.reduce((sum, tile) => sum + tile.low + tile.high, 0);

/** mulberry32: a small seeded generator for choosing moves. */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The config a match under this variant should be played with, written out independently of resolveMatchConfig. */
function expectedConfig(variant: DifferentialVariant): Config {
  return {
    ...DEFAULT_CONFIG,
    tilesPerPlayer: variant.dealSize,
    deadTileCount: variant.dealSize === 14 ? 0 : 2,
    winningScore: variant.winningScore,
    skipPregameDraw: true,
    ...(variant.rules.blockedHandRule ? { blockedHandRule: variant.rules.blockedHandRule } : {}),
    ...(variant.rules.endHandBonus ? { endHandBonus: variant.rules.endHandBonus } : {}),
    ...(variant.rules.scoringMultiple ? { scoringMultiple: variant.rules.scoringMultiple } : {}),
  };
}

function dealFor(seed: number, handNumber: number, variant: DifferentialVariant) {
  const deal = createDeterministicDoubleSixDeal({
    seed: `differential:${seed}:h${handNumber}`,
    tilesPerPlayer: variant.dealSize,
    deadTileCount: variant.dealSize === 14 ? 0 : 2,
  });
  const clientDeal: BotHandDeal = {
    player_tiles: deal.playerTiles.map((t) => ({ low: t.low, high: t.high })),
    fritz_tiles: deal.opponentTiles.map((t) => ({ low: t.low, high: t.high })),
    boneyard: deal.boneyard.map((t) => ({ low: t.low, high: t.high })),
    locked: deal.deadTiles.map((t) => ({ low: t.low, high: t.high })),
  };
  // game-core deals from one deck: player one's tiles, then player two's, then the boneyard (dead tiles last in it).
  const deck: CoreTile[] = [...deal.playerTiles, ...deal.opponentTiles, ...deal.boneyard].map((t) => ({ low: t.low, high: t.high }));
  return { clientDeal, deck };
}

/** Odd hands start with 'you' (the match starter), even hands alternate. */
const starterOf = (handNumber: number): BotPlayerId => (handNumber % 2 === 1 ? 'you' : 'bot');

export function playDifferentialGame(seed: number, variant: DifferentialVariant): DifferentialGameReport {
  const divergences: Divergence[] = [];
  const rng = createRng(seed * 7919 + variant.name.length);
  const coverage = emptyCoverage();
  let step = 0;
  let handsPlayed = 1;

  const first = dealFor(seed, 1, variant);
  let client: BotMatchState = createFixedBotMatch(first.clientDeal, variant.winningScore, variant.dealSize, variant.rules);
  const config = expectedConfig(variant);
  let core: CoreState = coreStartNewHand(createInitialState([...PLAYERS], config), first.deck, starterOf(1));
  let coreSequenceAtHandStart = core.sequence;

  const diverge = (kind: string, detail: string, clientValue: unknown, coreValue: unknown): void => {
    divergences.push({ seed, variant: variant.name, handNumber: client.handNumber, step, kind, detail, client: clientValue, core: coreValue });
  };
  const check = (kind: string, detail: string, clientValue: unknown, coreValue: unknown): boolean => {
    if (isDeepEqual(clientValue, coreValue)) return true;
    diverge(kind, detail, clientValue, coreValue);
    return false;
  };

  if (!check('config', 'the config the client plays under', resolveMatchConfig(client), config)) {
    return { seed, variant: variant.name, steps: 0, hands: 1, finished: false, divergences, coverage };
  }

  /** Every field both sides track, compared after each transition. Returns false at the first mismatch. */
  const compareStates = (where: string): boolean => {
    let ok = true;
    for (const id of PLAYERS) {
      ok = check('hand', `${where}: ${id} hand`, client.players[id].hand.map(tileKey), core.players[id].hand.map(tileKey)) && ok;
      ok = check('score', `${where}: ${id} score`, client.players[id].score, core.players[id].score) && ok;
    }
    ok = check('board', `${where}: board`, client.board, core.board) && ok;
    ok = check('boneyard', `${where}: boneyard`, client.boneyard.map(tileKey), core.boneyard.map(tileKey)) && ok;
    ok = check('deadTiles', `${where}: dead tiles`, client.deadTiles.map(tileKey), core.deadTiles.map(tileKey)) && ok;
    ok = check('currentPlayer', `${where}: current player`, client.currentPlayer, core.playerIds[core.currentPlayerIndex]) && ok;
    ok = check('handNumber', `${where}: hand number`, client.handNumber, core.handNumber) && ok;
    ok = check('handOpen', `${where}: hand open`, client.handOpen, core.handOpen) && ok;
    ok = check('handOver', `${where}: hand over`, client.handOver, core.handOver) && ok;
    ok = check('gameOver', `${where}: game over`, client.gameOver, core.gameOver) && ok;
    ok = check('winnerId', `${where}: game winner`, client.winnerId, core.winnerId) && ok;
    ok = check('consecutivePasses', `${where}: consecutive passes`, client.consecutivePasses, core.consecutivePasses) && ok;
    // The client counts turns from zero in each hand; game-core's sequence keeps counting across hands.
    ok = check('turnIndex', `${where}: turn index within the hand`, client.turnIndex ?? 0, core.sequence - coreSequenceAtHandStart) && ok;
    // Conservation: all 28 tiles are somewhere, once.
    const everywhere = [
      ...client.players.you.hand,
      ...client.players.bot.hand,
      ...client.boneyard,
      ...(client.board ? placedTiles(client.board) : []),
    ].map(tileKey);
    if (new Set(everywhere).size !== everywhere.length || everywhere.length !== 28) {
      diverge('conservation', `${where}: tiles not conserved`, everywhere.length, 28);
      ok = false;
    }
    return ok;
  };

  /** What the hand-end report should say, from the real score movement across one core transition. */
  const checkHandEnd = (
    before: CoreState,
    result: BotActionResult,
    mover: BotPlayerId,
    playScore: number,
    reasonHint: 'play' | 'pass',
  ): void => {
    if (!core.handOver || before.handOver) {
      check('handEndedSpurious', 'a hand-end report without the hand ending', result.handEnded === undefined, true);
      return;
    }
    const report = result.handEnded;
    if (!report) {
      diverge('handEndedMissing', 'the hand ended but the client reported no hand end', undefined, 'handOver');
      return;
    }
    const delta = (id: BotPlayerId) => core.players[id].score - before.players[id].score;
    const emptied = PLAYERS.find((id) => core.players[id].hand.length === 0) ?? null;
    const expectedReason = emptied ? 'domino' : 'blocked';
    if (emptied) coverage.handsWentOut += 1;
    else coverage.handsBlocked += 1;
    check('handEndedReason', 'domino or blocked', report.reason, expectedReason);

    // The hand's winner under the rules (not inferred from the score movement).
    let expectedWinner: BotPlayerId | null;
    if (emptied) expectedWinner = emptied;
    else if (core.config.blockedHandRule === 'noScore') expectedWinner = null;
    else {
      const [a, b] = [pips(core.players.you.hand), pips(core.players.bot.hand)];
      expectedWinner = a === b ? null : a < b ? 'you' : 'bot';
    }

    // KNOWN (docs in engineDifferential.test.ts): the adapter infers the winner from who gained more score, so a hand that
    // ends with no score movement at all reports no winner even though the rules name one.
    const winnerInferredNull = report.winner === null && expectedWinner !== null && delta('you') === delta('bot');
    if (report.winner !== expectedWinner) {
      if (winnerInferredNull) {
        diverge('handEndedWinnerInferredFromScoreMovement', `hand winner (${reasonHint} by ${mover}): no score moved`, report.winner, expectedWinner);
      } else {
        diverge('handEndedWinner', `hand winner (${reasonHint} by ${mover})`, report.winner, expectedWinner);
      }
    }

    // The bonus the hand end actually added, net of the points the final play itself scored.
    const bonusDelta = expectedWinner ? delta(expectedWinner) - (expectedWinner === mover ? playScore : 0) : 0;
    if (report.pointsAwarded !== bonusDelta) {
      // KNOWN: under endHandBonus 'none' the report still computes the go-out bonus from the loser's hand.
      if (report.winner === expectedWinner && core.config.endHandBonus === 'none' && bonusDelta === 0) {
        diverge('handEndedPointsIgnoresEndHandBonusNone', 'points awarded by the hand end', report.pointsAwarded, bonusDelta);
      } else {
        diverge('handEndedPoints', 'points awarded by the hand end', report.pointsAwarded, bonusDelta);
      }
    }

    // The loser is whoever is not the winner; with no inferred winner the report measures the wrong hand.
    const loser = expectedWinner ? (expectedWinner === 'you' ? 'bot' : 'you') : null;
    if (loser && report.loserPips !== pips(core.players[loser].hand)) {
      if (winnerInferredNull) {
        diverge('handEndedLoserPipsFromNullWinner', 'the loser\'s pips', report.loserPips, pips(core.players[loser].hand));
      } else {
        diverge('handEndedLoserPips', 'the loser\'s pips', report.loserPips, pips(core.players[loser].hand));
      }
    }
  };

  while (!client.gameOver && step < MAX_STEPS) {
    step += 1;

    if (client.handOver) {
      handsPlayed += 1;
      const next = dealFor(seed, client.handNumber + 1, variant);
      client = startNextFixedBotHand(client, next.clientDeal);
      core = coreStartNewHand(core, next.deck, starterOf(core.handNumber + 1));
      coreSequenceAtHandStart = core.sequence;
      if (!compareStates('new hand')) break;
      continue;
    }

    const player = client.currentPlayer;
    const coreMoves = coreGetLegalMoves(core, player);
    const clientMoves = getLegalMoves(client, player);
    if (!check('legalMoves', `legal moves for ${player}`, clientMoves.map(moveKey), coreMoves.map(moveKey))) break;

    const plays = coreMoves.filter((m): m is Extract<CoreMove, { type: 'play' }> => m.type === 'play');

    if (plays.length === 0) {
      // Forced draw until a play appears or the drawable boneyard is exhausted, then a pass when still stuck.
      const before = core;
      // One tile at a time: the client records each draw as its own command (see drawUntilPlayableOrEmptyCoreState), which
      // advances the sequence once per tile. game-core's bulk drawUntilPlayableOrEmpty does not advance it per tile, so it is
      // not the right oracle for the sequence counter (that is a difference between two core entry points, not client vs core).
      let drewCount = 0;
      for (;;) {
        if (coreGetLegalMoves(core, player).some((m) => m.type === 'play')) break;
        const step1 = coreDrawOne(core, player);
        if (!step1.drew) break;
        core = step1.state;
        drewCount += 1;
      }
      const drawn = { drew: drewCount };
      if (drewCount > 0) coverage.drawSequences += 1;
      const result: BotActionResult = drawUntilPlayableOrEmpty(client, player);
      if (result.error) {
        diverge('drawRejected', 'the client rejected a draw game-core allowed', result.error, null);
        break;
      }
      client = result.state;
      let finalResult = result;
      if (drawn.drew === 0) {
        const stuck = coreGetLegalMoves(core, player);
        if (stuck.length === 1 && stuck[0].type === 'pass') {
          core = coreApplyMove(core, player, { type: 'pass' }).state;
          coverage.passes += 1;
          // drawUntilPlayableOrEmpty already passed for the client when nothing was drawable.
          finalResult = result;
        }
      }
      if (!compareStates(`draw/pass by ${player}`)) break;
      checkHandEnd(before, finalResult, player, 0, 'pass');
      continue;
    }

    // Placement targets per tile in hand, against the legal moves game-core lists for that tile.
    if (core.handOpen) {
      for (const tile of core.players[player].hand) {
        const wanted = [...new Set(plays.filter((m) => tileKey(m.tile) === tileKey(tile)).map((m) => m.position))].sort();
        const got = [...new Set(getPlacementTargetsForTile(client.board, tile))].sort();
        if (!check('placementTargets', `placement targets for ${tileKey(tile)} (${player})`, got, wanted)) {
          return finish();
        }
      }
      // The raw open ends game-core reports against the matchable ends the client uses: same positions, and the same
      // match value wherever the ends are single pips.
      const coreEnds = coreGetOpenEnds(core.board);
      const clientEnds = getMatchableOpenEnds(client.board);
      check('openEndPositions', 'open end positions', clientEnds.map((e) => e.position), coreEnds.map((e) => e.position));
    }

    // A previewed play against what really happens, for every legal play (not only the one taken).
    for (const play of plays) {
      const preview = previewPlayMove(client, player, play);
      coverage.previewsChecked += 1;
      if (!preview) {
        diverge('previewMissing', `no preview for a legal play ${moveKey(play)}`, null, moveKey(play));
        return finish();
      }
      const applied = coreApplyMove(core, player, play);
      const after = applied.state;
      const expectedScore = after.board ? coreComputePlayScore(after.board, core.config) : 0;
      const sameTurn = !after.handOver && after.playerIds[after.currentPlayerIndex] === player;
      const ok =
        check('previewScore', `immediate score of ${moveKey(play)}`, preview.immediateScore, expectedScore) &&
        check('previewBoard', `board after ${moveKey(play)}`, preview.nextBoard, after.board) &&
        // The preview hand is the hand after the tile leaves it; a forced draw (when the turn continues and nothing is playable) adds tiles after.
        check('previewHand', `hand after ${moveKey(play)}`, preview.nextHand.map(tileKey), after.players[player].hand.slice(0, preview.nextHand.length).map(tileKey));
      if (!ok) return finish();
      if (!after.handOver && preview.turnContinues !== sameTurn) {
        // KNOWN: the preview reports the rule ("a scoring play or a double keeps your turn"). After such a play with nothing
        // playable, game-core runs the forced-draw chain and, if no draw finds a play, passes the turn inside the same move.
        if (preview.turnContinues && !sameTurn && after.consecutivePasses > 0) {
          diverge('previewTurnContinuesButEngineAutoPassed', `turn after ${moveKey(play)}`, preview.turnContinues, sameTurn);
        } else {
          diverge('previewTurnContinues', `turn continues after ${moveKey(play)}`, preview.turnContinues, sameTurn);
          return finish();
        }
      }
    }

    // Take one of the legal plays, chosen by the seeded generator, on both sides.
    const move = plays[Math.floor(rng() * plays.length)];
    const before = core;
    const playScore = (() => {
      const simulated = coreApplyMove(before, player, move).state;
      return simulated.board ? coreComputePlayScore(simulated.board, before.config) : 0;
    })();
    const applied = coreApplyMove(core, player, move);
    core = applied.state;
    coverage.plays += 1;
    if (playScore > 0) coverage.scoringPlays += 1;
    if (move.tile.low === move.tile.high) coverage.doublePlays += 1;
    if (move.position.startsWith('branch')) coverage.branchPlays += 1;
    if ((playScore > 0 || move.tile.low === move.tile.high) && !core.handOver && core.playerIds[core.currentPlayerIndex] !== player) {
      coverage.autoPassesAfterScoringPlay += 1;
    }
    const result = applyPlayMove(client, player, move);
    if (result.error) {
      diverge('playRejected', `the client rejected ${moveKey(move)}, which game-core allowed`, result.error, null);
      break;
    }
    client = result.state;
    check('scoredReport', 'points the client reports for the play', result.scored?.points ?? 0, playScore);
    if (!compareStates(`${player} plays ${moveKey(move)}`)) break;
    checkHandEnd(before, result, player, playScore, 'play');
  }

  function finish(): DifferentialGameReport {
    return { seed, variant: variant.name, steps: step, hands: handsPlayed, finished: client.gameOver, divergences, coverage };
  }
  return finish();
}

function placedTiles(board: NonNullable<BotMatchState['board']>): Tile[] {
  const tiles: Tile[] = board.mainLine.map((placed) => placed.tile);
  for (const hub of board.hubDoubles) {
    for (const branch of hub.branches) {
      if (branch) tiles.push(...branch.tiles.map((placed) => placed.tile));
    }
  }
  return tiles;
}

export interface DifferentialSummary {
  readonly games: number;
  readonly steps: number;
  readonly unfinished: number;
  readonly divergences: Divergence[];
  readonly coverage: DifferentialCoverage;
}

/** Play `games` seeded games per variant, from `firstSeed`. */
export function runDifferential(games: number, firstSeed = 1, variants: readonly DifferentialVariant[] = DIFFERENTIAL_VARIANTS): DifferentialSummary {
  const divergences: Divergence[] = [];
  let steps = 0;
  let unfinished = 0;
  let played = 0;
  const coverage = emptyCoverage();
  for (const variant of variants) {
    for (let offset = 0; offset < games; offset += 1) {
      const report = playDifferentialGame(firstSeed + offset, variant);
      played += 1;
      steps += report.steps;
      if (!report.finished && report.divergences.length === 0) unfinished += 1;
      divergences.push(...report.divergences);
      for (const key of Object.keys(coverage) as Array<keyof DifferentialCoverage>) coverage[key] += report.coverage[key];
    }
  }
  return { games: played, steps, unfinished, divergences, coverage };
}
