/**
 * Deterministic game generator + independent decision ledger for the review-engine correctness suite.
 *
 * The authoritative engine is the ONLY thing trusted here (it is independently tested in game-core). Everything the
 * analyzer is asked to review is captured the way production captures it: one V2 snapshot at the true pre-action
 * boundary of EVERY action (both seats), built from the engine pre-state and the command about to be applied. The
 * harness also keeps its own flat action log, which is what the "every decision accounted for" checks compare against.
 *
 * Reproducible: `makeGame(namespace, n)` is a pure function of its arguments. A failing check prints `<namespace>:<n>`
 * plus the action index, which is enough to replay the exact position.
 */
import {
  applyGameCommand,
  canDraw,
  computePlayScore,
  createDeterministicRandom,
  createInitialState,
  generateFullSet,
  getLegalMoves,
  GAME_COMMAND_VERSION,
  shuffleDeterministically,
  simulatePlacement,
  startNewHand,
  type Config,
  type GameCommand,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import {
  createReviewPositionSnapshotV2,
  type ReviewAction,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';

export type GamePolicy = 'random' | 'score' | 'doubles' | 'branch';
export const POLICIES: readonly GamePolicy[] = ['random', 'score', 'doubles', 'branch'];

export type LoggedAction = {
  /** Flat 1-based index across the whole game, both seats, every command (play, draw, pass). */
  readonly index: number;
  readonly handNumber: number;
  readonly actor: string;
  readonly action: ReviewAction;
  /** Engine state immediately before the command. */
  readonly preState: GameState;
  readonly command: GameCommand;
  readonly snapshot: ReviewPositionSnapshotV2;
};

export type GeneratedGame = {
  readonly id: string;
  readonly actions: readonly LoggedAction[];
  readonly hands: number;
  readonly finalState: GameState;
  readonly policies: Readonly<Record<string, GamePolicy>>;
};

export const SEATS = ['you', 'bot'] as const;

const actionKey = (action: ReviewAction): string => JSON.stringify(action);

function chooseIndex(policy: GamePolicy, state: GameState, plays: ReturnType<typeof getLegalMoves>, rnd: ReturnType<typeof createDeterministicRandom>): number {
  if (plays.length === 1) return 0;
  const scored = plays.map((move, i) => {
    if (move.type !== 'play') return { i, score: 0, double: false, branch: false };
    const score = computePlayScore(simulatePlacement(state.board, move.tile, move.position), state.config);
    return { i, score, double: move.tile.low === move.tile.high, branch: String(move.position).startsWith('branch-') };
  });
  const pick = (pred: (s: (typeof scored)[number]) => boolean, rank: (s: (typeof scored)[number]) => number) => {
    const pool = scored.filter(pred);
    if (pool.length === 0) return null;
    const best = Math.max(...pool.map(rank));
    const top = pool.filter((s) => rank(s) === best);
    return top[rnd.nextInt(top.length)]!.i;
  };
  if (policy === 'score') return pick(() => true, (s) => s.score) ?? 0;
  if (policy === 'doubles') return pick((s) => s.double, (s) => s.score) ?? rnd.nextInt(plays.length);
  if (policy === 'branch') return pick((s) => s.branch, (s) => s.score) ?? rnd.nextInt(plays.length);
  return rnd.nextInt(plays.length);
}

const fullDeck = (seed: string): Tile[] => shuffleDeterministically(generateFullSet(6), createDeterministicRandom(seed));

export function makeGame(namespace: string, n: number, opts: { winningScore?: number; maxActions?: number; config?: Partial<Config> } = {}): GeneratedGame {
  const id = `${namespace}:${n}`;
  const rnd = createDeterministicRandom(`${id}:choices`);
  const policies: Record<string, GamePolicy> = {
    you: POLICIES[n % POLICIES.length]!,
    bot: POLICIES[(n >> 2) % POLICIES.length]!,
  };
  const winningScore = opts.winningScore ?? [25, 40, 60][n % 3]!;
  let state = createInitialState([...SEATS], { winningScore, ...opts.config });
  let handCounter = 0;
  const startHand = (s: GameState): GameState => {
    handCounter += 1;
    return startNewHand(s, fullDeck(`${id}:hand:${handCounter}`));
  };
  state = startHand(state);

  const actions: LoggedAction[] = [];
  const maxActions = opts.maxActions ?? 2_000;
  while (!state.gameOver && actions.length < maxActions) {
    if (state.handOver) {
      state = startHand(state);
      continue;
    }
    const actor = state.playerIds[state.currentPlayerIndex]!;
    const moves = getLegalMoves(state, actor);
    let action: ReviewAction;
    if (moves.length === 0) {
      if (!canDraw(state, actor)) throw new Error(`${id}: actor ${actor} has no legal play, cannot draw, and no pass is offered`);
      action = { kind: 'draw' };
    } else if (moves[0]!.type === 'pass') {
      action = { kind: 'pass' };
    } else {
      const move = moves[chooseIndex(policies[actor]!, state, moves, rnd)]!;
      if (move.type !== 'play') throw new Error(`${id}: expected a play`);
      action = { kind: 'play', tile: move.tile, position: move.position };
    }
    const base = { version: GAME_COMMAND_VERSION, commandId: `${id}:${actions.length + 1}`, sequence: state.sequence, actorId: actor } as const;
    const command: GameCommand = action.kind === 'play'
      ? { ...base, kind: 'play', tile: action.tile, position: action.position }
      : { ...base, kind: action.kind };
    const index = actions.length + 1;
    const snapshot = createReviewPositionSnapshotV2({
      authorityPreState: state,
      command,
      identifiers: {
        sessionId: id, gameId: id, handId: `hand-${state.handNumber}`, decisionId: `${id}:${actor}:${index}`,
        mode: 'play-vs-fritz', gameNumber: 1, actionNumber: index,
      },
      knownMissingPipEvidence: [],
    });
    actions.push({ index, handNumber: state.handNumber, actor, action, preState: state, command, snapshot });
    state = applyGameCommand(state, command).state;
  }
  if (!state.gameOver && !state.handOver) throw new Error(`${id}: did not finish within ${maxActions} actions`);
  return { id, actions, hands: handCounter, finalState: state, policies };
}

export { actionKey };
