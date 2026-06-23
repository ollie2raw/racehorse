/**
 * Fritz calibration & perception audit — audit-only, non-production.
 * Run: npx ts-node --esm src/devtools/calibrationAudit.ts [seedsPerRow]
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
import { FRITZ_TIERS, type FritzTier } from '../bot/fritzConfig.ts';
import type { Tile } from '../types.ts';

const WINNING_SCORE = 60;
const TOURNAMENT_SCORE = 30;
const FULL_DECK: Tile[] = [];
for (let high = 0; high <= 6; high++) {
  for (let low = 0; low <= high; low++) {
    FULL_DECK.push({ low, high });
  }
}

const FRITZ_TIER_ORDER: FritzTier[] = ['rookie', 'standard', 'elite', 'master'];

function fritzDifficulty(tier: FritzTier): BotDifficulty {
  return FRITZ_TIERS[tier].difficulty;
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

interface TurnEvent {
  player: BotPlayerId;
  scored: number;
  drew: boolean;
  passed: boolean;
  forcedDrawChain: boolean;
  totalTilesOnBoard: number;
  humanScore: number;
  fritzScore: number;
  handNumber: number;
}

interface MiracleCounters {
  fritzDrawThenScore: number;
  fritzBackToBackScore: number;
  fritzScore3in6Turns: number;
  fritzComebackWin10: number;
  fritzComebackWin15: number;
  fritzComebackWin20: number;
  fritzComebackWin25: number;
  fritzWinsAfterHumanNearWin: number;
  fritzBlocksAndWinsHand: number;
  fritzHighPipBonusHand: number;
  fritzScoresAfterHumanPassDraw: number;
  fritzScoresAfterForcedDrawSeq: number;
  humanDrawThenScore: number;
  humanBackToBackScore: number;
  humanComebackWin15: number;
  humanWinsAfterFritzNearWin: number;
}

interface MatchAudit {
  humanWon: boolean;
  humanSeat: BotPlayerId;
  humanScore: number;
  fritzScore: number;
  margin: number;
  handsPlayed: number;
  humanScoringTurns: number;
  fritzScoringTurns: number;
  humanRacePoints: number;
  fritzRacePoints: number;
  humanPipBonuses: number;
  fritzPipBonuses: number;
  illegalMoves: number;
  humanStartedHand1: boolean;
  humanWonHand1: boolean;
  endgameFritzScoringTurns: number;
  endgameHumanScoringTurns: number;
  endgameTurns: number;
  fritzWonFromEndgameLead: boolean;
  miracles: MiracleCounters;
}

function emptyMiracles(): MiracleCounters {
  return {
    fritzDrawThenScore: 0,
    fritzBackToBackScore: 0,
    fritzScore3in6Turns: 0,
    fritzComebackWin10: 0,
    fritzComebackWin15: 0,
    fritzComebackWin20: 0,
    fritzComebackWin25: 0,
    fritzWinsAfterHumanNearWin: 0,
    fritzBlocksAndWinsHand: 0,
    fritzHighPipBonusHand: 0,
    fritzScoresAfterHumanPassDraw: 0,
    fritzScoresAfterForcedDrawSeq: 0,
    humanDrawThenScore: 0,
    humanBackToBackScore: 0,
    humanComebackWin15: 0,
    humanWinsAfterFritzNearWin: 0,
  };
}

function runMatchAudit(
  seed: number,
  humanDifficulty: BotDifficulty,
  fritzDifficulty: BotDifficulty,
  humanSeat: BotPlayerId,
  winningScore: number,
): MatchAudit {
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
    winningScore,
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

  const audit: MatchAudit = {
    humanWon: false,
    humanSeat,
    humanScore: 0,
    fritzScore: 0,
    margin: 0,
    handsPlayed: 0,
    humanScoringTurns: 0,
    fritzScoringTurns: 0,
    humanRacePoints: 0,
    fritzRacePoints: 0,
    humanPipBonuses: 0,
    fritzPipBonuses: 0,
    illegalMoves: 0,
    humanStartedHand1: state.currentPlayer === humanId,
    humanWonHand1: false,
    endgameFritzScoringTurns: 0,
    endgameHumanScoringTurns: 0,
    endgameTurns: 0,
    fritzWonFromEndgameLead: false,
    miracles: emptyMiracles(),
  };

  const turnLog: TurnEvent[] = [];
  let maxHumanDeficit = 0;
  let maxFritzDeficit = 0;
  let humanWasNearWin = false;
  let fritzWasNearWin = false;
  let lastFritzScored = false;
  let lastHumanScored = false;
  let lastHumanPassedOrDrew = false;
  let lastHumanForcedDraw = false;
  let hand1Resolved = false;

  while (!state.gameOver) {
    const hScore = state.players[humanId].score;
    const fScore = state.players[fritzId].score;
    maxHumanDeficit = Math.max(maxHumanDeficit, fScore - hScore);
    maxFritzDeficit = Math.max(maxFritzDeficit, hScore - fScore);
    if (hScore >= winningScore - 1) humanWasNearWin = true;
    if (fScore >= winningScore - 1) fritzWasNearWin = true;

    if (state.handOver) {
      audit.handsPlayed += 1;
      const winner = state.lastHandWinner;
      const reason = state.lastHandReason;
      if (winner === fritzId && reason === 'blocked') audit.miracles.fritzBlocksAndWinsHand += 1;
      if (winner && reason) {
        const loser = winner === 'you' ? 'bot' : 'you';
        const pipBonus = Math.round(sumPips(state.players[loser].hand) / 5);
        if (winner === humanId) audit.humanPipBonuses += pipBonus;
        else {
          audit.fritzPipBonuses += pipBonus;
          if (pipBonus >= 6) audit.miracles.fritzHighPipBonusHand += 1;
        }
      }
      if (!hand1Resolved) {
        hand1Resolved = true;
        audit.humanWonHand1 = winner === humanId;
      }
      const nextScores = { you: state.players.you.score, bot: state.players.bot.score };
      const handNumber = state.handNumber + 1;
      const handDeck = seededShuffle(FULL_DECK, matchRNG);
      state = {
        ...state,
        players: {
          you: { hand: handDeck.slice(0, 7), score: nextScores.you },
          bot: { hand: handDeck.slice(7, 14), score: nextScores.bot },
        },
        board: null,
        boneyard: handDeck.slice(14),
        deadTiles: handDeck.slice(handDeck.length - 2),
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
      lastFritzScored = false;
      lastHumanScored = false;
      continue;
    }

    const currentPlayer = state.currentPlayer;
    const difficulty = diffMap[currentPlayer];
    const moves = getLegalMoves(state, currentPlayer);
    const totalTiles =
      state.players.you.hand.length + state.players.bot.hand.length;
    const inEndgame = totalTiles <= 6;
    if (inEndgame) audit.endgameTurns += 1;

    const scoreBefore = state.players[currentPlayer].score;
    let drew = false;
    let passed = false;
    let forcedDrawChain = false;

    if (moves.length === 0 || (moves.length === 1 && moves[0].type === 'pass')) {
      const beforeHand = state.players[currentPlayer].hand.length;
      const result = drawUntilPlayableOrEmpty(state, currentPlayer);
      state = result.state;
      drew = Boolean(result.drew);
      if (drew && state.players[currentPlayer].hand.length > beforeHand) {
        forcedDrawChain = true;
      } else if (moves.length === 1 && moves[0].type === 'pass') {
        passed = true;
      }
    } else {
      const visible =
        currentPlayer === 'bot'
          ? toBotVisibleState(state)
          : toBotVisibleState(swapPlayers(state));
      const choice = chooseBotMove(visible, difficulty);
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
        if (!legal) audit.illegalMoves += 1;
        state = applyPlayMove(state, currentPlayer, choice.move).state;
      } else {
        state = drawUntilPlayableOrEmpty(state, currentPlayer).state;
        drew = true;
      }
    }

    const scored = state.players[currentPlayer].score - scoreBefore;
    const evt: TurnEvent = {
      player: currentPlayer,
      scored,
      drew,
      passed,
      forcedDrawChain,
      totalTilesOnBoard: totalTiles,
      humanScore: state.players[humanId].score,
      fritzScore: state.players[fritzId].score,
      handNumber: state.handNumber,
    };
    turnLog.push(evt);

    if (scored > 0) {
      if (currentPlayer === humanId) {
        audit.humanScoringTurns += 1;
        audit.humanRacePoints += scored;
        if (inEndgame) audit.endgameHumanScoringTurns += 1;
        if (lastHumanPassedOrDrew) {
          /* human after pass - n/a for fritz miracle */
        }
        if (lastHumanScored) audit.miracles.humanBackToBackScore += 1;
        lastHumanScored = true;
        lastFritzScored = false;
      } else {
        audit.fritzScoringTurns += 1;
        audit.fritzRacePoints += scored;
        if (inEndgame) audit.endgameFritzScoringTurns += 1;
        const prev = turnLog[turnLog.length - 2];
        if (prev?.player === fritzId && prev.drew) audit.miracles.fritzDrawThenScore += 1;
        if (lastFritzScored) audit.miracles.fritzBackToBackScore += 1;
        if (lastHumanPassedOrDrew) audit.miracles.fritzScoresAfterHumanPassDraw += 1;
        if (lastHumanForcedDraw) audit.miracles.fritzScoresAfterForcedDrawSeq += 1;
        lastFritzScored = true;
        lastHumanScored = false;
      }
    } else {
      if (currentPlayer === humanId) {
        lastHumanPassedOrDrew = drew || passed;
        lastHumanForcedDraw = forcedDrawChain;
        lastHumanScored = false;
      } else {
        lastFritzScored = false;
      }
    }

    const recentFritzScores = turnLog
      .slice(-6)
      .filter((t) => t.player === fritzId && t.scored > 0).length;
    if (recentFritzScores >= 3) audit.miracles.fritzScore3in6Turns += 1;
  }

  audit.humanScore = state.players[humanId].score;
  audit.fritzScore = state.players[fritzId].score;
  audit.humanWon = state.winnerId === humanId;
  audit.margin = Math.abs(audit.humanScore - audit.fritzScore);

  if (!audit.humanWon) {
    if (maxFritzDeficit >= 10) audit.miracles.fritzComebackWin10 += 1;
    if (maxFritzDeficit >= 15) audit.miracles.fritzComebackWin15 += 1;
    if (maxFritzDeficit >= 20) audit.miracles.fritzComebackWin20 += 1;
    if (maxFritzDeficit >= 25) audit.miracles.fritzComebackWin25 += 1;
    if (humanWasNearWin) audit.miracles.fritzWinsAfterHumanNearWin += 1;
  } else {
    if (maxHumanDeficit >= 15) audit.miracles.humanComebackWin15 += 1;
    if (fritzWasNearWin) audit.miracles.humanWinsAfterFritzNearWin += 1;
  }

  if (
    !audit.humanWon &&
    audit.endgameFritzScoringTurns > audit.endgameHumanScoringTurns &&
    audit.endgameTurns >= 4
  ) {
    audit.fritzWonFromEndgameLead = true;
  }

  return audit;
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function rate(count: number, games: number): number {
  return games ? count / games : 0;
}

interface RowSummary {
  label: string;
  humanTier: BotDifficulty;
  fritzTier: BotDifficulty;
  fritzLabel: string;
  games: number;
  humanWinRate: number;
  humanWinRateSeatYou: number;
  humanWinRateSeatBot: number;
  avgMargin: number;
  avgHands: number;
  avgHumanScoringTurns: number;
  avgFritzScoringTurns: number;
  avgHumanRacePts: number;
  avgFritzRacePts: number;
  avgHumanPipBonus: number;
  avgFritzPipBonus: number;
  illegalMoves: number;
  miraclesPerGame: Record<string, number>;
  endgameFritzScoreRate: number;
  humanWonHand1Rate: number;
  humanStartedHand1WinRate: number;
  fritzStartedHand1HumanWinRate: number;
  intendedFeel: string;
  calibrationVerdict: string;
}

function summarizeRow(
  label: string,
  humanTier: BotDifficulty,
  fritzBotTier: BotDifficulty,
  fritzLabel: string,
  matches: MatchAudit[],
  intendedFeel: string,
): RowSummary {
  const games = matches.length;
  const seatYou = matches.filter((m) => m.humanSeat === 'you');
  const seatBot = matches.filter((m) => m.humanSeat === 'bot');
  const humanWins = matches.filter((m) => m.humanWon).length;
  const miracleKeys = Object.keys(matches[0]?.miracles ?? {}) as (keyof MiracleCounters)[];
  const miraclesPerGame: Record<string, number> = {};
  for (const key of miracleKeys) {
    const total = matches.reduce((s, m) => s + m.miracles[key], 0);
    miraclesPerGame[key] = rate(total, games);
  }
  const endgameFritzScores = matches.reduce((s, m) => s + m.endgameFritzScoringTurns, 0);
  const endgameTurns = matches.reduce((s, m) => s + m.endgameTurns, 0);
  const humanWinRate = humanWins / games;

  let calibrationVerdict = 'review';
  if (fritzLabel === 'rookie' && humanWinRate >= 0.55) calibrationVerdict = 'on-target forgiving';
  else if (fritzLabel === 'rookie' && humanWinRate >= 0.45) calibrationVerdict = 'slightly strong for rookie label';
  else if (fritzLabel === 'rookie') calibrationVerdict = 'too strong for rookie label';
  else if (fritzLabel === 'standard' && humanWinRate >= 0.4 && humanWinRate <= 0.55)
    calibrationVerdict = 'balanced casual';
  else if (fritzLabel === 'standard' && humanWinRate < 0.4) calibrationVerdict = 'Fritz favored vs standard human proxy';
  else if (fritzLabel === 'elite' && humanWinRate >= 0.25 && humanWinRate <= 0.4)
    calibrationVerdict = 'strong competitive';
  else if (fritzLabel === 'elite' && humanWinRate < 0.25) calibrationVerdict = 'very punishing for average players';
  else if (fritzLabel === 'master' && humanWinRate <= 0.2) calibrationVerdict = 'brutal but honest';
  else if (fritzLabel === 'master') calibrationVerdict = 'weaker than master label suggests';

  return {
    label,
    humanTier,
    fritzTier: fritzBotTier,
    fritzLabel,
    games,
    humanWinRate,
    humanWinRateSeatYou: seatYou.filter((m) => m.humanWon).length / (seatYou.length || 1),
    humanWinRateSeatBot: seatBot.filter((m) => m.humanWon).length / (seatBot.length || 1),
    avgMargin: avg(matches.map((m) => m.margin)),
    avgHands: avg(matches.map((m) => m.handsPlayed)),
    avgHumanScoringTurns: avg(matches.map((m) => m.humanScoringTurns)),
    avgFritzScoringTurns: avg(matches.map((m) => m.fritzScoringTurns)),
    avgHumanRacePts: avg(matches.map((m) => m.humanRacePoints)),
    avgFritzRacePts: avg(matches.map((m) => m.fritzRacePoints)),
    avgHumanPipBonus: avg(matches.map((m) => m.humanPipBonuses)),
    avgFritzPipBonus: avg(matches.map((m) => m.fritzPipBonuses)),
    illegalMoves: matches.reduce((s, m) => s + m.illegalMoves, 0),
    miraclesPerGame,
    endgameFritzScoreRate: endgameTurns ? endgameFritzScores / endgameTurns : 0,
    humanWonHand1Rate: rate(
      matches.filter((m) => m.humanWonHand1).length,
      games,
    ),
    humanStartedHand1WinRate: rate(
      matches.filter((m) => m.humanStartedHand1 && m.humanWon).length,
      matches.filter((m) => m.humanStartedHand1).length,
    ),
    fritzStartedHand1HumanWinRate: rate(
      matches.filter((m) => !m.humanStartedHand1 && m.humanWon).length,
      matches.filter((m) => !m.humanStartedHand1).length,
    ),
    intendedFeel,
    calibrationVerdict,
  };
}

function runHumanVsFritzMatrix(seeds: number, winningScore: number) {
  const rows: RowSummary[] = [];
  const humanProxy: BotDifficulty = 'standard';

  for (const tier of FRITZ_TIER_ORDER) {
    const fritzD = fritzDifficulty(tier);
    const matches: MatchAudit[] = [];
    for (let s = 1; s <= seeds; s++) {
      matches.push(runMatchAudit(s, humanProxy, fritzD, 'you', winningScore));
      matches.push(runMatchAudit(s, humanProxy, fritzD, 'bot', winningScore));
      if (s % 100 === 0) console.error(`[audit] ${tier} ${s}/${seeds}…`);
    }
    const feels: Record<FritzTier, string> = {
      rookie: 'forgiving / beatable',
      standard: 'balanced casual',
      elite: 'strong competitive',
      master: 'brutal but honest',
    };
    rows.push(
      summarizeRow(
        `Human proxy (${humanProxy}) vs ${tier}`,
        humanProxy,
        fritzD,
        tier,
        matches,
        feels[tier],
      ),
    );
  }

  // Equal-tier controls
  const equalTiers: BotDifficulty[] = ['casual', 'standard', 'hard', 'master'];
  for (const t of equalTiers) {
    const matches: MatchAudit[] = [];
    for (let s = 1; s <= Math.min(seeds, 150); s++) {
      matches.push(runMatchAudit(s + 9000, t, t, 'you', winningScore));
      matches.push(runMatchAudit(s + 9000, t, t, 'bot', winningScore));
    }
    rows.push(
      summarizeRow(`Equal control: ${t} vs ${t}`, t, t, `control-${t}`, matches, 'symmetric variance baseline'),
    );
  }

  return rows;
}

function simulateBestOf3(seeds: number, fritzTier: FritzTier): {
  playerSetWinRate: number;
  brutalLossRate: number;
  nearMissLossRate: number;
  avgGamesPerSet: number;
} {
  const fritzD = fritzDifficulty(fritzTier);
  const humanProxy: BotDifficulty = 'standard';
  let playerSetWins = 0;
  let brutalLosses = 0;
  let nearMiss = 0;
  let totalGames = 0;

  for (let s = 1; s <= seeds; s++) {
    let playerWins = 0;
    let fritzWins = 0;
    let games = 0;
    while (playerWins < 2 && fritzWins < 2 && games < 3) {
      games += 1;
      totalGames += 1;
      const m = runMatchAudit(s * 10 + games, humanProxy, fritzD, 'you', WINNING_SCORE);
      if (m.humanWon) playerWins += 1;
      else fritzWins += 1;
    }
    if (playerWins >= 2) playerSetWins += 1;
    else {
      if (fritzWins === 2 && games === 2) brutalLosses += 1;
      const last = runMatchAudit(s * 10 + 3, humanProxy, fritzD, 'you', WINNING_SCORE);
      if (!last.humanWon && last.humanScore >= WINNING_SCORE - 5) nearMiss += 1;
    }
  }

  return {
    playerSetWinRate: playerSetWins / seeds,
    brutalLossRate: brutalLosses / seeds,
    nearMissLossRate: nearMiss / seeds,
    avgGamesPerSet: totalGames / seeds,
  };
}

function simulateTournamentRace(seeds: number): RowSummary {
  const matches: MatchAudit[] = [];
  const humanProxy: BotDifficulty = 'standard';
  const fritzD: BotDifficulty = 'hard'; // tournament default elite → hard
  for (let s = 1; s <= seeds; s++) {
    matches.push(runMatchAudit(s + 50000, humanProxy, fritzD, 'you', TOURNAMENT_SCORE));
    matches.push(runMatchAudit(s + 50000, humanProxy, fritzD, 'bot', TOURNAMENT_SCORE));
  }
  return summarizeRow(
    `Tournament proxy race-to-${TOURNAMENT_SCORE}`,
    humanProxy,
    fritzD,
    'elite-tournament',
    matches,
    'scheduled tournament human vs Fritz',
  );
}

declare const process: { argv: string[] };

const seeds = parseInt(process.argv[2] ?? '400', 10);
console.error(`[calibrationAudit] seeds=${seeds}…`);

const matrix = runHumanVsFritzMatrix(seeds, WINNING_SCORE);
const dailyFritzBo3 = simulateBestOf3(Math.min(seeds, 300), 'elite');
const tournament = simulateTournamentRace(Math.min(seeds, 250));

const report = {
  generatedAt: new Date().toISOString(),
  seedsPerHumanVsFritzRow: seeds,
  note:
    'Human proxy uses standard-tier bot AI as stand-in for average skilled player; not real humans.',
  difficultyMatrix: matrix,
  dailyFritz: {
    defaultTier: 'elite',
    format: 'best_of_3',
    raceTo: WINNING_SCORE,
  bo3Simulation: dailyFritzBo3,
  },
  tournamentProxy: tournament,
};

console.log(JSON.stringify(report, null, 2));
