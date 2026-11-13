/**
 * Self-play corpus generator (devtools only; nothing here is imported by the app).
 *
 * One record per DECISION of EVERY seat: public-information features at decision time plus outcomes joined after the
 * hand and the game finish. It exists to calibrate a win-probability loss and to train a learned leaf value later; it
 * trains nothing. Bot play only: the policy mix adds epsilon-noise and uniform-random moves so imperfect, human-style
 * choices are covered, and every record says which policy produced the move and whether it was greedy or exploratory.
 *
 * Determinism: a game is a pure function of (seed, shard, gameIndex, mix). Fritz's wall-clock-bounded search is switched
 * to the node budget (searchBudget.ts, #486) and Math.random is replaced by a seeded stream for the length of a game.
 *
 * Features use public information only: nothing here reads the opponent's hand or the boneyard contents. Tile index
 * order: index(low, high) = high * (high + 1) / 2 + low with low <= high, so (0-0)=0, (0-1)=1, (1-1)=2, (0-2)=3 ... (6-6)=27.
 */
import {
  applyPlayMove,
  computeOpenEndsSum,
  drawUntilPlayableOrEmpty,
  getLegalMoves,
  getMatchableOpenEnds,
  passTurn,
  type BotMatchState,
  type BotPlayerId,
} from '../modules/match/runtime/botEngine.ts';
import { chooseBotMove, toBotVisibleState, type BotDifficulty } from '../modules/fritz/botHeuristics.ts';
import { setSearchBudgetMode } from '../modules/fritz/searchBudget.ts';
import { gzipSync } from 'node:zlib';
import type { Move, Tile } from '../types.ts';

export const CORPUS_SCHEMA_VERSION = 1;
export const WINNING_SCORE = 60;
/** The boneyard is locked (nobody may draw) at this many tiles. */
export const BONEYARD_LOCKED = 2;

// ─── Tiles and masks ──────────────────────────────────────────────────────────

export const tileIndex = (tile: Tile): number => {
  const low = Math.min(tile.low, tile.high);
  const high = Math.max(tile.low, tile.high);
  return (high * (high + 1)) / 2 + low;
};

export const tileFromIndex = (index: number): Tile => {
  let high = 0;
  while (((high + 1) * (high + 2)) / 2 <= index) high += 1;
  return { low: index - (high * (high + 1)) / 2, high };
};

/** A set of tiles as a 28-bit integer (bit i set = the tile with index i is in the set). */
export const maskFromTiles = (tiles: readonly Tile[]): number => {
  let mask = 0;
  for (const tile of tiles) mask |= 1 << tileIndex(tile);
  return mask >>> 0;
};

export const tilesFromMask = (mask: number): Tile[] => {
  const tiles: Tile[] = [];
  for (let i = 0; i < 28; i++) if (mask & (1 << i)) tiles.push(tileFromIndex(i));
  return tiles;
};

/** A set of pips (0..6) as a 7-bit integer. */
export const pipMask = (pips: Iterable<number>): number => {
  let mask = 0;
  for (const pip of pips) mask |= 1 << pip;
  return mask;
};

const boardTiles = (state: BotMatchState): Tile[] => {
  const board = state.board;
  if (!board) return [];
  const tiles: Tile[] = board.mainLine.map((placed) => placed.tile);
  // Branch arms (off hub doubles, including nested ones) hold tiles too.
  for (const hub of board.hubDoubles) {
    for (const arm of hub.branches) {
      if (arm) for (const placed of arm.tiles) tiles.push(placed.tile);
    }
  }
  return tiles;
};

// ─── Seeded randomness ────────────────────────────────────────────────────────

export function hashSeed(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FULL_SET: Tile[] = [];
for (let high = 0; high <= 6; high++) for (let low = 0; low <= high; low++) FULL_SET.push({ low, high });

function shuffled(rng: () => number): Tile[] {
  const out = [...FULL_SET];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Policies ─────────────────────────────────────────────────────────────────

export type PolicyId =
  | 'fritz-master'
  | 'fritz-hard'
  | 'fritz-standard'
  | 'fritz-casual'
  | 'eps0.1-master'
  | 'eps0.3-standard'
  | 'uniform-random';

interface PolicySpec {
  readonly id: PolicyId;
  readonly tier: BotDifficulty | null;
  /** Probability of replacing the tier's move with a uniform random legal play. 1 = always random. */
  readonly epsilon: number;
}

export const POLICIES: Readonly<Record<PolicyId, PolicySpec>> = {
  'fritz-master': { id: 'fritz-master', tier: 'master', epsilon: 0 },
  'fritz-hard': { id: 'fritz-hard', tier: 'hard', epsilon: 0 },
  'fritz-standard': { id: 'fritz-standard', tier: 'standard', epsilon: 0 },
  'fritz-casual': { id: 'fritz-casual', tier: 'casual', epsilon: 0 },
  'eps0.1-master': { id: 'eps0.1-master', tier: 'master', epsilon: 0.1 },
  'eps0.3-standard': { id: 'eps0.3-standard', tier: 'standard', epsilon: 0.3 },
  'uniform-random': { id: 'uniform-random', tier: null, epsilon: 1 },
};

/** Percent of seat-games assigned to each policy. Each seat of each game is drawn independently, so seats vary. */
export type PolicyMix = Readonly<Partial<Record<PolicyId, number>>>;

export const DEFAULT_MIX: PolicyMix = {
  'fritz-master': 30,
  'fritz-hard': 20,
  'fritz-standard': 15,
  'fritz-casual': 10,
  'eps0.1-master': 10,
  'eps0.3-standard': 10,
  'uniform-random': 5,
};

function drawPolicy(mix: PolicyMix, rng: () => number): PolicyId {
  const entries = Object.entries(mix) as Array<[PolicyId, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = rng() * total;
  for (const [id, weight] of entries) {
    pick -= weight;
    if (pick < 0) return id;
  }
  return entries[entries.length - 1]![0];
}

// ─── Public evidence tracker ──────────────────────────────────────────────────

/**
 * What a seat has publicly shown it lacks, per hand. `passMask` is permanent for the hand (a player only passes when
 * nothing can be drawn, so its hand is final). `drawMask` is provisional: it was true at the start of a draw, and the
 * drawn tiles may have refilled it, so treat it as a hint.
 */
export interface SeatEvidence {
  passMask: number;
  drawMask: number;
  drawCount: number;
}

export interface PublicTracker {
  you: SeatEvidence;
  bot: SeatEvidence;
}

export const emptyTracker = (): PublicTracker => ({
  you: { passMask: 0, drawMask: 0, drawCount: 0 },
  bot: { passMask: 0, drawMask: 0, drawCount: 0 },
});

const other = (seat: BotPlayerId): BotPlayerId => (seat === 'you' ? 'bot' : 'you');

// ─── Features ─────────────────────────────────────────────────────────────────

export interface DecisionFeatures {
  /** The acting seat's hand, a 28-bit mask in the tile index order above. */
  ownHandMask: number;
  /** Tiles on the board (public), 28-bit mask. The unseen pool is everything else: opponent hand plus boneyard. */
  playedMask: number;
  /** Pips playable on, one entry per open end (matchable value), sorted ascending. */
  openEndPips: number[];
  numEnds: number;
  /** Canonical scoring sum of the open ends (doubles counted as scored). */
  openSum: number;
  openSumMod5: number;
  hubDoubles: number;
  mainLineLength: number;
  ownScore: number;
  oppScore: number;
  oppTileCount: number;
  boneyardCount: number;
  legalActionCount: number;
  /** 1 when the acting seat opened this hand. */
  handStarterIsSelf: 0 | 1;
  /** Pips the opponent passed on this hand (permanent), 7-bit mask. */
  oppAbsentPassMask: number;
  /** Pips the opponent lacked when it last drew this hand (provisional), 7-bit mask. */
  oppAbsentDrawMask: number;
  oppDrawCount: number;
  ownDrawCount: number;
}

/**
 * Public-information features for `seat` choosing among `legalPlays` in `state`. The opponent's hand and the boneyard
 * contents are never read (only their sizes); the test checks that permuting them changes nothing.
 */
export function extractFeatures(
  state: BotMatchState,
  seat: BotPlayerId,
  tracker: PublicTracker,
  legalPlayCount: number,
  handStarter: BotPlayerId,
): DecisionFeatures {
  const opp = other(seat);
  const ends = state.board ? getMatchableOpenEnds(state.board).map((e) => e.matchValue) : [];
  const openSum = state.board ? computeOpenEndsSum(state.board) : 0;
  return {
    ownHandMask: maskFromTiles(state.players[seat].hand),
    playedMask: maskFromTiles(boardTiles(state)),
    openEndPips: [...ends].sort((a, b) => a - b),
    numEnds: ends.length,
    openSum,
    openSumMod5: openSum % (state.scoringMultiple ?? 5),
    hubDoubles: state.board?.hubDoubles.length ?? 0,
    mainLineLength: state.board?.mainLine.length ?? 0,
    ownScore: state.players[seat].score,
    oppScore: state.players[opp].score,
    oppTileCount: state.players[opp].hand.length,
    boneyardCount: state.boneyard.length,
    legalActionCount: legalPlayCount,
    handStarterIsSelf: handStarter === seat ? 1 : 0,
    oppAbsentPassMask: tracker[opp].passMask,
    oppAbsentDrawMask: tracker[opp].drawMask,
    oppDrawCount: tracker[opp].drawCount,
    ownDrawCount: tracker[seat].drawCount,
  };
}

// ─── Records ──────────────────────────────────────────────────────────────────

export interface DecisionRecord {
  decisionId: string;
  gameId: string;
  hand: number;
  /** Ordinal of this decision within the game (0-based, both seats). */
  seq: number;
  /** 0 = the engine's 'you' seat, 1 = 'bot'. Both are played by policies here. */
  seat: 0 | 1;
  policy: PolicyId;
  /** 'forced' = exactly one legal play; 'greedy' = the policy's own choice; 'explore' = an epsilon/uniform move. */
  moveSource: 'forced' | 'greedy' | 'explore';
  move: { tile: number; position: string };
  /** Number of tiles the acting seat drew since its previous decision (it could not play). */
  drewBefore: number;
  /** 0 when the previous decision was the opponent's; k when this seat is continuing a turn (double/score) k decisions deep. */
  chainIndex: number;
  features: DecisionFeatures;
  /** Joined after the hand ends. */
  outcome: {
    /** Points the acting seat scored from this decision to the end of the hand (including the end-of-hand award). */
    ptsSelfToHandEnd: number;
    ptsOppToHandEnd: number;
    /** End-of-hand score differential (self - opponent) minus the differential at decision time. */
    handEndDiffDelta: number;
    /** 1 the acting seat won the hand, 0 it lost, -1 no winner (blocked tie). */
    wonHand: 1 | 0 | -1;
    handEndReason: 'domino' | 'blocked' | null;
    /** Joined after the game: 1 the acting seat won the game. */
    wonGame: 0 | 1;
    /** Final game score, self minus opponent. */
    finalMargin: number;
    gameHands: number;
  };
}

export interface GameResult {
  gameId: string;
  seeds: { game: number };
  policies: [PolicyId, PolicyId];
  hands: number;
  finalScores: [number, number];
  decisions: DecisionRecord[];
}

const seatIndex = (seat: BotPlayerId): 0 | 1 => (seat === 'you' ? 0 : 1);

// ─── Playing a game ───────────────────────────────────────────────────────────

export function dealCorpusHand(rng: () => number, scores: { you: number; bot: number }, handNumber: number): BotMatchState {
  const deck = shuffled(rng);
  const boneyard = deck.slice(14);
  return {
    players: { you: { hand: deck.slice(0, 7), score: scores.you }, bot: { hand: deck.slice(7, 14), score: scores.bot } },
    board: null,
    boneyard,
    deadTiles: boneyard.slice(boneyard.length - 2),
    handOpen: false,
    currentPlayer: handNumber % 2 === 1 ? 'you' : 'bot',
    consecutivePasses: 0,
    handNumber,
    turnIndex: 0,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: WINNING_SCORE,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    opponentMissingEvidence: [],
  };
}

/** The state as `seat` sees it, so the Fritz policies (which always play the 'bot' seat) can play either side. */
function viewFor(state: BotMatchState, seat: BotPlayerId, tracker: PublicTracker): BotMatchState {
  const opp = other(seat);
  const missing: number[] = [];
  const mask = tracker[opp].passMask | tracker[opp].drawMask;
  for (let pip = 0; pip <= 6; pip++) if (mask & (1 << pip)) missing.push(pip);
  const base: BotMatchState =
    seat === 'bot'
      ? state
      : {
          ...state,
          players: { bot: state.players.you, you: state.players.bot },
          currentPlayer: state.currentPlayer === 'bot' ? 'you' : 'bot',
          lastHandWinner: state.lastHandWinner === 'bot' ? 'you' : state.lastHandWinner === 'you' ? 'bot' : null,
          winnerId: state.winnerId === 'bot' ? 'you' : state.winnerId === 'you' ? 'bot' : null,
        };
  return { ...base, opponentPassedOnEnds: [], opponentKnownMissing: missing, opponentMissingEvidence: [] };
}

interface Pending {
  record: DecisionRecord;
  seat: BotPlayerId;
  scoreSelfNow: number;
  scoreOppNow: number;
}

/**
 * Plays one full game to 60 and returns every decision with its outcomes. Deterministic for (seed, mix).
 * Switches the Fritz search to its node budget for the process (reproducibility) and seeds Math.random for the game.
 */
export function playCorpusGame(input: {
  readonly gameId: string;
  readonly seed: string;
  readonly mix: PolicyMix;
  /** Optional fixed policies (tests); otherwise each seat draws from the mix. */
  readonly policies?: readonly [PolicyId, PolicyId];
  /**
   * Test hook: called at every turn where the seat could not play, with the REAL hands, so a test can check the public
   * evidence we record against ground truth. Never used by the generator itself.
   */
  readonly audit?: (event: {
    readonly seat: BotPlayerId;
    readonly ends: readonly number[];
    readonly handBefore: readonly Tile[];
    readonly handAfter: readonly Tile[];
    readonly passed: boolean;
    readonly passMaskAfter: number;
    readonly drawMaskAfter: number;
  }) => void;
}): GameResult {
  setSearchBudgetMode('nodes');
  const gameSeed = hashSeed(input.seed);
  const dealRng = mulberry32(gameSeed ^ 0x9e3779b9);
  const policyRng = mulberry32(gameSeed ^ 0x85ebca6b);
  const exploreRng = mulberry32(gameSeed ^ 0xc2b2ae35);
  const policies: [PolicyId, PolicyId] = input.policies
    ? [input.policies[0], input.policies[1]]
    : [drawPolicy(input.mix, policyRng), drawPolicy(input.mix, policyRng)];
  const policyOf = (seat: BotPlayerId): PolicySpec => POLICIES[policies[seatIndex(seat)]];

  const originalRandom = Math.random;
  Math.random = mulberry32(gameSeed ^ 0x27d4eb2f);
  try {
    const decisions: DecisionRecord[] = [];
    let pending: Pending[] = [];
    let state = dealCorpusHand(dealRng, { you: 0, bot: 0 }, 1);
    let handStarter: BotPlayerId = state.currentPlayer;
    let tracker = emptyTracker();
    let lastActor: BotPlayerId | null = null;
    let chain = 0;
    const drewSince: Record<BotPlayerId, number> = { you: 0, bot: 0 };
    let hands = 0;

    const closeHand = (): void => {
      hands += 1;
      const reason = state.lastHandReason;
      const winner = state.lastHandWinner;
      for (const p of pending) {
        const selfNow = state.players[p.seat].score;
        const oppNow = state.players[other(p.seat)].score;
        p.record.outcome.ptsSelfToHandEnd = selfNow - p.scoreSelfNow;
        p.record.outcome.ptsOppToHandEnd = oppNow - p.scoreOppNow;
        p.record.outcome.handEndDiffDelta = selfNow - oppNow - (p.scoreSelfNow - p.scoreOppNow);
        p.record.outcome.wonHand = winner === null ? -1 : winner === p.seat ? 1 : 0;
        p.record.outcome.handEndReason = reason;
      }
      pending = [];
    };

    let guard = 0;
    while (!state.gameOver) {
      if (++guard > 20000) throw new Error(`corpus game ${input.gameId} did not terminate`);
      if (state.handOver) {
        closeHand();
        state = dealCorpusHand(dealRng, { you: state.players.you.score, bot: state.players.bot.score }, state.handNumber + 1);
        handStarter = state.currentPlayer;
        tracker = emptyTracker();
        lastActor = null;
        chain = 0;
        drewSince.you = 0;
        drewSince.bot = 0;
        continue;
      }

      const seat = state.currentPlayer;
      const plays = getLegalMoves(state, seat).filter((m): m is Move => m.type === 'play');

      if (plays.length === 0) {
        // Cannot play: draw until playable, or pass when nothing can be drawn. Record what that shows publicly.
        const ends = state.board ? getMatchableOpenEnds(state.board).map((e) => e.matchValue) : [];
        const handBefore = state.players[seat].hand.length;
        let next = drawUntilPlayableOrEmpty(state, seat).state;
        const drew = next.players[seat].hand.length - handBefore;
        if (drew > 0) {
          tracker[seat].drawCount += drew;
          drewSince[seat] += drew;
        }
        const stillStuck =
          !next.handOver && next.currentPlayer === seat && getLegalMoves(next, seat).every((m) => m.type !== 'play');
        const passed = next.currentPlayer !== seat || next.handOver || stillStuck;
        if (ends.length > 0) {
          if (drew > 0) tracker[seat].drawMask |= pipMask(ends);
          // Nothing left to draw and still no play: a pass. Permanent evidence for this hand.
          if (passed) tracker[seat].passMask |= pipMask(ends);
        }
        input.audit?.({
          seat,
          ends,
          handBefore: state.players[seat].hand,
          handAfter: next.players[seat].hand,
          passed,
          passMaskAfter: tracker[seat].passMask,
          drawMaskAfter: tracker[seat].drawMask,
        });
        if (stillStuck) next = passTurn(next, seat).state;
        if (next === state) throw new Error(`corpus game ${input.gameId} made no progress at a stuck turn`);
        state = next;
        continue;
      }

      const policy = policyOf(seat);
      let move: Move;
      let moveSource: DecisionRecord['moveSource'];
      if (plays.length === 1) {
        move = plays[0]!;
        moveSource = 'forced';
      } else if (policy.tier === null || exploreRng() < policy.epsilon) {
        move = plays[Math.floor(exploreRng() * plays.length)]!;
        moveSource = 'explore';
      } else {
        const choice = chooseBotMove(toBotVisibleState(viewFor(state, seat, tracker)), policy.tier);
        move = choice?.move ?? plays[0]!;
        moveSource = 'greedy';
      }

      chain = lastActor === seat ? chain + 1 : 0;
      const features = extractFeatures(state, seat, tracker, plays.length, handStarter);
      const record: DecisionRecord = {
        decisionId: `${input.gameId}:${state.handNumber}:${decisions.length}`,
        gameId: input.gameId,
        hand: state.handNumber,
        seq: decisions.length,
        seat: seatIndex(seat),
        policy: policy.id,
        moveSource,
        move: { tile: tileIndex(move.tile!), position: String(move.position) },
        drewBefore: drewSince[seat],
        chainIndex: chain,
        features,
        outcome: {
          ptsSelfToHandEnd: 0,
          ptsOppToHandEnd: 0,
          handEndDiffDelta: 0,
          wonHand: -1,
          handEndReason: null,
          wonGame: 0,
          finalMargin: 0,
          gameHands: 0,
        },
      };
      decisions.push(record);
      pending.push({
        record,
        seat,
        scoreSelfNow: state.players[seat].score,
        scoreOppNow: state.players[other(seat)].score,
      });
      drewSince[seat] = 0;
      lastActor = seat;
      state = applyPlayMove(state, seat, move).state;
    }

    closeHand();
    const finalYou = state.players.you.score;
    const finalBot = state.players.bot.score;
    for (const record of decisions) {
      const self = record.seat === 0 ? finalYou : finalBot;
      const opp = record.seat === 0 ? finalBot : finalYou;
      record.outcome.wonGame = self > opp ? 1 : 0;
      record.outcome.finalMargin = self - opp;
      record.outcome.gameHands = hands;
    }
    return {
      gameId: input.gameId,
      seeds: { game: gameSeed },
      policies,
      hands,
      finalScores: [finalYou, finalBot],
      decisions,
    };
  } finally {
    Math.random = originalRandom;
  }
}

/** One game's JSONL: one decision per line, keys in a fixed order. */
export function gameToJsonl(game: GameResult): string {
  return game.decisions.map((d) => JSON.stringify(d)).join('\n') + '\n';
}

export const shardFileName = (seed: number, shard: number): string => `selfplay-s${seed}-k${shard}.jsonl.gz`;

/**
 * One shard: `gamesPerShard` games, deterministic for (seed, shard, mix). The gzip header carries no timestamp, so the
 * same inputs give the same bytes.
 */
export function buildShard(
  seed: number,
  shard: number,
  gamesPerShard: number,
  mix: PolicyMix,
): { bytes: Buffer; decisions: number } {
  const lines: string[] = [];
  let decisions = 0;
  for (let i = 0; i < gamesPerShard; i++) {
    const gameId = `s${seed}-k${shard}-g${i}`;
    const game = playCorpusGame({ gameId, seed: `${gameId}|${JSON.stringify(mix)}`, mix });
    decisions += game.decisions.length;
    lines.push(gameToJsonl(game));
  }
  return { bytes: gzipSync(Buffer.from(lines.join(''), 'utf8'), { level: 9 }), decisions };
}
