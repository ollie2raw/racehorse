import { writeFileSync } from 'node:fs';
import {
  applyPlayMove,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  type BotDealSize,
  type BotMatchState,
  type BotPlayerId,
} from './botEngine.ts';
import { chooseBotMove, toBotVisibleState, type BotDifficulty } from './botHeuristics.ts';
import type { Tile } from '../types.ts';

const SKUNK_THRESHOLD = 30;
const WINNING_SCORE = 60;

// --- Seeded Random Utilities ---

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

const FULL_DECK: Tile[] = [];
for (let high = 0; high <= 6; high++) {
  for (let low = 0; low <= high; low++) {
    FULL_DECK.push({ low, high });
  }
}

function swapPlayers(state: BotMatchState): BotMatchState {
  return {
    ...state,
    players: {
      bot: state.players.you,
      you: state.players.bot,
    },
    currentPlayer: state.currentPlayer === 'bot' ? 'you' : 'bot',
    lastHandWinner:
      state.lastHandWinner === 'bot' ? 'you' : state.lastHandWinner === 'you' ? 'bot' : null,
    winnerId: state.winnerId === 'bot' ? 'you' : state.winnerId === 'you' ? 'bot' : null,
    opponentPassedOnEnds: [],
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

export interface GameSimResult {
  winner: 'p1' | 'p2';
  p1Score: number;
  p2Score: number;
  margin: number;
  handsPlayed: number;
  moveCount: number;
  p1Passes: number;
  p2Passes: number;
  /** Winner scored race points; loser finished below SKUNK_THRESHOLD */
  skunk: boolean;
}

export function runSeededMatch(
  seed: number,
  p1Difficulty: BotDifficulty,
  p2Difficulty: BotDifficulty,
): GameSimResult {
  const matchRNG = createRNG(seed);
  const diffMap: Record<BotPlayerId, BotDifficulty> = {
    bot: p1Difficulty,
    you: p2Difficulty,
  };

  const p1Id: BotPlayerId = 'bot';
  const p2Id: BotPlayerId = 'you';

  const hand1Deck = seededShuffle(FULL_DECK, matchRNG);
  const dealSize: BotDealSize = 7;
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

  let handsPlayed = 0;
  let moveCount = 0;
  let p1Passes = 0;
  let p2Passes = 0;

  while (!state.gameOver) {
    if (state.handOver) {
      handsPlayed += 1;
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

    if (moves.length === 0 || (moves.length === 1 && moves[0].type === 'pass')) {
      if (moves.length === 1 && moves[0].type === 'pass') {
        if (currentPlayer === p1Id) p1Passes++;
        else p2Passes++;
      }
      const result = drawUntilPlayableOrEmpty(state, currentPlayer);
      state = result.state;
      moveCount += 1;
      continue;
    }

    const visible =
      currentPlayer === 'bot' ? toBotVisibleState(state) : toBotVisibleState(swapPlayers(state));
    const botChoice = chooseBotMove(visible, difficulty);

    if (botChoice) {
      moveCount += 1;
      const result = applyPlayMove(state, currentPlayer, botChoice.move);
      state = result.state;
    } else {
      moveCount += 1;
      const result = drawUntilPlayableOrEmpty(state, currentPlayer);
      state = result.state;
    }
  }

  const p1Won = state.winnerId === p1Id;
  const p1Score = state.players[p1Id].score;
  const p2Score = state.players[p2Id].score;
  const loserScore = p1Won ? p2Score : p1Score;

  return {
    winner: p1Won ? 'p1' : 'p2',
    p1Score,
    p2Score,
    margin: Math.abs(p1Score - p2Score),
    handsPlayed,
    moveCount,
    p1Passes,
    p2Passes,
    skunk: loserScore < SKUNK_THRESHOLD,
  };
}

export interface PairedTierStats {
  label: string;
  tierA: BotDifficulty;
  tierB: BotDifficulty;
  seeds: number;
  totalGames: number;
  tierAWins: number;
  tierBWins: number;
  tierAWinRate: number;
  avgMarginTierA: number;
  medianMarginTierA: number;
  skunkRate: number;
  avgHandsPerGame: number;
  avgMovesPerGame: number;
  avgPassesPerGame: number;
  blowoutRate30Plus: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function runPairedTierBenchmark(
  numSeeds: number,
  tierA: BotDifficulty,
  tierB: BotDifficulty,
  label?: string,
): PairedTierStats {
  const tierAMargins: number[] = [];
  let tierAWins = 0;
  let tierBWins = 0;
  let skunkCount = 0;
  let blowoutCount = 0;
  let totalHands = 0;
  let totalMoves = 0;
  let totalPasses = 0;

  for (let s = 1; s <= numSeeds; s++) {
    const res1 = runSeededMatch(s, tierA, tierB);
    const res2 = runSeededMatch(s, tierB, tierA);

    const games: Array<{ tierAWon: boolean; marginForA: number; result: GameSimResult }> = [
      {
        tierAWon: res1.winner === 'p1',
        marginForA: res1.winner === 'p1' ? res1.margin : -res1.margin,
        result: res1,
      },
      {
        tierAWon: res2.winner === 'p2',
        marginForA: res2.winner === 'p2' ? res2.margin : -res2.margin,
        result: res2,
      },
    ];

    for (const g of games) {
      if (g.tierAWon) tierAWins++;
      else tierBWins++;
      tierAMargins.push(Math.abs(g.marginForA));
      if (g.result.skunk) skunkCount++;
      if (g.result.margin >= 30) blowoutCount++;
      totalHands += g.result.handsPlayed;
      totalMoves += g.result.moveCount;
      totalPasses += g.result.p1Passes + g.result.p2Passes;
    }
  }

  const totalGames = numSeeds * 2;
  const absMargins = tierAMargins;

  return {
    label: label ?? `${tierA} vs ${tierB}`,
    tierA,
    tierB,
    seeds: numSeeds,
    totalGames,
    tierAWins,
    tierBWins,
    tierAWinRate: (tierAWins / totalGames) * 100,
    avgMarginTierA: absMargins.reduce((s, v) => s + v, 0) / totalGames,
    medianMarginTierA: median(absMargins),
    skunkRate: (skunkCount / totalGames) * 100,
    avgHandsPerGame: totalHands / totalGames,
    avgMovesPerGame: totalMoves / totalGames,
    avgPassesPerGame: totalPasses / totalGames,
    blowoutRate30Plus: (blowoutCount / totalGames) * 100,
  };
}

const TIER_LADDER: Array<[BotDifficulty, BotDifficulty]> = [
  ['casual', 'standard'],
  ['casual', 'hard'],
  ['standard', 'hard'],
  ['hard', 'master'],
  ['casual', 'master'],
];

const DAILY_FRITZ_PROXY: Array<[BotDifficulty, BotDifficulty]> = [
  ['hard', 'casual'],
  ['hard', 'standard'],
];

export interface TierLadderReport {
  generatedAt: string;
  seeds: number;
  skunkThreshold: number;
  winningScore: number;
  ladder: PairedTierStats[];
  dailyFritzProxy: PairedTierStats[];
}

export function runTierLadderSuite(numSeeds: number): TierLadderReport {
  const ladder = TIER_LADDER.map(([a, b]) => {
    const t0 = Date.now();
    console.error(`[benchmark] ${a} vs ${b} (${numSeeds} seeds)…`);
    const row = runPairedTierBenchmark(numSeeds, a, b);
    console.error(`[benchmark] ${a} vs ${b} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return row;
  });
  const dailyFritzProxy = DAILY_FRITZ_PROXY.map(([a, b]) => {
    const t0 = Date.now();
    console.error(`[benchmark] DF proxy ${a} vs ${b} (${numSeeds} seeds)…`);
    const row = runPairedTierBenchmark(numSeeds, a, b, `DF proxy: ${a} vs ${b}`);
    console.error(`[benchmark] DF proxy done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return row;
  });
  return {
    generatedAt: new Date().toISOString(),
    seeds: numSeeds,
    skunkThreshold: SKUNK_THRESHOLD,
    winningScore: WINNING_SCORE,
    ladder,
    dailyFritzProxy,
  };
}

function formatStatsRow(s: PairedTierStats): string {
  return [
    `| ${s.label} | ${s.tierA} | ${s.tierB} | ${s.seeds} | ${s.totalGames} |`,
    ` ${s.tierAWinRate.toFixed(1)}% | ${s.avgMarginTierA.toFixed(1)} | ${s.medianMarginTierA.toFixed(1)} |`,
    ` ${s.skunkRate.toFixed(1)}% | ${s.avgHandsPerGame.toFixed(2)} | ${s.avgMovesPerGame.toFixed(0)} |`,
    ` ${s.blowoutRate30Plus.toFixed(1)}% |`,
  ].join('');
}

function printReport(report: TierLadderReport): void {
  console.log('\n=== Fritz Tier Ladder Simulation ===');
  console.log(`Seeds per pairing: ${report.seeds} (${report.seeds * 2} games per row)`);
  console.log(`Race to ${report.winningScore}; skunk proxy: loser < ${report.skunkThreshold}\n`);
  console.log(
    '| Matchup | Tier A | Tier B | Seeds | Games | A win% | Avg |A margin| | Med |A margin| | Skunk% | Avg hands | Avg moves | Margin≥30% |',
  );
  console.log(
    '|---------|--------|--------|-------|-------|--------|----------------|----------------|--------|-----------|-----------|------------|',
  );
  for (const s of [...report.ladder, ...report.dailyFritzProxy]) {
    console.log(formatStatsRow(s));
  }
  console.log('\nJSON:');
  console.log(JSON.stringify(report, null, 2));
}

declare const process: { argv: string[] };

const mode = process.argv[2] ?? 'ladder';
const seeds = process.argv[3] ? parseInt(process.argv[3], 10) : 200;

if (mode === 'ladder') {
  const report = runTierLadderSuite(seeds);
  printReport(report);
} else if (mode === 'ladder-json') {
  const outPath = process.argv[4] ?? '../docs/fritz-tier-benchmark-200.json';
  const report = runTierLadderSuite(seeds);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
} else if (mode === 'pair') {
  const diffA = (process.argv[3] as BotDifficulty) || 'hard';
  const diffB = (process.argv[4] as BotDifficulty) || 'casual';
  const n = process.argv[5] ? parseInt(process.argv[5], 10) : 200;
  const stats = runPairedTierBenchmark(n, diffA, diffB);
  printReport({
    generatedAt: new Date().toISOString(),
    seeds: n,
    skunkThreshold: SKUNK_THRESHOLD,
    winningScore: WINNING_SCORE,
    ladder: [stats],
    dailyFritzProxy: [],
  });
} else {
  console.error('Usage: benchmark.ts ladder [seeds] | ladder-json [seeds] [outPath] | pair <tierA> <tierB> [seeds]');
  process.exit(1);
}
