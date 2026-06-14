/** Quick tier overlap sample — audit only. */
import { getLegalMoves, type BotMatchState } from './botEngine.ts';
import { chooseBotMove, toBotVisibleState, type BotDifficulty } from './botHeuristics.ts';
import type { Tile } from '../types.ts';

const TIERS: BotDifficulty[] = ['casual', 'standard', 'hard', 'master'];
const FULL: Tile[] = [];
for (let h = 0; h <= 6; h++) for (let l = 0; l <= h; l++) FULL.push({ low: l, high: h });

function rng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    const t = Math.imul(s ^ (s >>> 15), 1 | s);
    const u = t + (Math.imul(t ^ (t >>> 7), 61 | t) ^ t);
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(a: readonly T[], r: () => number) {
  const o = [...a];
  for (let i = o.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}
function key(m: { type: string; tile?: Tile | null; position?: string }) {
  return m.type !== 'play' || !m.tile ? m.type : `${m.tile.low}-${m.tile.high}@${m.position}`;
}

// Use fixtures from tierDifficulty + random midgame states
const fixtures: BotMatchState[] = [];

declare const process: { argv: string[] };
const n = parseInt(process.argv[2] ?? '200', 10);
const pairs: Array<[BotDifficulty, BotDifficulty]> = [
  ['casual', 'standard'],
  ['standard', 'hard'],
  ['hard', 'master'],
  ['standard', 'master'],
];
const counts: Record<string, { same: number; total: number; egSame: number; egTotal: number }> = {};
for (const [a, b] of pairs) counts[`${a}|${b}`] = { same: 0, total: 0, egSame: 0, egTotal: 0 };

for (let seed = 1; seed <= n; seed++) {
  const r = rng(seed);
  const d = shuffle(FULL, r);
  const state: BotMatchState = {
    players: { you: { hand: d.slice(0, 7), score: r() * 40 | 0 }, bot: { hand: d.slice(7, 14), score: r() * 40 | 0 } },
    board: {
      mainLine: [{ tile: { low: 2, high: 5 }, orientation: 'horizontal-normal' }],
      leftEnd: 2,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    boneyard: d.slice(14),
    deadTiles: d.slice(26),
    handOpen: true,
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handNumber: (seed % 5) + 1,
    turnIndex: seed,
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
  if (!getLegalMoves(state, 'bot').some((m) => m.type === 'play')) continue;
  const vis = toBotVisibleState(state);
  const picks = Object.fromEntries(TIERS.map((t) => [t, chooseBotMove(vis, t)])) as Record<BotDifficulty, ReturnType<typeof chooseBotMove>>;
  const eg = state.players.bot.hand.length + state.players.you.hand.length <= 12;
  for (const [a, b] of pairs) {
    const ca = picks[a];
    const cb = picks[b];
    if (!ca?.move || !cb?.move) continue;
    const c = counts[`${a}|${b}`];
    c.total++;
    const same = key(ca.move) === key(cb.move);
    if (same) c.same++;
    if (eg) {
      c.egTotal++;
      if (same) c.egSame++;
    }
  }
}
console.log(JSON.stringify(counts, null, 2));
