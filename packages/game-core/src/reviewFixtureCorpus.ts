import { applyGameCommand, type GameCommand } from './commands';
import { canDraw, getLegalMoves } from './engine';
import { collectGameStateViolations } from './invariants';
import { createDeterministicDoubleSixDeal } from './random';
import { computePlayScore, getOpenEnds } from './scoring';
import {
  createReviewPositionSnapshotV2,
  type ReviewAction,
  type ReviewKnownMissingPipEvidence,
  type ReviewReplayFixture,
} from './reviewContracts';
import { DEFAULT_CONFIG, type GameState, type PlayMove } from './types';

export type ReviewFixtureCategory =
  | 'opening'
  | 'scoring_chain'
  | 'forced_move'
  | 'block'
  | 'nested_branches'
  | 'near_win_defense'
  | 'hidden_information_ambiguity'
  | 'exact_endgame';

type FixtureStrategy = 'first_legal' | 'branch_builder';

type ReviewFixtureSpec = {
  readonly id: string;
  readonly category: ReviewFixtureCategory;
  readonly description: string;
  readonly seed: string;
  readonly strategy: FixtureStrategy;
  readonly actionIndex: number;
  readonly expected: {
    readonly preDigest: string;
    readonly postDigest: string;
    readonly action: ReviewAction;
    readonly immediatePoints: number;
  };
};

export type ReviewCorpusFixture = ReviewReplayFixture & {
  readonly id: string;
  readonly category: ReviewFixtureCategory;
  readonly description: string;
  readonly provenance: {
    readonly kind: 'deterministic-game-log';
    readonly seed: string;
    readonly strategy: FixtureStrategy;
    readonly selectedActionIndex: number;
    readonly startingHandNumber: 4;
    readonly startingScores: { readonly player: 48; readonly opponent: 52 };
  };
};

/**
 * These checkpoints were selected from complete deterministic double-six games
 * driven only through applyGameCommand. They are not hand-authored board states.
 */
const FIXTURE_SPECS: readonly ReviewFixtureSpec[] = [
  {
    id: 'opening-double-from-live-deal',
    category: 'opening',
    description: 'Opening decision from a full deterministic deal with the boneyard still deep.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 0,
    expected: {
      preDigest: 'review-state-v1:c30d678c',
      postDigest: 'review-state-v1:4d4f0a3e',
      action: { kind: 'play', tile: { low: 0, high: 0 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'near-win-multi-choice-defense',
    category: 'near_win_defense',
    description: 'Player at 48 faces an opponent at 52 with four legal replies and a 60-point target.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 1,
    expected: {
      preDigest: 'review-state-v1:4d4f0a3e',
      postDigest: 'review-state-v1:f3a11745',
      action: { kind: 'play', tile: { low: 0, high: 3 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'hidden-allocation-ambiguous-midgame',
    category: 'hidden_information_ambiguity',
    description: 'Opponent decision with three legal plays, a large unknown hand, and twelve drawable tiles.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 2,
    expected: {
      preDigest: 'review-state-v1:f3a11745',
      postDigest: 'review-state-v1:84cd277a',
      action: { kind: 'play', tile: { low: 3, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'forced-single-play-midgame',
    category: 'forced_move',
    description: 'Non-opening midgame position with exactly one legal placement.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 6,
    expected: {
      preDigest: 'review-state-v1:9cea7927',
      postDigest: 'review-state-v1:245b6a81',
      action: { kind: 'play', tile: { low: 0, high: 4 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'scoring-branch-chain',
    category: 'scoring_chain',
    description: 'A branch play scores two Racehorse points and retains the turn.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 13,
    expected: {
      preDigest: 'review-state-v1:2358c46c',
      postDigest: 'review-state-v1:54629f60',
      action: { kind: 'play', tile: { low: 4, high: 6 }, position: 'branch-0-0' },
      immediatePoints: 2,
    },
  },
  {
    id: 'nested-branch-decision',
    category: 'nested_branches',
    description: 'A live-game position with three hubs, including doubles created on branch lanes.',
    seed: 'review-corpus:1',
    strategy: 'branch_builder',
    actionIndex: 12,
    expected: {
      preDigest: 'review-state-v1:aa88f0cd',
      postDigest: 'review-state-v1:9030c47a',
      action: { kind: 'play', tile: { low: 0, high: 3 }, position: 'branch-0-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'locked-yard-five-tile-endgame',
    category: 'exact_endgame',
    description: 'Five total hand tiles remain, the drawable yard is locked, and three plays are legal.',
    seed: 'review-corpus:2',
    strategy: 'first_legal',
    actionIndex: 26,
    expected: {
      preDigest: 'review-state-v1:2e7cd3e8',
      postDigest: 'review-state-v1:82f6a9eb',
      action: { kind: 'play', tile: { low: 2, high: 6 }, position: 'branch-1-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'second-pass-blocks-hand',
    category: 'block',
    description: 'The locked-yard second consecutive pass resolves a physically valid blocked hand.',
    seed: 'review-corpus:26',
    strategy: 'first_legal',
    actionIndex: 33,
    expected: {
      preDigest: 'review-state-v1:b6055141',
      postDigest: 'review-state-v1:5b13d910',
      action: { kind: 'pass' },
      immediatePoints: 0,
    },
  },
] as const;

function createFixtureInitialState(seed: string): GameState {
  const deal = createDeterministicDoubleSixDeal({ seed, tilesPerPlayer: 7 });
  return {
    config: { ...DEFAULT_CONFIG },
    playerIds: ['player', 'opponent'],
    players: {
      player: { id: 'player', hand: deal.playerTiles, score: 48 },
      opponent: { id: 'opponent', hand: deal.opponentTiles, score: 52 },
    },
    board: null,
    boneyard: deal.boneyard,
    deadTiles: deal.deadTiles,
    currentPlayerIndex: 0,
    handNumber: 4,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 40,
    handStarters: ['opponent', 'player', 'opponent', 'player'],
  };
}

function chooseFixtureCommand(state: GameState, strategy: FixtureStrategy): GameCommand {
  const actorId = state.playerIds[state.currentPlayerIndex];
  const legal = getLegalMoves(state, actorId);
  const plays = legal.filter((move): move is PlayMove => move.type === 'play');

  if (plays.length > 0) {
    const ranked = plays
      .map((move) => {
        const preview = applyGameCommand(state, {
          version: 1,
          commandId: `fixture-preview:${state.sequence}`,
          sequence: state.sequence,
          actorId,
          kind: 'play',
          tile: move.tile,
          position: move.position,
        }).state;
        const strategyScore = strategy === 'branch_builder'
          ? (move.position.startsWith('branch-') ? 1_000 : 0)
            + (move.tile.low === move.tile.high ? 500 : 0)
            + (preview.board?.hubDoubles.filter((hub) => hub.laneType === 'branch').length ?? 0) * 300
            + (preview.board ? computePlayScore(preview.board, state.config) * 50 : 0)
          : 0;
        return { move, strategyScore };
      })
      .sort((a, b) =>
        b.strategyScore - a.strategyScore
        || a.move.position.localeCompare(b.move.position)
        || a.move.tile.low - b.move.tile.low
        || a.move.tile.high - b.move.tile.high,
      );
    const move = ranked[0].move;
    return {
      version: 1,
      commandId: `fixture:${state.sequence}`,
      sequence: state.sequence,
      actorId,
      kind: 'play',
      tile: move.tile,
      position: move.position,
    };
  }

  if (legal.some((move) => move.type === 'pass')) {
    return {
      version: 1,
      commandId: `fixture:${state.sequence}`,
      sequence: state.sequence,
      actorId,
      kind: 'pass',
    };
  }

  if (!canDraw(state, actorId)) throw new Error(`Fixture log has no legal action at sequence ${state.sequence}.`);
  return {
    version: 1,
    commandId: `fixture:${state.sequence}`,
    sequence: state.sequence,
    actorId,
    kind: 'draw',
  };
}

function recordMissingPipEvidence(
  state: GameState,
  command: GameCommand,
  evidence: ReviewKnownMissingPipEvidence[],
): void {
  if (command.kind !== 'draw' && command.kind !== 'pass') return;
  const openEnds = getOpenEnds(state.board).map((end) => end.matchValue);
  for (const pip of new Set(openEnds)) {
    evidence.push({
      opponentId: command.actorId,
      pip,
      reason: command.kind === 'pass' ? 'passed_on_open_end' : 'drew_past_open_end',
      observedHandNumber: state.handNumber,
      observedSequence: state.sequence,
      openEnds,
    });
  }
}

function buildFixture(spec: ReviewFixtureSpec): ReviewCorpusFixture {
  let state = createFixtureInitialState(spec.seed);
  const evidence: ReviewKnownMissingPipEvidence[] = [];

  for (let actionIndex = 0; actionIndex <= spec.actionIndex; actionIndex += 1) {
    if (state.handOver || state.gameOver) {
      throw new Error(`${spec.id} terminated before selected action ${spec.actionIndex}.`);
    }
    const command = chooseFixtureCommand(state, spec.strategy);
    if (actionIndex === spec.actionIndex) {
      const opponentId = state.playerIds.find((id) => id !== command.actorId)!;
      const snapshot = createReviewPositionSnapshotV2({
        authorityPreState: state,
        command,
        identifiers: {
          sessionId: `fixture-session:${spec.seed}`,
          gameId: `fixture-game:${spec.seed}`,
          handId: `fixture-game:${spec.seed}:hand-${state.handNumber}`,
          decisionId: spec.id,
          mode: 'fixture',
          gameNumber: 1,
          actionNumber: actionIndex + 1,
        },
        knownMissingPipEvidence: evidence.filter((item) => item.opponentId === opponentId),
      });
      if (
        snapshot.integrity.authorityPreStateDigest !== spec.expected.preDigest
        || snapshot.integrity.authorityPostStateDigest !== spec.expected.postDigest
        || JSON.stringify(snapshot.actualAction) !== JSON.stringify(spec.expected.action)
        || snapshot.outcome.immediatePoints !== spec.expected.immediatePoints
      ) {
        throw new Error(`${spec.id} drifted from its checked-in game-log checkpoint.`);
      }
      return {
        id: spec.id,
        category: spec.category,
        description: spec.description,
        snapshot,
        authorityPreState: state,
        provenance: {
          kind: 'deterministic-game-log',
          seed: spec.seed,
          strategy: spec.strategy,
          selectedActionIndex: spec.actionIndex,
          startingHandNumber: 4,
          startingScores: { player: 48, opponent: 52 },
        },
      };
    }
    recordMissingPipEvidence(state, command, evidence);
    state = applyGameCommand(state, command).state;
    const violations = collectGameStateViolations(state);
    if (violations.length > 0) throw new Error(`${spec.id} generated invalid state: ${violations.join('; ')}`);
  }
  throw new Error(`Fixture ${spec.id} did not reach its selected action.`);
}

export const REVIEW_FIXTURE_CORPUS: readonly ReviewCorpusFixture[] = FIXTURE_SPECS.map(buildFixture);
