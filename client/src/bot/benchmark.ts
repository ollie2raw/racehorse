
import { 
  createBotMatch, 
  getLegalMoves, 
  applyPlayMove, 
  drawUntilPlayableOrEmpty, 
  type BotMatchState, 
  type BotPlayerId,
  type BotDealSize
} from './botEngine.ts';
import { chooseBotMove, type BotDifficulty, type Tile, type Move } from './botHeuristics.ts';

// --- Seeded Random Utilities ---

function createRNG(seed: number) {
  let s = seed;
  return function() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    var t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
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

// --- Seating Swap Utility ---

function swapPlayers(state: BotMatchState): BotMatchState {
  return {
    ...state,
    players: {
      bot: state.players.you,
      you: state.players.bot,
    },
    currentPlayer: state.currentPlayer === 'bot' ? 'you' : 'bot',
    lastHandWinner: state.lastHandWinner === 'bot' ? 'you' : (state.lastHandWinner === 'you' ? 'bot' : null),
    winnerId: state.winnerId === 'bot' ? 'you' : (state.winnerId === 'you' ? 'bot' : null),
    opponentPassedOnEnds: [], 
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

// --- Seeded Match Engine ---

interface MatchResult {
  winner: string;
  margin: number;
  p1Points: number;
  p2Points: number;
  p1Passes: number;
  p2Passes: number;
}

function runSeededMatch(
  seed: number, 
  p1Difficulty: BotDifficulty, 
  p2Difficulty: BotDifficulty
): MatchResult {
  const matchRNG = createRNG(seed);
  const diffMap: Record<BotPlayerId, BotDifficulty> = {
    bot: p1Difficulty,
    you: p2Difficulty,
  };

  const p1Id = 'bot';
  const p2Id = 'you';

  // Seeded initialization for hand 1
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
    currentPlayer: 'bot', // Force bot to start hand 1 for bench symmetry
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };

  let p1Points = 0;
  let p2Points = 0;
  let p1Passes = 0;
  let p2Passes = 0;

  while (!state.gameOver) {
    if (state.handOver) {
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
        if (currentPlayer === p1Id) p1Passes++; else p2Passes++;
      }
      const result = drawUntilPlayableOrEmpty(state, currentPlayer);
      state = result.state;
      continue;
    }

    let botChoice;
    if (currentPlayer === 'bot') {
      botChoice = chooseBotMove(state, difficulty);
    } else {
      const swapped = swapPlayers(state);
      botChoice = chooseBotMove(swapped, difficulty);
    }

    if (botChoice) {
      const points = botChoice.breakdown?.immediate || 0;
      if (currentPlayer === p1Id) p1Points += points; else p2Points += points;
      const result = applyPlayMove(state, currentPlayer, botChoice.move);
      state = result.state;
    } else {
      const result = drawUntilPlayableOrEmpty(state, currentPlayer);
      state = result.state;
    }
  }

  const p1Won = state.winnerId === p1Id;
  const p1Score = state.players[p1Id].score;
  const p2Score = state.players[p2Id].score;

  return {
    winner: p1Won ? 'p1' : 'p2',
    margin: Math.abs(p1Score - p2Score),
    p1Points,
    p2Points,
    p1Passes,
    p2Passes
  };
}

// --- Paired Benchmark Runner ---

async function runPairedBenchmark(numSeeds: number, diffA: BotDifficulty, diffB: BotDifficulty) {
  let aTotalWins = 0;
  let bTotalWins = 0;
  let aTotalPoints = 0;
  let bTotalPoints = 0;
  let aTotalPasses = 0;
  let bTotalPasses = 0;
  let totalMatches = numSeeds * 2;

  console.log(`Starting Seeded Paired Benchmark: ${numSeeds} seeds (${totalMatches} matches)`);
  console.log(`${diffA} vs ${diffB} (P1 vs P2) AND ${diffB} vs ${diffA} (P1 vs P2) for every seed.`);

  for (let s = 1; s <= numSeeds; s++) {
    const res1 = runSeededMatch(s, diffA, diffB);
    const res2 = runSeededMatch(s, diffB, diffA);

    const aWins = (res1.winner === 'p1' ? 1 : 0) + (res2.winner === 'p2' ? 1 : 0);
    aTotalWins += aWins;
    bTotalWins += (2 - aWins);
    
    aTotalPoints += res1.p1Points + res2.p2Points;
    bTotalPoints += res1.p2Points + res2.p1Points;
    
    aTotalPasses += res1.p1Passes + res2.p2Passes;
    bTotalPasses += res1.p2Passes + res2.p1Passes;

    if (s % 10 === 0 || s === numSeeds) {
      const currentWinRate = (aTotalWins / (s * 2) * 100).toFixed(1);
      console.log(`Seeds: ${s}/${numSeeds} | Matches: ${s*2} | ${diffA} Win Rate: ${currentWinRate}%`);
    }
  }

  const winRate = (aTotalWins / totalMatches) * 100;
  const avgAPoints = aTotalPoints / totalMatches;
  const avgBPoints = bTotalPoints / totalMatches;

  console.log(`\n--- PAIRED BENCHMARK RESULTS ---`);
  console.log(`Total Matches: ${totalMatches}`);
  console.log(`Overall ${diffA} Win Rate: ${winRate.toFixed(1)}%`);
  console.log(`Avg ${diffA} Points per Match: ${avgAPoints.toFixed(1)}`);
  console.log(`Avg ${diffB} Points per Match: ${avgBPoints.toFixed(1)}`);
  console.log(`Total Passes: ${diffA} ${aTotalPasses} | ${diffB} ${bTotalPasses}`);

  const stderr = Math.sqrt((winRate/100 * (1 - winRate/100)) / totalMatches);
  const conf95 = 1.96 * stderr * 100;
  console.log(`95% Confidence Interval: ±${conf95.toFixed(1)}%`);
}

// To run via npx tsx benchmark.ts [numSeeds] [diffA] [diffB]
// Note: process is available in node environment used by tsx
declare var process: any;
const seeds = process.argv[2] ? parseInt(process.argv[2]) : 25; 
const diffA = (process.argv[3] as BotDifficulty) || 'master';
const diffB = (process.argv[4] as BotDifficulty) || 'hard';

runPairedBenchmark(seeds, diffA, diffB).catch(console.error);
