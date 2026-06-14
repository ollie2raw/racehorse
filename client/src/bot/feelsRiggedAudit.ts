/**
 * Lightweight "feels rigged" moment audit — audit-only.
 * Run: npx ts-node --esm src/bot/feelsRiggedAudit.ts [seeds]
 */
import {
  applyPlayMove,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  type BotMatchState,
  type BotPlayerId,
} from './botEngine.ts';
import { chooseBotMove, toBotVisibleState, type BotDifficulty } from './botHeuristics.ts';
import type { Tile } from '../types.ts';

const WIN = 60;
const FULL_DECK: Tile[] = [];
for (let h = 0; h <= 6; h++) for (let l = 0; l <= h; l++) FULL_DECK.push({ low: l, high: h });

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
function swap(s: BotMatchState): BotMatchState {
  return {
    ...s,
    players: { bot: s.players.you, you: s.players.bot },
    currentPlayer: s.currentPlayer === 'bot' ? 'you' : 'bot',
    lastHandWinner: s.lastHandWinner === 'bot' ? 'you' : s.lastHandWinner === 'you' ? 'bot' : null,
    winnerId: s.winnerId === 'bot' ? 'you' : s.winnerId === 'you' ? 'bot' : null,
    opponentPassedOnEnds: [],
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

type Counters = Record<string, number>;

function run(seed: number, human: BotDifficulty, fritz: BotDifficulty, seat: BotPlayerId): Counters {
  const R = rng(seed);
  const d = shuffle(FULL_DECK, R);
  let st: BotMatchState = {
    players: { you: { hand: d.slice(0, 7), score: 0 }, bot: { hand: d.slice(7, 14), score: 0 } },
    board: null,
    boneyard: d.slice(14),
    deadTiles: d.slice(26),
    handOpen: false,
    currentPlayer: 'bot',
    consecutivePasses: 0,
    handNumber: 1,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: WIN,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
  const hid: BotPlayerId = seat;
  const fid: BotPlayerId = seat === 'you' ? 'bot' : 'you';
  const diff: Record<BotPlayerId, BotDifficulty> = {
    bot: fid === 'bot' ? fritz : human,
    you: fid === 'you' ? fritz : human,
  };
  const c: Counters = {
    fritzDrawThenScore: 0,
    fritzBackToBack: 0,
    fritzScore3in6: 0,
    humanDrawThenScore: 0,
    humanBackToBack: 0,
    fritzNearWinSteal: 0,
    humanNearWinSteal: 0,
    fritzCb15: 0,
    humanCb15: 0,
    endgameTurns: 0,
    fritzEndgameScores: 0,
    humanEndgameScores: 0,
  };
  const log: { p: BotPlayerId; sc: number; drew: boolean }[] = [];
  let maxHD = 0;
  let maxFD = 0;
  let humanNear = false;
  let fritzNear = false;
  let lastFritzSc = false;
  let lastHumanSc = false;
  let lastFritzDrew = false;
  let lastHumanDrew = false;

  while (!st.gameOver) {
    const hs = st.players[hid].score;
    const fs = st.players[fid].score;
    maxHD = Math.max(maxHD, fs - hs);
    maxFD = Math.max(maxFD, hs - fs);
    if (hs >= WIN - 1) humanNear = true;
    if (fs >= WIN - 1) fritzNear = true;
    if (st.handOver) {
      const n = st.handNumber + 1;
      const hd = shuffle(FULL_DECK, R);
      const sc = { you: st.players.you.score, bot: st.players.bot.score };
      st = {
        ...st,
        players: { you: { hand: hd.slice(0, 7), score: sc.you }, bot: { hand: hd.slice(7, 14), score: sc.bot } },
        board: null,
        boneyard: hd.slice(14),
        deadTiles: hd.slice(26),
        handOpen: false,
        currentPlayer: n % 2 === 1 ? 'you' : 'bot',
        consecutivePasses: 0,
        handNumber: n,
        turnIndex: 0,
        handOver: false,
        opponentPassedOnEnds: [],
        opponentKnownMissing: [],
        opponentMissingEvidence: [],
      };
      lastFritzSc = lastHumanSc = lastFritzDrew = lastHumanDrew = false;
      continue;
    }
    const p = st.currentPlayer;
    const tiles = st.players.you.hand.length + st.players.bot.hand.length;
    const eg = tiles <= 6;
    if (eg) c.endgameTurns++;
    const before = st.players[p].score;
    const moves = getLegalMoves(st, p);
    let drew = false;
    if (moves.length === 0 || (moves.length === 1 && moves[0].type === 'pass')) {
      const r = drawUntilPlayableOrEmpty(st, p);
      st = r.state;
      drew = Boolean(r.drew);
    } else {
      const vis = p === 'bot' ? toBotVisibleState(st) : toBotVisibleState(swap(st));
      const ch = chooseBotMove(vis, diff[p]);
      st = ch ? applyPlayMove(st, p, ch.move).state : drawUntilPlayableOrEmpty(st, p).state;
      drew = !ch;
    }
    const sc = st.players[p].score - before;
    log.push({ p, sc, drew });
    if (sc > 0) {
      if (p === fid) {
        if (lastFritzDrew) c.fritzDrawThenScore++;
        if (lastFritzSc) c.fritzBackToBack++;
        if (eg) c.fritzEndgameScores++;
        lastFritzSc = true;
        lastHumanSc = false;
      } else {
        if (lastHumanDrew) c.humanDrawThenScore++;
        if (lastHumanSc) c.humanBackToBack++;
        if (eg) c.humanEndgameScores++;
        lastHumanSc = true;
        lastFritzSc = false;
      }
      const f6 = log.slice(-6).filter((x) => x.p === fid && x.sc > 0).length;
      if (f6 >= 3) c.fritzScore3in6++;
    } else {
      if (p === fid) {
        lastFritzDrew = drew;
        lastFritzSc = false;
      } else {
        lastHumanDrew = drew;
        lastHumanSc = false;
      }
    }
  }
  if (st.winnerId === fid) {
    if (maxFD >= 15) c.fritzCb15++;
    if (humanNear) c.fritzNearWinSteal++;
  } else {
    if (maxHD >= 15) c.humanCb15++;
    if (fritzNear) c.humanNearWinSteal++;
  }
  return c;
}

declare const process: { argv: string[] };
const seeds = parseInt(process.argv[2] ?? '250', 10);
const scenarios: Array<{ label: string; human: BotDifficulty; fritz: BotDifficulty }> = [
  { label: 'standard vs elite (Daily Fritz proxy)', human: 'standard', fritz: 'hard' },
  { label: 'hard vs hard (symmetric control)', human: 'hard', fritz: 'hard' },
  { label: 'standard vs standard (symmetric control)', human: 'standard', fritz: 'standard' },
];

const out: Record<string, unknown> = { seeds, scenarios: [] as unknown[] };
for (const sc of scenarios) {
  const totals: Counters = {};
  let games = 0;
  for (let s = 1; s <= seeds; s++) {
    for (const seat of ['you', 'bot'] as BotPlayerId[]) {
      games++;
      const r = run(s, sc.human, sc.fritz, seat);
      for (const [k, v] of Object.entries(r)) totals[k] = (totals[k] ?? 0) + v;
    }
    if (s % 50 === 0) console.error(`[feelsRigged] ${sc.label} ${s}/${seeds}`);
  }
  const perGame: Record<string, number> = {};
  for (const [k, v] of Object.entries(totals)) perGame[k] = v / games;
  (out.scenarios as unknown[]).push({ ...sc, games, perGame });
}
console.log(JSON.stringify(out, null, 2));
