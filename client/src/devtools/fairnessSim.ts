/**
 * Fritz fairness simulation — deal/draw equity and outcome stats.
 * Run: npx ts-node --esm src/devtools/fairnessSim.ts [matchCount] [humanTier] [fritzTier]
 */
import {
  applyPlayMove,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  type BotDealSize,
  type BotMatchState,
  type BotPlayerId,
} from '../bot/botEngine.ts';
import { chooseBotMove, toBotVisibleState, type BotDifficulty } from '../bot/botHeuristics.ts';
import type { Tile } from '../types.ts';

const WINNING_SCORE = 60;
const FULL_DECK: Tile[] = [];
for (let high = 0; high <= 6; high++) {
  for (let low = 0; low <= high; low++) {
    FULL_DECK.push({ low, high });
  }
}

function createRNG(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    const t = Math.imul(s ^ (s >>> 15), 1 | s);
    const u = t + (Math.imul(t ^ (t >>> 7), 61 | t) ^ t);
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function sumPips(hand: readonly Tile[]): number {
  return hand.reduce((s, t) => s + t.low + t.high, 0);
}

function countDoubles(hand: readonly Tile[]): number {
  return hand.filter((t) => t.low === t.high).length;
}

function isPlayableOnEnds(tile: Tile, openEnds: number[]): boolean {
  if (openEnds.length === 0) return tile.low === tile.high;
  return openEnds.some((e) => tile.low === e || tile.high === e);
}

function swapPlayers(state: BotMatchState): BotMatchState {
  return {
    ...state,
    players: { bot: state.players.you, you: state.players.bot },
    currentPlayer: state.currentPlayer === 'bot' ? 'you' : 'bot',
    lastHandWinner:
      state.lastHandWinner === 'bot' ? 'you' : state.lastHandWinner === 'you' ? 'bot' : null,
    winnerId: state.winnerId === 'bot' ? 'you' : state.winnerId === 'you' ? 'bot' : null,
    opponentPassedOnEnds: [],
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

interface MatchStats {
  seed: number;
  humanSeat: 'you' | 'bot';
  humanWon: boolean;
  humanScore: number;
  fritzScore: number;
  handsPlayed: number;
  humanOpeningPips: number;
  fritzOpeningPips: number;
  humanOpeningDoubles: number;
  fritzOpeningDoubles: number;
  humanDraws: number;
  fritzDraws: number;
  humanPlayableDraws: number;
  fritzPlayableDraws: number;
  humanDrawPipSum: number;
  fritzDrawPipSum: number;
  humanRacePoints: number;
  fritzRacePoints: number;
  humanPipBonuses: number;
  fritzPipBonuses: number;
  humanComebackWin: boolean;
  humanMaxDeficit: number;
  fritzMaxDeficit: number;
  humanStartedHand1: boolean;
  illegalMoveAttempts: number;
}

function runInstrumentedMatch(
  seed: number,
  humanDifficulty: BotDifficulty,
  fritzDifficulty: BotDifficulty,
  humanSeat: 'you' | 'bot',
): MatchStats {
  const matchRNG = createRNG(seed);
  const dealSize: BotDealSize = 7;
  const hand1Deck = seededShuffle(FULL_DECK, matchRNG);
  const youHand = hand1Deck.slice(0, dealSize);
  const botHand = hand1Deck.slice(dealSize, dealSize * 2);
  const remaining = hand1Deck.slice(dealSize * 2);

  let state: BotMatchState = {
    players: {
      you: { hand: youHand, score: 0 },
      bot: { hand: botHand, score: 0 },
    },
    board: null,
    boneyard: remaining,
    deadTiles: remaining.slice(remaining.length - 2),
    handOpen: false,
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: WINNING_SCORE,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };

  const humanId: BotPlayerId = humanSeat;
  const fritzId: BotPlayerId = humanSeat === 'you' ? 'bot' : 'you';
  const diffMap: Record<BotPlayerId, BotDifficulty> = {
    bot: fritzId === 'bot' ? fritzDifficulty : humanDifficulty,
    you: fritzId === 'you' ? fritzDifficulty : humanDifficulty,
  };

  const stats: MatchStats = {
    seed,
    humanSeat,
    humanWon: false,
    humanScore: 0,
    fritzScore: 0,
    handsPlayed: 0,
    humanOpeningPips: sumPips(state.players[humanId].hand),
    fritzOpeningPips: sumPips(state.players[fritzId].hand),
    humanOpeningDoubles: countDoubles(state.players[humanId].hand),
    fritzOpeningDoubles: countDoubles(state.players[fritzId].hand),
    humanDraws: 0,
    fritzDraws: 0,
    humanPlayableDraws: 0,
    fritzPlayableDraws: 0,
    humanDrawPipSum: 0,
    fritzDrawPipSum: 0,
    humanRacePoints: 0,
    fritzRacePoints: 0,
    humanPipBonuses: 0,
    fritzPipBonuses: 0,
    humanComebackWin: false,
    humanMaxDeficit: 0,
    fritzMaxDeficit: 0,
    humanStartedHand1: state.currentPlayer === humanId,
    illegalMoveAttempts: 0,
  };

  while (!state.gameOver) {
    const humanScore = state.players[humanId].score;
    const fritzScore = state.players[fritzId].score;
    stats.humanMaxDeficit = Math.max(stats.humanMaxDeficit, fritzScore - humanScore);
    stats.fritzMaxDeficit = Math.max(stats.fritzMaxDeficit, humanScore - fritzScore);

    if (state.handOver) {
      stats.handsPlayed += 1;
      const reason = state.lastHandReason;
      const winner = state.lastHandWinner;
      if (winner && reason) {
        const bonusPlayer = winner;
        const loser = winner === 'you' ? 'bot' : 'you';
        const pipBonus = Math.round(sumPips(state.players[loser].hand) / 5);
        if (bonusPlayer === humanId) stats.humanPipBonuses += pipBonus;
        else stats.fritzPipBonuses += pipBonus;
      }
      const nextScores = { you: state.players.you.score, bot: state.players.bot.score };
      const handNumber = state.handNumber + 1;
      const handDeck = seededShuffle(FULL_DECK, matchRNG);
      const youH = handDeck.slice(0, 7);
      const botH = handDeck.slice(7, 14);
      const rem = handDeck.slice(14);
      state = {
        ...state,
        players: {
          you: { hand: youH, score: nextScores.you },
          bot: { hand: botH, score: nextScores.bot },
        },
        board: null,
        boneyard: rem,
        deadTiles: rem.slice(rem.length - 2),
        handOpen: false,
        currentPlayer: handNumber % 2 === 1 ? 'you' : 'bot',
        consecutivePasses: 0,
        handNumber,
        turnIndex: 0,
        handOver: false,
        opponentPassedOnEnds: [],
        opponentKnownMissing: [],
        opponentMissingEvidence: [],
      };
      continue;
    }

    const currentPlayer = state.currentPlayer;
    const difficulty = diffMap[currentPlayer];
    const moves = getLegalMoves(state, currentPlayer);
    const openEnds: number[] = state.board
      ? [
          ...(state.board.leftEnd !== undefined ? [state.board.leftEnd] : []),
          ...(state.board.rightEnd !== undefined ? [state.board.rightEnd] : []),
        ]
      : [];

    if (moves.length === 0 || (moves.length === 1 && moves[0].type === 'pass')) {
      const beforeLen = state.players[currentPlayer].hand.length;
      const beforeBoneyard = state.boneyard.length;
      const result = drawUntilPlayableOrEmpty(state, currentPlayer);
      state = result.state;
      if (result.drew && beforeBoneyard > state.boneyard.length) {
        const drawn = result.drew.tile;
        const playable = isPlayableOnEnds(drawn, openEnds);
        const pip = drawn.low + drawn.high;
        if (currentPlayer === humanId) {
          stats.humanDraws += 1;
          stats.humanDrawPipSum += pip;
          if (playable) stats.humanPlayableDraws += 1;
        } else {
          stats.fritzDraws += 1;
          stats.fritzDrawPipSum += pip;
          if (playable) stats.fritzPlayableDraws += 1;
        }
      } else if (beforeLen === state.players[currentPlayer].hand.length && moves.length === 1) {
        // pass only
      }
      continue;
    }

    const visible =
      currentPlayer === 'bot' ? toBotVisibleState(state) : toBotVisibleState(swapPlayers(state));
    const choice = chooseBotMove(visible, difficulty);
    const scoreBefore = state.players[currentPlayer].score;

    if (choice) {
      const legal = moves.some(
        (m) =>
          m.type === 'play' &&
          choice.move.type === 'play' &&
          m.tile &&
          choice.move.tile &&
          m.tile.low === choice.move.tile.low &&
          m.tile.high === choice.move.tile.high,
      );
      if (!legal) stats.illegalMoveAttempts += 1;
      const result = applyPlayMove(state, currentPlayer, choice.move);
      state = result.state;
      const gained = state.players[currentPlayer].score - scoreBefore;
      if (gained > 0) {
        if (currentPlayer === humanId) stats.humanRacePoints += gained;
        else stats.fritzRacePoints += gained;
      }
    } else {
      const result = drawUntilPlayableOrEmpty(state, currentPlayer);
      state = result.state;
    }
  }

  stats.humanScore = state.players[humanId].score;
  stats.fritzScore = state.players[fritzId].score;
  stats.humanWon = state.winnerId === humanId;
  stats.humanComebackWin = stats.humanWon && stats.humanMaxDeficit >= 15;
  return stats;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(1)}%` : 'n/a';
}

function runFairnessSuite(
  matchCount: number,
  humanTier: BotDifficulty,
  fritzTier: BotDifficulty,
) {
  const paired = matchCount;
  const results: MatchStats[] = [];
  for (let s = 1; s <= paired; s++) {
    results.push(runInstrumentedMatch(s, humanTier, fritzTier, 'you'));
    results.push(runInstrumentedMatch(s, humanTier, fritzTier, 'bot'));
    if (s % 100 === 0) console.error(`[fairness] ${s * 2}/${paired * 2} games…`);
  }

  const humanWins = results.filter((r) => r.humanWon).length;
  const humanSeatYou = results.filter((r) => r.humanSeat === 'you');
  const humanSeatBot = results.filter((r) => r.humanSeat === 'bot');
  const youSeatWins = humanSeatYou.filter((r) => r.humanWon).length;
  const botSeatWins = humanSeatBot.filter((r) => r.humanWon).length;

  const openingPipDelta = results.map((r) => r.humanOpeningPips - r.fritzOpeningPips);
  const openingDoubleDelta = results.map((r) => r.humanOpeningDoubles - r.fritzOpeningDoubles);

  const humanPlayableDrawRate = results.map((r) =>
    r.humanDraws ? r.humanPlayableDraws / r.humanDraws : 0,
  );
  const fritzPlayableDrawRate = results.map((r) =>
    r.fritzDraws ? r.fritzPlayableDraws / r.fritzDraws : 0,
  );

  const comebackWins = results.filter((r) => r.humanComebackWin).length;
  const fritzComebackWins = results.filter(
    (r) => !r.humanWon && r.fritzMaxDeficit >= 15,
  ).length;

  const report = {
    generatedAt: new Date().toISOString(),
    config: { matchCount, pairedGames: paired * 2, humanTier, fritzTier, winningScore: WINNING_SCORE },
    outcomes: {
      humanWinRate: humanWins / results.length,
      fritzWinRate: 1 - humanWins / results.length,
      humanWinRateSeatYou: youSeatWins / humanSeatYou.length,
      humanWinRateSeatBot: botSeatWins / humanSeatBot.length,
      avgMargin: avg(results.map((r) => Math.abs(r.humanScore - r.fritzScore))),
      illegalMoveAttempts: results.reduce((s, r) => s + r.illegalMoveAttempts, 0),
    },
    openingDeal: {
      avgHumanOpeningPips: avg(results.map((r) => r.humanOpeningPips)),
      avgFritzOpeningPips: avg(results.map((r) => r.fritzOpeningPips)),
      avgPipDeltaHumanMinusFritz: avg(openingPipDelta),
      avgDoubleDeltaHumanMinusFritz: avg(openingDoubleDelta),
      humanBetterOpeningRate: openingPipDelta.filter((d) => d < 0).length / results.length,
    },
    draws: {
      avgHumanDrawsPerGame: avg(results.map((r) => r.humanDraws)),
      avgFritzDrawsPerGame: avg(results.map((r) => r.fritzDraws)),
      avgHumanPlayableDrawRate: avg(humanPlayableDrawRate),
      avgFritzPlayableDrawRate: avg(fritzPlayableDrawRate),
      avgHumanDrawPipPerDraw: avg(
        results.filter((r) => r.humanDraws).map((r) => r.humanDrawPipSum / r.humanDraws),
      ),
      avgFritzDrawPipPerDraw: avg(
        results.filter((r) => r.fritzDraws).map((r) => r.fritzDrawPipSum / r.fritzDraws),
      ),
    },
    scoring: {
      avgHumanRacePointsPerGame: avg(results.map((r) => r.humanRacePoints)),
      avgFritzRacePointsPerGame: avg(results.map((r) => r.fritzRacePoints)),
      avgHumanPipBonusesPerGame: avg(results.map((r) => r.humanPipBonuses)),
      avgFritzPipBonusesPerGame: avg(results.map((r) => r.fritzPipBonuses)),
      avgHandsPerGame: avg(results.map((r) => r.handsPlayed)),
    },
    comebacks: {
      humanComebackWinRate15Plus: comebackWins / results.length,
      fritzComebackWinRate15Plus: fritzComebackWins / results.length,
    },
  };

  console.log('\n=== Fritz Fairness Simulation ===');
  console.log(`Games: ${results.length} (${matchCount} seeds × 2 seat swaps)`);
  console.log(`Human tier: ${humanTier} | Fritz tier: ${fritzTier}\n`);
  console.log('| Metric | Value | Suspicious? |');
  console.log('|--------|-------|-------------|');
  console.log(`| Human win rate | ${pct(humanWins, results.length)} | ${humanWins / results.length < 0.35 ? 'Fritz very strong' : 'Expected if Fritz stronger'} |`);
  console.log(`| Human win rate (seat you) | ${pct(youSeatWins, humanSeatYou.length)} | Seat bias check |`);
  console.log(`| Human win rate (seat bot) | ${pct(botSeatWins, humanSeatBot.length)} | Seat bias check |`);
  console.log(`| Avg opening pip delta (human−Fritz) | ${report.openingDeal.avgPipDeltaHumanMinusFritz.toFixed(2)} | ${Math.abs(report.openingDeal.avgPipDeltaHumanMinusFritz) > 1 ? 'Review' : 'Neutral'} |`);
  console.log(`| Avg opening doubles delta | ${report.openingDeal.avgDoubleDeltaHumanMinusFritz.toFixed(3)} | Neutral expected ~0 |`);
  console.log(`| Human playable draw rate | ${(report.draws.avgHumanPlayableDrawRate * 100).toFixed(1)}% | Compare Fritz |`);
  console.log(`| Fritz playable draw rate | ${(report.draws.avgFritzPlayableDrawRate * 100).toFixed(1)}% | Compare human |`);
  console.log(`| Draw rate delta (Fritz−human) | ${((report.draws.avgFritzPlayableDrawRate - report.draws.avgHumanPlayableDrawRate) * 100).toFixed(1)}pp | ${Math.abs(report.draws.avgFritzPlayableDrawRate - report.draws.avgHumanPlayableDrawRate) > 0.05 ? 'P1 info edge (boneyard oracle)' : 'OK'} |`);
  console.log(`| Illegal AI moves | ${report.outcomes.illegalMoveAttempts} | Must be 0 |`);
  console.log(`| Human comeback wins (trailed ≥15) | ${pct(comebackWins, results.length)} | — |`);
  console.log(`| Fritz comeback wins (trailed ≥15) | ${pct(fritzComebackWins, results.length)} | — |`);
  console.log(`| Avg race points/game (human) | ${report.scoring.avgHumanRacePointsPerGame.toFixed(1)} | — |`);
  console.log(`| Avg race points/game (Fritz) | ${report.scoring.avgFritzRacePointsPerGame.toFixed(1)} | — |`);
  console.log(`| Avg pip bonuses/game (human) | ${report.scoring.avgHumanPipBonusesPerGame.toFixed(1)} | — |`);
  console.log(`| Avg pip bonuses/game (Fritz) | ${report.scoring.avgFritzPipBonusesPerGame.toFixed(1)} | — |`);
  console.log('\nJSON:');
  console.log(JSON.stringify(report, null, 2));
}

declare const process: { argv: string[] };
const n = parseInt(process.argv[2] ?? '500', 10);
const human = (process.argv[3] as BotDifficulty) ?? 'standard';
const fritz = (process.argv[4] as BotDifficulty) ?? 'hard';
runFairnessSuite(n, human, fritz);
