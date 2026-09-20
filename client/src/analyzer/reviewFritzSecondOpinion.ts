import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { createFixedBotMatch, type BotMatchState } from '../modules/match/runtime/botEngine.ts';
import { chooseBotMove, toBotVisibleState } from '../modules/fritz/botHeuristics.ts';

/**
 * REFERENCE-MOVE POLICY (feat/review-positional-features build brief):
 * search tier must ALWAYS additionally compute "Fritz Master would play X"
 * as a second opinion, and heuristic tier's reference move IS Fritz's move
 * (never the oracle's own `solveHeuristicOpening` candidate, which is a
 * *ported approximation* of Fritz's leaf heuristics -- see that file's own
 * header comment -- not the real `chooseBotMove` policy).
 *
 * This must compute Fritz's choice "against the same public+actor-known
 * information, not by cheating with hidden info". `chooseBotMove` always
 * decides for the `'bot'` seat of a `BotMatchState`/`BotVisibleState`; to
 * get Fritz's opinion for the snapshot's actual actor, this builds a
 * `BotMatchState` with the actor's real hand in the `'bot'` seat and the
 * opponent ('you') seat given ONLY a tile count (via `toBotVisibleState`,
 * which reads `players.you.hand.length` for `opponentTileCount` and then
 * discards the array's actual contents -- see botHeuristics.ts's own
 * `toBotVisibleState`). The dummy tiles below are never read for their
 * identity, only counted -- the same non-cheating contract
 * `client/src/analyzer/moveAnalyzer.ts`'s existing `buildPlaceholderEvalState`
 * already relies on for its own `chooseBotMove` calls.
 *
 * Architecture note: this file lives in `client/src/analyzer`, not
 * `packages/review-engine`, because `chooseBotMove` requires
 * `client/src/modules/fritz/botHeuristics.ts` (a `BotMatchState`-coupled
 * module) -- review-engine cannot depend on client code (confirmed in
 * `recordSelfPlayCorpus.ts`'s own header comment on this exact boundary).
 *
 * Endgame cross-check (build brief item 2's caveat): once
 * `totalTiles <= 16`, `chooseBotMove`'s 'master'/'hard' difficulties route
 * through an exact/near-exact chain search and, at the real master-endgame
 * threshold, a Monte-Carlo-sampled-hands `minimaxFull` search (both in
 * `botHeuristics.ts`) -- NOT the single-ply `evaluateStrategicMove`
 * heuristic breakdown `solveHeuristicOpening.ts` ports. In that regime, the
 * `PositionalFeatures` this module's caller computes for Fritz's chosen
 * move describe the position honestly, but they are not why Fritz chose it
 * -- the real reason is the minimax search's outcome, which has no
 * feature-level breakdown to surface. Callers must not present
 * "Fritz's read" prose in that regime as if the listed features were
 * Fritz's actual reasoning; see reviewCoachingProse.ts's
 * ENDGAME_MINIMAX_TILE_THRESHOLD.
 */
export const ENDGAME_MINIMAX_TILE_THRESHOLD = 16;

function dummyTiles(count: number): { low: number; high: number }[] {
  return new Array(Math.max(0, count)).fill(null).map(() => ({ low: 0, high: 0 }));
}

/**
 * Builds a fair, non-cheating `BotMatchState` from a `ReviewPositionSnapshotV2`,
 * with the snapshot's actor in the `'bot'` seat (the seat `chooseBotMove`
 * always decides for) so Fritz's real move-selection policy can be run
 * against this exact decision point.
 */
export function buildBotMatchStateFromReviewSnapshot(snapshot: ReviewPositionSnapshotV2): BotMatchState {
  const { preAction } = snapshot;
  const template = createFixedBotMatch({ player_tiles: dummyTiles(preAction.opponentTileCount),
    fritz_tiles: [...preAction.actorHand], boneyard: dummyTiles(preAction.boneyard.drawableCount),
    locked: dummyTiles(preAction.boneyard.deadCount) }, preAction.winningTarget);
  return {
    ...template,
    board: preAction.board as unknown as BotMatchState['board'],
    currentPlayer: 'bot',
    handNumber: snapshot.identifiers.handNumber,
    turnIndex: snapshot.identifiers.turnSequence,
    opponentKnownMissing: [...new Set(preAction.knownMissingPipEvidence.map(item => item.pip))],
    opponentMissingEvidence: preAction.knownMissingPipEvidence.map(item => ({ pip: item.pip,
      handNumber: item.observedHandNumber, turnIndex: item.observedSequence })),
    handOpen: preAction.handOpen,
    handOver: false,
    gameOver: false,
    winningScore: preAction.winningTarget,
    consecutivePasses: preAction.consecutivePasses,
    // Length-only: canDraw/dead-tile accounting reads boneyard.length, not
    // tile identity. physicalCount already excludes nothing hidden -- it's
    // a public count on the snapshot.
    boneyard: dummyTiles(preAction.boneyard.physicalCount),
    players: {
      bot: {
        ...template.players.bot,
        hand: [...preAction.actorHand],
        score: preAction.scores.actor,
      },
      you: {
        ...template.players.you,
        // Length-only per this file's header comment -- toBotVisibleState
        // reads .length for opponentTileCount, then replaces the array
        // contents entirely before anything in chooseBotMove can see it.
        hand: dummyTiles(preAction.opponentTileCount),
        score: preAction.scores.opponent,
      },
    },
  };
}

export type FritzSecondOpinion = {
  readonly action: ReviewAction;
  readonly immediatePoints: number;
  /** True once `chooseBotMove` has crossed into the minimax-endgame regime -- see this file's header comment. */
  readonly isMinimaxEndgame: boolean;
};

/**
 * Computes Fritz Master's move for this exact decision point via the real
 * `chooseBotMove` policy (not a re-derived heuristic). Returns `null` only
 * when `chooseBotMove` finds no legal play -- `ReviewAction`'s `pass`/
 * `draw` split in that case is forced by the rules (drawable yard present
 * or not), not a Fritz "choice", matching `solveHeuristicOpening.ts`'s own
 * treatment of non-play actions as having no strategic content to model.
 */
export function computeFritzReferenceMove(snapshot: ReviewPositionSnapshotV2): FritzSecondOpinion | null {
  const evalState = buildBotMatchStateFromReviewSnapshot(snapshot);
  const totalTiles = snapshot.preAction.actorHand.length + snapshot.preAction.opponentTileCount;
  const choice = chooseBotMove(toBotVisibleState(evalState), 'master');

  if (!choice || choice.move.type !== 'play' || !choice.move.tile || !choice.move.position) {
    return {
      action: snapshot.preAction.boneyard.drawableCount > 0 ? { kind: 'draw' } : { kind: 'pass' },
      immediatePoints: 0,
      isMinimaxEndgame: totalTiles <= ENDGAME_MINIMAX_TILE_THRESHOLD,
    };
  }

  return {
    action: { kind: 'play', tile: choice.move.tile, position: choice.move.position },
    immediatePoints: choice.breakdown.immediate,
    isMinimaxEndgame: totalTiles <= ENDGAME_MINIMAX_TILE_THRESHOLD,
  };
}
