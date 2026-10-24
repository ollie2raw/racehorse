import { applyMove, createInitialState, drawOne, getLegalMoves, canDraw, startNewHand } from '../../engine';
import { applyGameCommand, type GameCommand } from '../../commands';
import { getOpenEnds } from '../../scoring';
import { collectGameStateViolations } from '../../invariants';
import { createDeterministicRandom, shuffleDeterministically } from '../../random';
import { DEFAULT_CONFIG, type Config, type GameState, type Tile } from '../../types';
import { OBoard, OGame, okey, oIsDouble, type OAction, type OConfig, type OEvent, type OTile } from './engineOracle';

export type Policy = 'random' | 'scoreGreedy' | 'doubles' | 'branch' | 'lowScore';

export type Variant = {
  name: string;
  players: number;
  config: Partial<Config>;
};

export const VARIANTS: Variant[] = [
  { name: 'default-2p', players: 2, config: { winningScore: 60 } },
  { name: 'short-2p', players: 2, config: { winningScore: 25 } },
  { name: 'long-2p', players: 2, config: { winningScore: 150 } },
  { name: 'noScore-blocked', players: 2, config: { winningScore: 40, blockedHandRule: 'noScore' } },
  { name: 'no-end-bonus', players: 2, config: { winningScore: 40, endHandBonus: 'none' } },
  { name: '14-tiles-no-dead', players: 2, config: { winningScore: 40, tilesPerPlayer: 14, deadTileCount: 0 } },
  { name: 'three-player', players: 3, config: { winningScore: 40 } },
  { name: 'four-player', players: 4, config: { winningScore: 30, tilesPerPlayer: 5 } },
];

export const k = (t: Tile | OTile): string => okey(t);

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Canonical JSON: sorted keys, `undefined` dropped (same as what a JSON round trip preserves). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec).sort().filter((key) => rec[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(rec[key])}`).join(',')}}`;
}

export function toOracleConfig(c: Config): OConfig {
  return {
    maxPips: c.maxPips,
    tilesPerPlayer: c.tilesPerPlayer,
    deadTileCount: c.deadTileCount,
    scoringMultiple: c.scoringMultiple,
    blockedHandRule: c.blockedHandRule,
    endHandBonus: c.endHandBonus,
    winningScore: c.winningScore,
  };
}

export function enginePlayersFor(n: number): string[] {
  return ['A', 'B', 'C', 'D'].slice(0, n);
}

export function seededDeck(seed: string, maxPips: number): Tile[] {
  const full: Tile[] = [];
  for (let h = 0; h <= maxPips; h += 1) for (let l = 0; l <= h; l += 1) full.push({ low: l, high: h });
  return shuffleDeterministically(full, createDeterministicRandom(seed));
}

export type Coverage = {
  games: number; actions: number; hands: number; gamesCompleted: number;
  plays: number; scoringPlays: number; doublePlays: number; branchPlays: number; nestedHubPlays: number;
  explicitDraws: number; forcedChainDraws: number; chainPasses: number; passes: number;
  blockedHands: number; blockedWithWinner: number; blockedTies: number; outHands: number;
  noPlayWithBoneyardLocked: number; longestChain: number; invalidAttempts: number; bothEndsEqualPlays: number;
  tileOnTwoEndsPlays: number;
};

export function newCoverage(): Coverage {
  return {
    games: 0, actions: 0, hands: 0, gamesCompleted: 0, plays: 0, scoringPlays: 0, doublePlays: 0, branchPlays: 0,
    nestedHubPlays: 0, explicitDraws: 0, forcedChainDraws: 0, chainPasses: 0, passes: 0, blockedHands: 0,
    blockedWithWinner: 0, blockedTies: 0, outHands: 0, noPlayWithBoneyardLocked: 0, longestChain: 0,
    invalidAttempts: 0, bothEndsEqualPlays: 0, tileOnTwoEndsPlays: 0,
  };
}

export type TranscriptEntry =
  | { t: 'deal'; deck: Tile[]; starter?: string }
  | { t: 'play'; actor: string; tile: Tile; position: string }
  | { t: 'draw'; actor: string }
  | { t: 'pass'; actor: string };

export class InvariantFailure extends Error {}

export function fail(ctx: string, msg: string): never {
  throw new InvariantFailure(`${ctx}: ${msg}`);
}

function engineBoardTiles(state: GameState): Tile[] {
  if (!state.board) return [];
  const out: Tile[] = state.board.mainLine.map((p) => p.tile);
  for (const hub of state.board.hubDoubles) for (const arm of hub.branches) if (arm) out.push(...arm.tiles.map((p) => p.tile));
  return out;
}

const sortedKeys = (tiles: readonly (Tile | OTile)[]): string[] => tiles.map(k).sort();

/** Compares ONE engine state with the oracle's independently maintained state. */
export function compareStates(ctx: string, s: GameState, o: OGame, full: number): void {
  // ── tile conservation: every tile in exactly one location ──
  const where = new Map<string, string>();
  const put = (tile: Tile | OTile, loc: string) => {
    const key = k(tile);
    if (where.has(key)) fail(ctx, `tile ${key} in two places: ${where.get(key)} and ${loc}`);
    where.set(key, loc);
  };
  for (const id of s.playerIds) for (const t of s.players[id]!.hand) put(t, `hand:${id}`);
  for (const t of s.boneyard) put(t, 'boneyard');
  for (const t of engineBoardTiles(s)) put(t, 'board');
  if (s.handNumber > 0 && where.size !== full) fail(ctx, `${where.size} tiles accounted for, expected ${full}`);
  // dead tiles are the protected tail of the boneyard, never a separate copy
  const dead = s.deadTiles.map(k);
  const tail = s.boneyard.slice(Math.max(0, s.boneyard.length - s.config.deadTileCount)).map(k);
  if (s.handNumber > 0 && JSON.stringify(dead) !== JSON.stringify(tail)) fail(ctx, `deadTiles ${dead} != boneyard tail ${tail}`);

  // ── engine vs oracle ──
  for (const id of s.playerIds) {
    if (JSON.stringify(sortedKeys(s.players[id]!.hand)) !== JSON.stringify(sortedKeys(o.hands.get(id)!))) fail(ctx, `hand of ${id} differs: ${sortedKeys(s.players[id]!.hand)} vs ${sortedKeys(o.hands.get(id)!)}`);
    if (s.players[id]!.score !== o.scores.get(id)) fail(ctx, `score of ${id}: engine ${s.players[id]!.score}, oracle ${o.scores.get(id)}`);
  }
  if (JSON.stringify(s.boneyard.map(k)) !== JSON.stringify(o.boneyard.map(k))) fail(ctx, 'boneyard order/content differs');
  if (s.currentPlayerIndex !== o.cur) fail(ctx, `currentPlayerIndex engine ${s.currentPlayerIndex}, oracle ${o.cur}`);
  if (s.consecutivePasses !== o.passes) fail(ctx, `consecutivePasses engine ${s.consecutivePasses}, oracle ${o.passes}`);
  if (s.handOver !== o.handOver) fail(ctx, `handOver engine ${s.handOver}, oracle ${o.handOver}`);
  if (s.gameOver !== o.gameOver) fail(ctx, `gameOver engine ${s.gameOver}, oracle ${o.gameOver}`);
  if (s.winnerId !== o.winner) fail(ctx, `winnerId engine ${s.winnerId}, oracle ${o.winner}`);
  if (s.handOpen !== o.handOpen) fail(ctx, `handOpen engine ${s.handOpen}, oracle ${o.handOpen}`);
  if (s.handNumber !== o.handNumber) fail(ctx, `handNumber engine ${s.handNumber}, oracle ${o.handNumber}`);
  if (JSON.stringify(s.handStarters ?? []) !== JSON.stringify(o.starters)) fail(ctx, `handStarters ${s.handStarters} vs ${o.starters}`);
  if (JSON.stringify(sortedKeys(engineBoardTiles(s))) !== JSON.stringify(sortedKeys(o.board.tiles()))) fail(ctx, 'board tile set differs from the oracle board');

  // ── board connectivity ──
  if (s.board) {
    const ml = s.board.mainLine;
    for (let i = 0; i + 1 < ml.length; i += 1) {
      const a = ml[i]!; const b = ml[i + 1]!;
      const rightOf = (p: typeof a): number => (p.tile.low === p.tile.high ? p.tile.high : p.orientation === 'horizontal-normal' ? p.tile.high : p.tile.low);
      const leftOf = (p: typeof a): number => (p.tile.low === p.tile.high ? p.tile.high : p.orientation === 'horizontal-normal' ? p.tile.low : p.tile.high);
      if (rightOf(a) !== leftOf(b)) fail(ctx, `mainline pips do not meet between ${i} (${k(a.tile)}) and ${i + 1} (${k(b.tile)})`);
    }
    const ports = o.board.ports().map((p) => `${p.position}=${p.pip}`).sort();
    const eng = getOpenEnds(s.board).map((e) => `${e.position}=${e.matchValue}`).sort();
    if (JSON.stringify(ports) !== JSON.stringify(eng)) fail(ctx, `open ends differ: oracle ${ports} engine ${eng}`);
    // arm / hub metadata that other layers (UI, analyzer, persistence) read must match the oracle too
    const crossed = o.board.crossedHubIds();
    s.board.hubDoubles.forEach((hub, idx) => {
      const id = hub.hubId ?? idx;
      if (hub.isCrossed !== crossed.has(id)) fail(ctx, `hub ${id} isCrossed metadata ${hub.isCrossed}, oracle ${crossed.has(id)}`);
      [0, 1].forEach((arm) => {
        const engineArm = hub.branches[arm];
        const tip = o.board.armTip(id, arm);
        if (!engineArm || engineArm.tiles.length === 0) {
          if (tip) fail(ctx, `hub ${id} arm ${arm}: oracle has tiles, engine arm is empty`);
          return;
        }
        if (!tip) fail(ctx, `hub ${id} arm ${arm}: engine has tiles, oracle arm is empty`);
        if (engineArm.openEnd !== tip.pip) fail(ctx, `hub ${id} arm ${arm} openEnd metadata ${engineArm.openEnd}, oracle ${tip.pip}`);
        if (engineArm.openEndIsDouble !== tip.double) fail(ctx, `hub ${id} arm ${arm} openEndIsDouble metadata ${engineArm.openEndIsDouble}, oracle ${tip.double}`);
      });
    });
    if (ml.length >= 2) {
      const oracleL = o.board.ports().find((p) => p.position === 'left')!.pip;
      const oracleR = o.board.ports().find((p) => p.position === 'right')!.pip;
      if (s.board.leftEndIsDouble !== oIsDouble(o.board.main[0]!.tile) || s.board.rightEndIsDouble !== oIsDouble(o.board.main[o.board.main.length - 1]!.tile)) fail(ctx, 'leftEndIsDouble/rightEndIsDouble metadata differs from the oracle');
      if (s.board.leftEnd !== oracleL || s.board.rightEnd !== oracleR) fail(ctx, `leftEnd/rightEnd metadata ${s.board.leftEnd}/${s.board.rightEnd} vs oracle ${oracleL}/${oracleR}`);
    }
  } else if (o.board.main.length > 0) fail(ctx, 'engine has no board but oracle does');

  // ── legality of the actor's moves + draw/pass ──
  if (!s.handOver && !s.gameOver) {
    const actor = s.playerIds[s.currentPlayerIndex]!;
    const engineMoves = getLegalMoves(s, actor);
    const enginePlays = engineMoves.filter((m) => m.type === 'play').map((m) => (m.type === 'play' ? `${k(m.tile)}@${m.position}` : '')).sort();
    const oraclePlays = o.plays(actor).map((p) => `${k(p.tile)}@${p.position}`).sort();
    if (JSON.stringify(enginePlays) !== JSON.stringify(oraclePlays)) fail(ctx, `legal plays differ.\n engine: ${enginePlays}\n oracle: ${oraclePlays}`);
    const enginePass = engineMoves.some((m) => m.type === 'pass');
    if (enginePass !== o.canPass(actor)) fail(ctx, `pass legality engine ${enginePass}, oracle ${o.canPass(actor)}`);
    if (canDraw(s, actor) !== o.canDraw(actor)) fail(ctx, `draw legality engine ${canDraw(s, actor)}, oracle ${o.canDraw(actor)}`);
    for (const id of s.playerIds) {
      if (id === actor) continue;
      if (canDraw(s, id)) fail(ctx, `canDraw true for non-current player ${id}`);
      let threw = false;
      try { getLegalMoves(s, id); } catch { threw = true; }
      if (!threw) fail(ctx, `getLegalMoves answered for non-current player ${id}`);
    }
  } else {
    for (const id of s.playerIds) {
      let moves: unknown[] = [];
      try { moves = getLegalMoves(s, id); } catch { moves = []; }
      if (moves.length > 0) fail(ctx, 'moves offered in a terminal state');
      if (canDraw(s, id)) fail(ctx, 'draw offered in a terminal state');
    }
  }

  // ── secondary: the repo's own structural checker must also be clean ──
  const violations = collectGameStateViolations(s);
  if (violations.length) fail(ctx, `collectGameStateViolations: ${violations.join('; ')}`);
}

export function chooseAction(o: OGame, policy: Policy, rnd: ReturnType<typeof createDeterministicRandom>): OAction {
  const actor = o.actor;
  const plays = o.plays(actor);
  if (plays.length > 0) {
    let pick = plays[rnd.nextInt(plays.length)]!;
    const scoreOf = (p: { tile: OTile; position: string }): number => {
      const probe = o.handOpen ? o.board.clone() : OBoard.empty();
      probe.place(p.tile, p.position);
      return probe.score(o.cfg.scoringMultiple);
    };
    if (policy === 'scoreGreedy') {
      pick = plays.reduce((best, p) => (scoreOf(p) > scoreOf(best) ? p : best), plays[0]!);
    } else if (policy === 'doubles') {
      const d = plays.filter((p) => oIsDouble(p.tile));
      if (d.length) pick = d[rnd.nextInt(d.length)]!;
    } else if (policy === 'branch') {
      const b = plays.filter((p) => p.position.startsWith('branch-'));
      if (b.length) pick = b[rnd.nextInt(b.length)]!;
    } else if (policy === 'lowScore') {
      const z = plays.filter((p) => scoreOf(p) === 0);
      const pool = z.length ? z : plays;
      pick = pool.reduce((best, p) => (p.tile.low + p.tile.high > best.tile.low + best.tile.high ? p : best), pool[0]!);
    }
    return { kind: 'play', actor, tile: pick.tile, position: pick.position };
  }
  if (o.canDraw(actor)) return { kind: 'draw', actor };
  return { kind: 'pass', actor };
}

export type Cursor = { engine: GameState; oracle: OGame };

export type RunResult = {
  finalState: GameState;
  trace: string[];
  transcript: TranscriptEntry[];
  coverage: Coverage;
  states: GameState[];
  /** Oracle open-ends sum after each state in `states` (null before a tile is down). */
  openEndsSums: Array<number | null>;
};

function flip(t: Tile, rnd: ReturnType<typeof createDeterministicRandom>): Tile {
  return rnd.nextInt(2) === 0 ? { low: t.low, high: t.high } : { low: t.high, high: t.low };
}

/**
 * Plays one complete seeded game. The ORACLE picks the action from the rules; the ENGINE executes it;
 * after every transition the engine state is compared with the oracle state and every invariant holds.
 */
export function playGame(seed: string, variant: Variant, policy: Policy, opts: { maxActions?: number; coverage?: Coverage; keepStates?: boolean } = {}): RunResult {
  const cov = opts.coverage ?? newCoverage();
  const maxActions = opts.maxActions ?? 4000;
  const ids = enginePlayersFor(variant.players);
  const cfg: Config = { ...DEFAULT_CONFIG, ...variant.config };
  const full = ((cfg.maxPips + 1) * (cfg.maxPips + 2)) / 2;
  const rnd = createDeterministicRandom(`${seed}:policy`);
  const oracle = new OGame(ids, toOracleConfig(cfg));
  let state = createInitialState(ids, variant.config);
  const transcript: TranscriptEntry[] = [];
  const trace: string[] = [];
  const states: GameState[] = [];
  const openEndsSums: Array<number | null> = [];
  cov.games += 1;
  let hand = 0;
  let step = 0;
  const ctxOf = () => `[seed=${seed} variant=${variant.name} policy=${policy} step=${step}]`;

  const deal = (): void => {
    const deck = seededDeck(`${seed}:hand${hand}`, cfg.maxPips);
    hand += 1;
    cov.hands += 1;
    transcript.push({ t: 'deal', deck });
    deepFreeze(state);
    const beforeDeal = canonicalJson(state);
    state = startNewHand(state, deck.map((t) => ({ ...t })));
    if (canonicalJson(state) === beforeDeal) fail(ctxOf(), 'startNewHand returned an identical state');
    oracle.dealHand(deck);
    deepFreeze(state);
    compareStates(ctxOf(), state, oracle, full);
    trace.push(canonicalJson(state));
    if (opts.keepStates) { states.push(state); openEndsSums.push(oracle.board.main.length ? oracle.board.openEndsSum() : null); }
  };

  deal();
  while (!state.gameOver && step < maxActions) {
    if (state.handOver) { deal(); continue; }
    const action = chooseAction(oracle, policy, rnd);
    step += 1;
    cov.actions += 1;
    const before = state;
    const beforeJson = canonicalJson(before);
    const prevScores = Object.fromEntries(state.playerIds.map((id) => [id, state.players[id]!.score]));
    const legalBefore = oracle.plays(action.actor);
    const oracleBoardBefore = oracle.board.clone();
    const submitted = action.kind === 'play' ? flip(action.tile as Tile, rnd) : null;
    const ev: OEvent = oracle.apply(action.kind === 'play' && submitted ? { ...action, tile: submitted } : action);
    if (action.kind === 'play') {
      const tile = submitted!;
      const result = applyMove(before, action.actor, { type: 'play', tile, position: action.position as never });
      state = result.state;
      transcript.push({ t: 'play', actor: action.actor, tile: { low: tile.low, high: tile.high }, position: action.position });
      cov.plays += 1;
      if (ev.scoredPlay) cov.scoringPlays += 1;
      if (oIsDouble(action.tile)) cov.doublePlays += 1;
      if (action.position.startsWith('branch-')) cov.branchPlays += 1;
      const ports = oracleBoardBefore.ports();
      if (ports.length >= 2 && ports[0]!.pip === ports[1]!.pip) cov.bothEndsEqualPlays += 1;
      const matches = legalBefore.filter((p) => k(p.tile) === k(action.tile)).length;
      if (matches >= 2) cov.tileOnTwoEndsPlays += 1;
      if (/^branch-\d+-\d$/.test(action.position) && oracle.board.hubs.some((h) => h.where === 'arm')) cov.nestedHubPlays += 1;
      cov.forcedChainDraws += ev.forcedDraws;
      cov.longestChain = Math.max(cov.longestChain, ev.forcedDraws);
      if (ev.chainPassed) cov.chainPasses += 1;
      if ((result.forcedDraw !== null) !== (ev.forcedDraws > 0)) fail(ctxOf(), `forcedDraw flag ${result.forcedDraw} vs oracle chain ${ev.forcedDraws}`);
    } else if (action.kind === 'draw') {
      state = drawOne(before, action.actor).state;
      transcript.push({ t: 'draw', actor: action.actor });
      cov.explicitDraws += 1;
    } else {
      state = applyMove(before, action.actor, { type: 'pass' }).state;
      transcript.push({ t: 'pass', actor: action.actor });
      cov.passes += 1;
      if (oracle.drawable() === 0) cov.noPlayWithBoneyardLocked += 1;
    }
    if (ev.handEnd === 'blocked') {
      cov.blockedHands += 1;
      if (oracle.winner !== null || ev.endBonus) cov.blockedWithWinner += 1;
      if (!ev.endBonus) cov.blockedTies += 1;
    }
    if (ev.handEnd === 'out') cov.outHands += 1;
    if (oracle.gameOver) cov.gamesCompleted += 1;
    // the input must be untouched by the transition
    if (canonicalJson(before) !== beforeJson) fail(ctxOf(), 'engine mutated its input state');
    deepFreeze(state);
    compareStates(ctxOf(), state, oracle, full);
    for (const id of state.playerIds) if (state.players[id]!.score < prevScores[id]!) fail(ctxOf(), `score of ${id} decreased`);
    if (action.kind === 'pass' && ev.handEnd === 'blocked' && state.sequence !== before.sequence + 1) fail(ctxOf(), `the blocking pass must advance the sequence by exactly 1 (${before.sequence} -> ${state.sequence})`);
    if (state.sequence <= before.sequence) fail(ctxOf(), `sequence did not advance (${before.sequence} -> ${state.sequence}) after ${action.kind}`);
    // award-once: scores change only by what the oracle awarded this action
    const awarded = (ev.playScore ?? 0) + (ev.endBonus ?? 0);
    const mover = action.actor;
    const totalDelta = state.playerIds.reduce((s, id) => s + state.players[id]!.score - prevScores[id]!, 0);
    if (totalDelta !== awarded) fail(ctxOf(), `total score moved by ${totalDelta} but the oracle awarded ${awarded} (mover ${mover})`);
    trace.push(canonicalJson(state));
    if (opts.keepStates) { states.push(state); openEndsSums.push(oracle.board.main.length ? oracle.board.openEndsSum() : null); }
  }
  return { finalState: state, trace, transcript, coverage: cov, states, openEndsSums };
}

/** Replays a transcript from scratch through the COMMAND path (applyGameCommand) with JSON round trips between steps. */
export function replayTranscript(ids: string[], variantConfig: Partial<Config>, transcript: TranscriptEntry[], roundTrip: boolean): { finalState: GameState; trace: string[] } {
  let state = createInitialState(ids, variantConfig);
  const trace: string[] = [];
  for (const entry of transcript) {
    if (roundTrip) state = JSON.parse(JSON.stringify(state)) as GameState;
    if (entry.t === 'deal') {
      state = startNewHand(state, entry.deck.map((t) => ({ ...t })));
    } else {
      const base = { version: 1 as const, commandId: `r:${state.sequence}`, sequence: state.sequence, actorId: entry.actor };
      const command: GameCommand = entry.t === 'play'
        ? { ...base, kind: 'play', tile: entry.tile, position: entry.position as never }
        : entry.t === 'draw' ? { ...base, kind: 'draw' } : { ...base, kind: 'pass' };
      state = applyGameCommand(state, JSON.parse(JSON.stringify(command)) as GameCommand).state;
    }
    trace.push(canonicalJson(state));
  }
  return { finalState: state, trace };
}
