import { chooseBotMove, toBotVisibleState, type BotDifficulty } from '../bot/botHeuristics.ts';
import { previewPlayMove, type BotMatchState } from '../bot/botEngine.ts';

function mk(
  left: number,
  right: number,
  botHand: { low: number; high: number }[],
  youHand: { low: number; high: number }[],
  scores: [number, number] = [48, 52],
): BotMatchState {
  return {
    players: { bot: { hand: botHand, score: scores[0] }, you: { hand: youHand, score: scores[1] } },
    board: {
      mainLine: [
        {
          tile: { low: Math.min(left, right), high: Math.max(left, right) },
          orientation: 'horizontal-normal',
        },
      ],
      leftEnd: left,
      rightEnd: right,
      leftEndIsDouble: left === right,
      rightEndIsDouble: left === right,
      hubDoubles: [],
    },
    boneyard: [
      { low: 0, high: 1 },
      { low: 2, high: 3 },
      { low: 4, high: 5 },
      { low: 1, high: 2 },
    ],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handNumber: 4,
    turnIndex: 20,
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
}

function describe(state: BotMatchState, d: BotDifficulty) {
  const vis = toBotVisibleState(state);
  const c = chooseBotMove(vis, d);
  if (!c?.move?.tile) return { tier: d, move: 'none' };
  const imm = previewPlayMove(state, 'bot', c.move)?.immediateScore ?? 0;
  return {
    tier: d,
    move: `${c.move.tile.low}-${c.move.tile.high}@${c.move.position}`,
    immediate: imm,
    explanation: c.explanation,
  };
}

const fixtures = [
  {
    name: 'endgame-exit (tierDifficulty)',
    state: mk(1, 4, [{ low: 1, high: 1 }, { low: 1, high: 4 }], [{ low: 2, high: 2 }, { low: 0, high: 0 }]),
  },
  {
    name: 'refill-pressure (tierDifficulty)',
    state: mk(
      1,
      4,
      [
        { low: 1, high: 4 },
        { low: 2, high: 4 },
        { low: 1, high: 3 },
        { low: 0, high: 4 },
        { low: 3, high: 3 },
        { low: 3, high: 5 },
      ],
      [
        { low: 2, high: 6 },
        { low: 3, high: 6 },
        { low: 3, high: 4 },
        { low: 2, high: 2 },
        { low: 0, high: 5 },
        { low: 0, high: 6 },
      ],
      [55, 58],
    ),
  },
  {
    name: 'human-near-win defense',
    state: mk(2, 5, [{ low: 2, high: 5 }, { low: 5, high: 5 }], [{ low: 1, high: 3 }, { low: 3, high: 3 }], [52, 57]),
  },
];

for (const f of fixtures) {
  console.log(`\n=== ${f.name} ===`);
  for (const d of ['casual', 'standard', 'hard', 'master'] as BotDifficulty[]) {
    console.log(JSON.stringify(describe(f.state, d)));
  }
}
