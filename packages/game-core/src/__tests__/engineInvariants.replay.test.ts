/**
 * Transcript replay, serialization, determinism, invalid-action non-mutation and terminal-state
 * invariants over generated games (reproducible seeds; see engineInvariants.property.test.ts).
 */
import { describe, expect, it, vi } from 'vitest';
import { applyMove, canDraw, createInitialState, drawOne, getLegalMoves, startNewHand } from '../engine';
import { applyGameCommand } from '../commands';
import { DEFAULT_CONFIG, type GameState, type Tile } from '../types';
import { OGame } from './support/engineOracle';
import { getOpenEnds, computePlayScore } from '../scoring';
import {
  canonicalJson, deepFreeze, enginePlayersFor, playGame, replayTranscript, seededDeck, toOracleConfig,
  VARIANTS, type Policy, type TranscriptEntry,
} from './support/engineHarness';

const GAMES = Number(process.env.ENGINE_REPLAY_GAMES ?? 2);
const NS = process.env.ENGINE_PROPERTY_SEED ?? 'engine-invariants-v1';
const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch', 'lowScore'];

// Every test below needs the same generated games; they are deterministic per seed, so play each one once.
const RUNS = new Map<string, ReturnType<typeof playGame>>();
function cachedGame(seed: string, variant: (typeof VARIANTS)[number], policy: Policy): ReturnType<typeof playGame> {
  let run = RUNS.get(seed);
  if (!run) { run = playGame(seed, variant, policy, { keepStates: true }); RUNS.set(seed, run); }
  return run;
}

function* games(): Generator<{ seed: string; variant: (typeof VARIANTS)[number]; policy: Policy }> {
  for (const variant of VARIANTS) for (const policy of POLICIES) for (let g = 0; g < GAMES; g += 1) yield { seed: `${NS}:replay:${variant.name}:${policy}:${g}`, variant, policy };
}

describe('transcript replay: live execution == replay from the transcript', () => {
  it('replaying the recorded transcript through the command path reproduces EVERY intermediate state and the final state', () => {
    let checked = 0;
    for (const { seed, variant, policy } of games()) {
      const live = cachedGame(seed, variant, policy);
      const replay = replayTranscript(enginePlayersFor(variant.players), variant.config, live.transcript, false);
      expect(replay.trace.length, seed).toBe(live.transcript.length);
      replay.trace.forEach((json, i) => {
        // live.trace[i] is the state AFTER transcript entry i
        if (json !== live.trace[i]) throw new Error(`[seed=${seed}] replay diverged at transcript entry ${i}: ${JSON.stringify(live.transcript[i])}`);
      });
      expect(canonicalJson(replay.finalState), seed).toBe(canonicalJson(live.finalState));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
  }, 300_000);

  it('a transcript serialized to JSON text and parsed back replays identically (what is stored is what is replayed)', () => {
    for (const { seed, variant, policy } of games()) {
      const live = cachedGame(seed, variant, policy);
      const text = JSON.stringify(live.transcript);
      const parsed = JSON.parse(text) as TranscriptEntry[];
      const replay = replayTranscript(enginePlayersFor(variant.players), variant.config, parsed, false);
      expect(canonicalJson(replay.finalState), seed).toBe(canonicalJson(live.finalState));
    }
  }, 300_000);
});

describe('serialization round trip', () => {
  it('state -> JSON -> state at EVERY step (a restart after any action) preserves all authoritative semantics and the game continues identically', () => {
    for (const { seed, variant, policy } of games()) {
      const live = cachedGame(seed, variant, policy);
      const restarted = replayTranscript(enginePlayersFor(variant.players), variant.config, live.transcript, true);
      expect(restarted.trace, seed).toEqual(live.trace);
    }
  }, 300_000);

  it('round-trips every reachable state field-for-field (including board orientation, hubs, branches, counters)', () => {
    for (const { seed, variant, policy } of games()) {
      for (const state of cachedGame(seed, variant, policy).states) {
        const back = JSON.parse(JSON.stringify(state)) as GameState;
        expect(canonicalJson(back), seed).toBe(canonicalJson(state));
        for (const key of ['currentPlayerIndex', 'handNumber', 'handOpen', 'handOver', 'gameOver', 'winnerId', 'consecutivePasses', 'sequence'] as const) {
          expect(back[key], `${seed} ${key}`).toBe(state[key]);
        }
        expect(back.handStarters ?? [], seed).toEqual(state.handStarters ?? []);
      }
    }
  }, 300_000);
});

describe('determinism', () => {
  it('same seed + same decisions => identical states, scores, transcript and result, run repeatedly', () => {
    for (const variant of VARIANTS) {
      const seed = `${NS}:determinism:${variant.name}`;
      const first = playGame(seed, variant, 'random');
      for (let i = 0; i < 3; i += 1) {
        const again = playGame(seed, variant, 'random');
        expect(again.trace).toEqual(first.trace);
        expect(again.transcript).toEqual(first.transcript);
        expect(again.finalState.winnerId).toBe(first.finalState.winnerId);
      }
    }
  }, 300_000);

  it('after the deal, no wall-clock or global randomness influences the engine', () => {
    const variant = VARIANTS[0]!;
    const baseline = playGame(`${NS}:rng`, variant, 'random');
    const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random used after initialization'); });
    const now = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now used by the engine'); });
    try {
      const again = playGame(`${NS}:rng`, variant, 'random');
      expect(again.trace).toEqual(baseline.trace);
    } finally { random.mockRestore(); now.mockRestore(); }
  });
});

describe('invalid actions never mutate state', () => {
  function expectRejected(label: string, state: GameState, run: () => unknown): void {
    const frozen = deepFreeze(state);
    const before = canonicalJson(frozen);
    let threw = false;
    try { run(); } catch { threw = true; }
    expect(threw, `${label}: must be rejected`).toBe(true);
    expect(canonicalJson(frozen), `${label}: state mutated by a rejected action`).toBe(before);
  }

  /** A rejected action either throws or is an explicit no-op (`drew: null`): in both cases nothing changes. */
  function expectNoEffect(label: string, state: GameState, run: () => { state: GameState } | unknown): void {
    const frozen = deepFreeze(state);
    const before = canonicalJson(frozen);
    let result: unknown;
    let threw = false;
    try { result = run(); } catch { threw = true; }
    if (!threw) expect(canonicalJson((result as { state: GameState }).state), `${label}: a non-throwing refusal must return the same state`).toBe(before);
    expect(canonicalJson(frozen), `${label}: state mutated`).toBe(before);
  }

  it('wrong player, tile not in hand, incompatible end, malformed placement, illegal draw/pass, stale sequence, action after terminal', () => {
    let attempts = 0;
    for (const { seed, variant, policy } of games()) {
      const { states } = cachedGame(seed, variant, policy);
      const step = Math.max(1, Math.floor(states.length / 12));
      for (let i = 0; i < states.length; i += step) {
        const s = states[i]!;
        const ids = s.playerIds;
        if (s.handOver || s.gameOver) {
          for (const id of ids) {
            expectRejected(`${seed}#${i} pass after terminal`, s, () => applyMove(s, id, { type: 'pass' }));
            expectRejected(`${seed}#${i} command after terminal`, s, () => applyGameCommand(s, { version: 1, commandId: 'x', sequence: s.sequence, actorId: id, kind: 'pass' }));
            attempts += 2;
          }
          const hand = s.players[ids[s.currentPlayerIndex]!]!.hand[0];
          if (hand) expectRejected(`${seed}#${i} play after terminal`, s, () => applyMove(s, ids[s.currentPlayerIndex]!, { type: 'play', tile: hand, position: 'left' }));
          if (s.gameOver) expectRejected(`${seed}#${i} new hand after game over`, s, () => startNewHand(s));
          continue;
        }
        const actor = ids[s.currentPlayerIndex]!;
        const other = ids.find((id) => id !== actor)!;
        const legal = getLegalMoves(s, actor);
        const hasPlay = legal.some((m) => m.type === 'play');
        const mine = s.players[actor]!.hand;
        const theirs = s.players[other]!.hand;
        // wrong player
        const anyTile = theirs[0] ?? mine[0];
        if (anyTile) expectRejected(`${seed}#${i} wrong player plays`, s, () => applyMove(s, other, { type: 'play', tile: anyTile, position: 'left' }));
        expectRejected(`${seed}#${i} wrong player passes`, s, () => applyMove(s, other, { type: 'pass' }));
        expectNoEffect(`${seed}#${i} wrong player draws`, s, () => drawOne(s, other));
        // tile not in hand (opponent's tile, boneyard tile, nonexistent tile)
        for (const foreign of [theirs[0], s.boneyard[0], { low: 9, high: 9 } as Tile]) {
          if (foreign && !mine.some((m) => m.low === foreign.low && m.high === foreign.high)) {
            expectRejected(`${seed}#${i} foreign tile`, s, () => applyMove(s, actor, { type: 'play', tile: foreign, position: 'left' }));
            attempts += 1;
          }
        }
        // malformed placements
        const probeTile = mine[0];
        if (probeTile) {
          for (const position of ['up', '', 'branch-999-0', 'branch-0-9', 'branch-x-y', 'LEFT', 'left ']) {
            expectRejected(`${seed}#${i} malformed position ${position}`, s, () => applyMove(s, actor, { type: 'play', tile: probeTile, position: position as never }));
            attempts += 1;
          }
        }
        // a tile in hand at a position where it is not a legal move
        const legalKeys = new Set(legal.filter((m) => m.type === 'play').map((m) => (m.type === 'play' ? `${Math.min(m.tile.low, m.tile.high)}|${Math.max(m.tile.low, m.tile.high)}@${m.position}` : '')));
        for (const tile of mine) for (const position of ['left', 'right']) {
          const key = `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}@${position}`;
          if (!legalKeys.has(key)) { expectRejected(`${seed}#${i} incompatible ${key}`, s, () => applyMove(s, actor, { type: 'play', tile, position: position as never })); attempts += 1; }
        }
        // illegal draw / illegal pass
        if (hasPlay) {
          expectNoEffect(`${seed}#${i} draw while a play exists`, s, () => drawOne(s, actor));
          expectRejected(`${seed}#${i} pass while a play exists`, s, () => applyMove(s, actor, { type: 'pass' }));
          expectRejected(`${seed}#${i} draw command while a play exists`, s, () => applyGameCommand(s, { version: 1, commandId: 'd', sequence: s.sequence, actorId: actor, kind: 'draw' }));
          attempts += 3;
        } else if (!canDraw(s, actor)) {
          expectRejected(`${seed}#${i} draw command with nothing drawable`, s, () => applyGameCommand(s, { version: 1, commandId: 'd', sequence: s.sequence, actorId: actor, kind: 'draw' }));
        } else {
          expectRejected(`${seed}#${i} pass with drawable boneyard`, s, () => applyMove(s, actor, { type: 'pass' }));
          attempts += 1;
        }
        // stale / future command sequence
        for (const sequence of [s.sequence - 1, s.sequence + 1]) {
          expectRejected(`${seed}#${i} stale sequence ${sequence}`, s, () => applyGameCommand(s, { version: 1, commandId: 's', sequence, actorId: actor, kind: 'pass' }));
          attempts += 1;
        }
      }
    }
    expect(attempts).toBeGreaterThan(1000);
  }, 300_000);
});

describe('terminal states', () => {
  it('a finished hand/game accepts no gameplay, cannot restart without an explicit deal, and the result agrees with the score rule', () => {
    let hands = 0; let gamesDone = 0;
    for (const { seed, variant, policy } of games()) {
      const run = cachedGame(seed, variant, policy);
      const target = variant.config.winningScore ?? DEFAULT_CONFIG.winningScore;
      let prev: GameState | null = null;
      for (const s of run.states) {
        if (s.handOver && !(prev?.handOver)) hands += 1; // a hand ends exactly once: handOver never toggles true->true via an action
        if (s.gameOver) {
          expect(s.handOver, seed).toBe(true);
          const scores = s.playerIds.map((id) => s.players[id]!.score);
          const top = Math.max(...scores);
          expect(top, seed).toBeGreaterThanOrEqual(target);
          expect(scores.filter((x) => x === top).length, `${seed}: tie at the top cannot be a win`).toBe(1);
          expect(s.winnerId, seed).toBe(s.playerIds[scores.indexOf(top)]);
          gamesDone += 1;
        } else if (s.handOver) {
          const qualified = s.playerIds.map((id) => s.players[id]!.score).filter((x) => x >= target);
          if (qualified.length) {
            const top = Math.max(...qualified);
            expect(qualified.filter((x) => x === top).length, `${seed}: game continues only when the top qualifying score is tied`).toBeGreaterThan(1);
          }
          expect(s.winnerId, seed).toBeNull();
        }
        prev = s;
      }
    }
    expect(hands).toBeGreaterThan(100);
    expect(gamesDone).toBeGreaterThan(20);
  }, 300_000);

  it('the same hand cannot be finished or scored twice: applying any action to a finished hand throws and scores are unchanged', () => {
    const variant = VARIANTS[0]!;
    const run = playGame(`${NS}:terminal-once`, variant, 'scoreGreedy', { keepStates: true });
    const finished = run.states.filter((s) => s.handOver);
    expect(finished.length).toBeGreaterThan(0);
    for (const s of finished) {
      const scores = canonicalJson(s.players);
      for (const id of s.playerIds) {
        expect(() => applyMove(s, id, { type: 'pass' })).toThrow();
      }
      expect(canonicalJson(s.players)).toBe(scores);
    }
  });
});

describe('draw/pass rules in the "everything relevant is already known" case', () => {
  it('when every tile that could ever fit the open ends is already outside the boneyard, the draw is STILL mandatory (and a pass is illegal) until the drawable boneyard is exhausted', () => {
    // Board ends 5 and 5 ([5|5] opened, [5|4] on the right => ends 5 | 4... build explicit state): all 5-pip and
    // 4-pip tiles are in the opponent's hand or on the board, the boneyard holds only irrelevant tiles.
    const t = (a: number, b: number): Tile => ({ low: Math.min(a, b), high: Math.max(a, b) });
    const state: GameState = {
      config: { ...DEFAULT_CONFIG, winningScore: 60 },
      playerIds: ['A', 'B'],
      players: {
        A: { id: 'A', hand: [t(0, 1)], score: 0 },
        B: { id: 'B', hand: [t(4, 4), t(4, 5), t(5, 5), t(3, 5), t(2, 5), t(1, 5), t(0, 5), t(3, 4), t(2, 4), t(1, 4), t(0, 4), t(4, 6), t(5, 6)], score: 0 },
      },
      board: {
        mainLine: [
          { tile: t(4, 5), orientation: 'horizontal-flipped' },
          { tile: t(5, 6), orientation: 'horizontal-normal' },
        ],
        leftEnd: 4, rightEnd: 6, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [],
      },
      boneyard: [t(0, 0), t(1, 1), t(0, 2), t(1, 2), t(2, 2), t(0, 3), t(1, 3), t(2, 3), t(3, 3)],
      deadTiles: [t(2, 3), t(3, 3)],
      currentPlayerIndex: 0, handNumber: 1, handOpen: true, handOver: false, gameOver: false, winnerId: null,
      consecutivePasses: 0, sequence: 9, handStarters: ['A'],
    };
    // A holds [0|1]; ends need 4 or 6. Known-out: every 4 and 6 is on the board or in B's hand, so no draw can help.
    expect(getLegalMoves(state, 'A')).toEqual([]);
    expect(canDraw(state, 'A')).toBe(true);
    expect(() => applyMove(state, 'A', { type: 'pass' })).toThrow();
    let s = state;
    const drawable = state.boneyard.length - state.config.deadTileCount;
    for (let i = 0; i < drawable; i += 1) {
      expect(canDraw(s, 'A')).toBe(true);
      const before = s;
      s = drawOne(s, 'A').state;
      expect(s.boneyard.length).toBe(before.boneyard.length - 1);
      expect(s.players.A!.hand.length).toBe(before.players.A!.hand.length + 1);
      expect(s.players.B!.hand).toEqual(before.players.B!.hand);
      expect(s.currentPlayerIndex).toBe(0);
    }
    expect(canDraw(s, 'A')).toBe(false);
    expect(s.boneyard).toEqual(state.deadTiles);              // the locked tiles were never drawn
    expect(getLegalMoves(s, 'A')).toEqual([{ type: 'pass' }]); // and only now is a pass legal
    const passed = applyMove(s, 'A', { type: 'pass' }).state;
    expect(passed.currentPlayerIndex).toBe(1);
    expect(passed.consecutivePasses).toBe(1);
  });
});

describe('opening-tile orientation is a pure mirror image', () => {
  it('submitting the opening tile reversed gives the same legal moves, scores, ends, hands and turn flow, left/right swapped', () => {
    let mirrored = true; // a reversed DOUBLE opening is the identical board, so there is nothing to mirror
    const swap = (pos: string): string => (!mirrored ? pos : pos === 'left' ? 'right' : pos === 'right' ? 'left' : pos);
    const keyOf = (m: { type: string; tile?: Tile; position?: string }) => (m.type === 'pass' ? 'pass' : `${Math.min(m.tile!.low, m.tile!.high)}|${Math.max(m.tile!.low, m.tile!.high)}@${m.position}`);
    let compared = 0;
    for (const { seed, variant } of games()) {
      const ids = enginePlayersFor(variant.players);
      const cfg = { ...DEFAULT_CONFIG, ...variant.config };
      const deck = seededDeck(`${seed}:mirror`, cfg.maxPips);
      const o = new OGame(ids, toOracleConfig(cfg));
      o.dealHand(deck);
      let a = startNewHand(createInitialState(ids, variant.config), deck.map((t) => ({ ...t })));
      let b = a;
      let opened = false;
      mirrored = true;
      for (let step = 0; step < 400 && !a.handOver; step += 1) {
        const actor = ids[a.currentPlayerIndex]!;
        const plays = o.plays(actor);
        let actionA: { type: 'play'; tile: Tile; position: string } | { type: 'pass' } | null = null;
        if (plays.length) {
          const p = plays[(step * 7 + deck.length) % plays.length]!;
          // the ORACLE labels positions for engine A; engine B sees the mirror image once the board exists
          actionA = { type: 'play', tile: { low: p.tile.low, high: p.tile.high }, position: p.position };
        } else if (!o.canDraw(actor)) actionA = { type: 'pass' };
        if (actionA && actionA.type === 'play') {
          if (!opened) mirrored = actionA.tile.low !== actionA.tile.high;
          const tileB = opened ? actionA.tile : { low: actionA.tile.high, high: actionA.tile.low };
          const posB = opened ? swap(actionA.position) : actionA.position;
          a = applyMove(a, actor, { type: 'play', tile: actionA.tile, position: actionA.position as never }).state;
          b = applyMove(b, actor, { type: 'play', tile: tileB, position: posB as never }).state;
          o.apply({ kind: 'play', actor, tile: actionA.tile, position: actionA.position });
          opened = true;
        } else if (actionA) {
          a = applyMove(a, actor, { type: 'pass' }).state; b = applyMove(b, actor, { type: 'pass' }).state; o.apply({ kind: 'pass', actor });
        } else {
          a = drawOne(a, actor).state; b = drawOne(b, actor).state; o.apply({ kind: 'draw', actor });
        }
        const ctx = `${seed}#${step}`;
        for (const id of ids) {
          expect(b.players[id]!.score, `${ctx} score ${id}`).toBe(a.players[id]!.score);
          expect(b.players[id]!.hand.map((t) => `${t.low}|${t.high}`).sort(), ctx).toEqual(a.players[id]!.hand.map((t) => `${t.low}|${t.high}`).sort());
        }
        expect([b.currentPlayerIndex, b.consecutivePasses, b.sequence, b.handOver, b.gameOver, b.winnerId]).toEqual([a.currentPlayerIndex, a.consecutivePasses, a.sequence, a.handOver, a.gameOver, a.winnerId]);
        expect(b.boneyard.map((t) => `${t.low}|${t.high}`)).toEqual(a.boneyard.map((t) => `${t.low}|${t.high}`));
        if (a.board && b.board) {
          expect(computePlayScore(b.board, cfg), ctx).toBe(computePlayScore(a.board, cfg));
          const endsA = getOpenEnds(a.board).map((e) => `${swap(e.position)}=${e.matchValue}`).sort();
          const endsB = getOpenEnds(b.board).map((e) => `${e.position}=${e.matchValue}`).sort();
          expect(endsB, `${ctx} open ends are the mirror image`).toEqual(endsA);
          expect(b.board.mainLine.map((p) => `${Math.min(p.tile.low, p.tile.high)}|${Math.max(p.tile.low, p.tile.high)}`), ctx).toEqual((mirrored ? (xs: string[]) => [...xs].reverse() : (xs: string[]) => xs)(a.board.mainLine.map((p) => `${Math.min(p.tile.low, p.tile.high)}|${Math.max(p.tile.low, p.tile.high)}`)));
        }
        if (!a.handOver) {
          const mA = getLegalMoves(a, ids[a.currentPlayerIndex]!).map((m) => keyOf(m.type === 'play' ? { ...m, position: a.board ? swap(m.position) : m.position } : m)).sort(); // before the opening there is no board to mirror
          const mB = getLegalMoves(b, ids[b.currentPlayerIndex]!).map(keyOf).sort();
          expect(mB, `${ctx} legal moves are the mirror image`).toEqual(mA);
        }
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(1000);
  }, 300_000);
});

describe('oracle self-check (the reference model must itself be sane)', () => {
  it('conserves tiles and ends hands on its own for a seeded game', () => {
    const cfg = { ...DEFAULT_CONFIG, winningScore: 25 };
    const o = new OGame(['A', 'B'], toOracleConfig(cfg));
    o.dealHand(seededDeck('oracle-self', 6));
    const total = () => [...o.hands.values()].reduce((s, h) => s + h.length, 0) + o.boneyard.length + o.board.tiles().length;
    expect(total()).toBe(28);
    let guard = 0;
    while (!o.handOver && guard++ < 500) {
      const plays = o.plays(o.actor);
      if (plays.length) o.apply({ kind: 'play', actor: o.actor, tile: plays[0]!.tile, position: plays[0]!.position });
      else if (o.canDraw(o.actor)) o.apply({ kind: 'draw', actor: o.actor });
      else o.apply({ kind: 'pass', actor: o.actor });
      expect(total()).toBe(28);
    }
    expect(o.handOver).toBe(true);
    void createInitialState; void applyMove;
  });
});
