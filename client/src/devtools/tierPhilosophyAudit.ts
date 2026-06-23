/**
 * Tier philosophy audit — decision overlap + head-to-head (audit-only).
 * Run: npx ts-node --esm src/devtools/tierPhilosophyAudit.ts [stateSampleCount] [matchSeeds]
 */
import {
  applyPlayMove,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  type BotMatchState,
  type BotPlayerId,
} from '../bot/botEngine.ts';
import {
  chooseBotMove,
  toBotVisibleState,
  type BotDifficulty,
  type BotChoice,
} from '../bot/botHeuristics.ts';
import type { Tile } from '../types.ts';

function runPairedH2H(
  numSeeds: number,
  tierA: BotDifficulty,
  tierB: BotDifficulty,
  label: string,
) {
  let aWins = 0;
  const margins: number[] = [];
  let skunks = 0;
  let hands = 0;
  let blowouts = 0;
  const runOne = (seed: number, a: BotDifficulty, b: BotDifficulty, aIsBot: boolean) => {
    const rng = createRNG(seed);
    const deck = seededShuffle(FULL_DECK, rng);
    let state: BotMatchState = {
      players: { you: { hand: deck.slice(7, 14), score: 0 }, bot: { hand: deck.slice(0, 7), score: 0 } },
      board: null,
      boneyard: deck.slice(14),
      deadTiles: deck.slice(26),
      handOpen: false,
      currentPlayer: 'bot',
      consecutivePasses: 0,
      handNumber: 1,
      turnIndex: 0,
      handOver: false,
      gameOver: false,
      winnerId: null,
      winningScore: 60,
      lastHandWinner: null,
      lastHandReason: null,
      dealSize: 7,
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
      opponentMissingEvidence: [],
    };
    const diff: Record<BotPlayerId, BotDifficulty> = {
      bot: aIsBot ? a : b,
      you: aIsBot ? b : a,
    };
    let hp = 0;
    while (!state.gameOver) {
      if (state.handOver) {
        hp++;
        const hn = state.handNumber + 1;
        const hd = seededShuffle(FULL_DECK, rng);
        const sc = { you: state.players.you.score, bot: state.players.bot.score };
        state = {
          ...state,
          players: { you: { hand: hd.slice(0, 7), score: sc.you }, bot: { hand: hd.slice(7, 14), score: sc.bot } },
          board: null,
          boneyard: hd.slice(14),
          deadTiles: hd.slice(26),
          handOpen: false,
          currentPlayer: hn % 2 === 1 ? 'you' : 'bot',
          consecutivePasses: 0,
          handNumber: hn,
          turnIndex: 0,
          handOver: false,
          opponentPassedOnEnds: [],
          opponentKnownMissing: [],
          opponentMissingEvidence: [],
        };
        continue;
      }
      const p = state.currentPlayer;
      const moves = getLegalMoves(state, p);
      if (moves.length === 0 || (moves.length === 1 && moves[0].type === 'pass')) {
        state = drawUntilPlayableOrEmpty(state, p).state;
        continue;
      }
      const vis = p === 'bot' ? toBotVisibleState(state) : toBotVisibleState({
        ...state,
        players: { bot: state.players.you, you: state.players.bot },
        currentPlayer: 'bot',
      } as BotMatchState);
      const c = chooseBotMove(vis, diff[p]);
      state = c ? applyPlayMove(state, p, c.move).state : drawUntilPlayableOrEmpty(state, p).state;
    }
    const botWon = state.winnerId === 'bot';
    const aWon = aIsBot ? botWon : !botWon;
    const margin = Math.abs(state.players.bot.score - state.players.you.score);
    return { aWon, margin, hands: hp, skunk: Math.min(state.players.bot.score, state.players.you.score) < 30 };
  };
  for (let s = 1; s <= numSeeds; s++) {
    for (const aIsBot of [true, false]) {
      const r = runOne(s, tierA, tierB, aIsBot);
      if (r.aWon) aWins++;
      margins.push(r.margin);
      if (r.skunk) skunks++;
      hands += r.hands;
      if (r.margin >= 30) blowouts++;
    }
  }
  const games = numSeeds * 2;
  return {
    label,
    tierA,
    tierB,
    games,
    aWinPct: (aWins / games) * 100,
    avgMargin: margins.reduce((x, y) => x + y, 0) / games,
    skunkPct: (skunks / games) * 100,
    avgHands: hands / games,
    blowout30Pct: (blowouts / games) * 100,
  };
}

const TIERS: BotDifficulty[] = ['casual', 'standard', 'hard', 'master'];
const TIER_LABEL: Record<BotDifficulty, string> = {
  casual: 'Rookie',
  standard: 'Standard',
  hard: 'Elite',
  master: 'Master',
};

function moveKey(m: { type: string; tile?: Tile | null; position?: string }): string {
  if (m.type !== 'play' || !m.tile) return m.type;
  return `${m.tile.low}-${m.tile.high}@${m.position ?? 'open'}`;
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

const FULL_DECK: Tile[] = [];
for (let h = 0; h <= 6; h++) for (let l = 0; l <= h; l++) FULL_DECK.push({ low: l, high: h });

function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface SampledState {
  state: BotMatchState;
  label: string;
  totalTiles: number;
  botScore: number;
  youScore: number;
  isEndgame: boolean;
  humanNearWin: boolean;
  fritzNearWin: boolean;
}

function collectStatesFromMatch(seed: number): SampledState[] {
  const rng = createRNG(seed);
  const deck = seededShuffle(FULL_DECK, rng);
  let state: BotMatchState = {
    players: {
      you: { hand: deck.slice(0, 7), score: 0 },
      bot: { hand: deck.slice(7, 14), score: 0 },
    },
    board: null,
    boneyard: deck.slice(14),
    deadTiles: deck.slice(26),
    handOpen: false,
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };

  const samples: SampledState[] = [];
  let steps = 0;
  const maxSteps = 400;

  while (!state.gameOver && steps < maxSteps) {
    steps++;
    if (state.handOver) {
      const hn = state.handNumber + 1;
      const hd = seededShuffle(FULL_DECK, rng);
      const sc = { you: state.players.you.score, bot: state.players.bot.score };
      state = {
        ...state,
        players: {
          you: { hand: hd.slice(0, 7), score: sc.you },
          bot: { hand: hd.slice(7, 14), score: sc.bot },
        },
        board: null,
        boneyard: hd.slice(14),
        deadTiles: hd.slice(26),
        handOpen: false,
        currentPlayer: hn % 2 === 1 ? 'you' : 'bot',
        consecutivePasses: 0,
        handNumber: hn,
        turnIndex: 0,
        handOver: false,
        opponentPassedOnEnds: [],
        opponentKnownMissing: [],
        opponentMissingEvidence: [],
      };
      continue;
    }

    if (state.currentPlayer !== 'bot') {
      const moves = getLegalMoves(state, 'you');
      if (moves.length === 0 || (moves.length === 1 && moves[0].type === 'pass')) {
        state = drawUntilPlayableOrEmpty(state, 'you').state;
      } else {
        const vis = toBotVisibleState({
          ...state,
          players: { bot: state.players.you, you: state.players.bot },
          currentPlayer: 'bot',
        });
        const c = chooseBotMove(vis, 'standard');
        if (c) state = applyPlayMove(state, 'you', c.move).state;
        else state = drawUntilPlayableOrEmpty(state, 'you').state;
      }
      continue;
    }

    const playMoves = getLegalMoves(state, 'bot').filter((m) => m.type === 'play');
    if (playMoves.length > 0) {
      const totalTiles = state.players.bot.hand.length + state.players.you.hand.length;
      samples.push({
        state: structuredClone(state) as BotMatchState,
        label: `seed${seed}-h${state.handNumber}-t${state.turnIndex}`,
        totalTiles,
        botScore: state.players.bot.score,
        youScore: state.players.you.score,
        isEndgame: totalTiles <= 12,
        humanNearWin: state.players.you.score >= 50,
        fritzNearWin: state.players.bot.score >= 50,
      });
    }

    const vis = toBotVisibleState(state);
    const c = chooseBotMove(vis, 'hard');
    if (c) state = applyPlayMove(state, 'bot', c.move).state;
    else state = drawUntilPlayableOrEmpty(state, 'bot').state;
  }
  return samples;
}

type PairKey = string;

function compareTiersOnStates(states: SampledState[]) {
  const pairs: Array<[BotDifficulty, BotDifficulty]> = [
    ['casual', 'standard'],
    ['standard', 'hard'],
    ['hard', 'master'],
    ['standard', 'master'],
  ];

  const stats: Record<
    PairKey,
    {
      a: BotDifficulty;
      b: BotDifficulty;
      total: number;
      sameMove: number;
      sameScoringMove: number;
      endgameTotal: number;
      endgameSame: number;
      nearWinTotal: number;
      nearWinSame: number;
      scoreDeltas: number[];
    }
  > = {};

  for (const [a, b] of pairs) {
    stats[`${a}|${b}`] = {
      a,
      b,
      total: 0,
      sameMove: 0,
      sameScoringMove: 0,
      endgameTotal: 0,
      endgameSame: 0,
      nearWinTotal: 0,
      nearWinSame: 0,
      scoreDeltas: [],
    };
  }

  const divergentExamples: Array<{
    label: string;
    tierA: BotDifficulty;
    tierB: BotDifficulty;
    moveA: string;
    moveB: string;
    immA: number;
    immB: number;
    botScore: number;
    youScore: number;
    totalTiles: number;
    explainA?: string;
    explainB?: string;
  }> = [];

  for (const s of states) {
    const vis = toBotVisibleState(s.state);
    const choices: Partial<Record<BotDifficulty, BotChoice | null>> = {};
    for (const t of TIERS) {
      choices[t] = chooseBotMove(vis, t);
    }

    for (const [a, b] of pairs) {
      const ca = choices[a];
      const cb = choices[b];
      if (!ca?.move || !cb?.move) continue;
      const st = stats[`${a}|${b}`];
      st.total++;
      const same = moveKey(ca.move) === moveKey(cb.move);
      if (same) st.sameMove++;
      const immA = ca.breakdown.immediate;
      const immB = cb.breakdown.immediate;
      if (immA === immB && immA > 0) st.sameScoringMove++;
      st.scoreDeltas.push(Math.abs(ca.score - cb.score));

      if (s.isEndgame) {
        st.endgameTotal++;
        if (same) st.endgameSame++;
      }
      if (s.humanNearWin || s.fritzNearWin) {
        st.nearWinTotal++;
        if (same) st.nearWinSame++;
      }

      if (!same && divergentExamples.length < 40) {
        const isInteresting = s.isEndgame || s.humanNearWin || s.fritzNearWin || immA !== immB;
        if (isInteresting) {
          divergentExamples.push({
            label: s.label,
            tierA: a,
            tierB: b,
            moveA: moveKey(ca.move),
            moveB: moveKey(cb.move),
            immA,
            immB,
            botScore: s.botScore,
            youScore: s.youScore,
            totalTiles: s.totalTiles,
            explainA: ca.explanation,
            explainB: cb.explanation,
          });
        }
      }
    }
  }

  return { stats, divergentExamples };
}

declare const process: { argv: string[] };

const stateSamples = parseInt(process.argv[2] ?? '80', 10);
const matchSeeds = parseInt(process.argv[3] ?? '150', 10);

console.error(`[tierPhilosophy] collecting states from ${stateSamples} matches…`);
const allStates: SampledState[] = [];
for (let s = 1; s <= stateSamples; s++) {
  allStates.push(...collectStatesFromMatch(s));
  if (s % 20 === 0) console.error(`[tierPhilosophy] collected ${allStates.length} bot-turn states…`);
}

const MAX_OVERLAP_STATES = 500;
const overlapPool =
  allStates.length <= MAX_OVERLAP_STATES
    ? allStates
    : allStates.filter((_, i) => i % Math.ceil(allStates.length / MAX_OVERLAP_STATES) === 0).slice(0, MAX_OVERLAP_STATES);
console.error(`[tierPhilosophy] overlap on ${overlapPool.length} states (of ${allStates.length})…`);
const { stats, divergentExamples } = compareTiersOnStates(overlapPool);

console.error(`[tierPhilosophy] running head-to-head (${matchSeeds} seeds)…`);
const h2h = [
  runPairedH2H(matchSeeds, 'casual', 'standard', 'Rookie vs Standard'),
  runPairedH2H(matchSeeds, 'standard', 'hard', 'Standard vs Elite'),
  runPairedH2H(Math.min(matchSeeds, 80), 'hard', 'master', 'Elite vs Master'),
  runPairedH2H(Math.min(matchSeeds, 80), 'standard', 'master', 'Standard vs Master'),
  runPairedH2H(Math.min(matchSeeds, 100), 'hard', 'hard', 'Elite vs Elite control'),
  runPairedH2H(Math.min(matchSeeds, 60), 'master', 'master', 'Master vs Master control'),
];

const overlapReport = Object.values(stats).map((st) => ({
  pair: `${TIER_LABEL[st.a]} vs ${TIER_LABEL[st.b]}`,
  states: st.total,
  sameMovePct: st.total ? (st.sameMove / st.total) * 100 : 0,
  sameScoringMovePct: st.total ? (st.sameScoringMove / st.total) * 100 : 0,
  endgameSamePct: st.endgameTotal ? (st.endgameSame / st.endgameTotal) * 100 : null,
  nearWinSamePct: st.nearWinTotal ? (st.nearWinSame / st.nearWinTotal) * 100 : null,
  avgScoreDeltaWhenDiffers: st.scoreDeltas.length
    ? st.scoreDeltas.reduce((a, b) => a + b, 0) / st.scoreDeltas.length
    : 0,
}));

const report = {
  generatedAt: new Date().toISOString(),
  stateSampleMatches: stateSamples,
  botTurnStatesSampled: allStates.length,
  endgameStates: allStates.filter((s) => s.isEndgame).length,
  overlap: overlapReport,
  divergentExamples: divergentExamples.slice(0, 25),
  headToHead: h2h,
};

console.log(JSON.stringify(report, null, 2));
