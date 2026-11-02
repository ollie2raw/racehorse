import { createDeterministicDoubleSixDeal } from '@racehorse/game-core';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { PlacementPosition, Tile } from '../../types.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import {
  createFixedBotMatchWithStarter,
  startNextBotHand,
  type BotDealSize,
  type BotMatchState,
  type BotPlayerId,
} from '../match/runtime/botEngine.ts';
import type { RecordMoveEntry } from '../ghost/ghostMatchHelpers.ts';
import type { ReviewSnapshotRecorder, ReviewActorAction } from './ReviewSnapshotRecorder.ts';
import { createReplayStepper } from './replayStepper.ts';

/**
 * A saved game record as the server returns it (docs/review-game-record-architecture.md, Phase 3): the settings, the
 * server-issued deal seed, the ordered actions and the result. Nothing derived is stored in it.
 */
export type SavedGameRecord = {
  sourceMatchId: string;
  mode: 'pvf';
  fritzTier: string | null;
  dealSize: 7 | 14 | null;
  winningScore: number | null;
  matchStarter: 'you' | 'bot' | null;
  dealSeed: string | null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  moves: RecordMoveEntry[];
  verification: 'replay_verified' | 'replay_mismatch' | 'unverified';
  playedAt: string | null;
};

export type RebuiltGame = {
  /** The move log the analyzer consumes, as production logs it (a run of draws collapses to its first draw's row). */
  moveLog: MoveEntry[];
  /** One V2 snapshot per action, both seats, captured by the same recorder the live game uses. */
  snapshots: ReviewPositionSnapshotV2[];
  /** The engine state after the last action. */
  finalState: BotMatchState;
  /** The recorder that captured `snapshots`: hand it to the review hook exactly as the live match does. */
  recorder: ReviewSnapshotRecorder;
};

export type RebuildFailureReason =
  | 'no_deal_seed'
  | 'not_replayable'
  | 'incomplete_game'
  | 'result_mismatch';

export type RebuildResult =
  | { ok: true; game: RebuiltGame }
  | { ok: false; reason: RebuildFailureReason; detail: string; entryIndex?: number };

const fail = (reason: RebuildFailureReason, detail: string, entryIndex?: number): RebuildResult => ({
  ok: false,
  reason,
  detail,
  entryIndex,
});

function parseTile(key: string | null): Tile | null {
  if (!key) return null;
  const [low, high] = key.split('|').map(Number);
  return Number.isInteger(low) && Number.isInteger(high) ? { low: low!, high: high! } : null;
}

function firstHandDeal(seed: string, dealSize: BotDealSize) {
  const dealt = createDeterministicDoubleSixDeal({
    seed: `${seed}:h1`,
    tilesPerPlayer: dealSize,
    deadTileCount: dealSize === 14 ? 0 : 2,
  });
  return {
    player_tiles: [...dealt.playerTiles],
    fritz_tiles: [...dealt.opponentTiles],
    boneyard: [...dealt.boneyard],
    locked: [...dealt.deadTiles],
  };
}

/**
 * Replay a saved game from its record, through the same engine and the same snapshot recorder the live match uses, and
 * hand back the inputs the existing review pipeline wants. Every step is checked: the actor must be on turn, the move
 * must be legal, the game must finish, and the final score must equal the record's. Anything else is an honest
 * failure, never a guess.
 *
 * Decision ids are `<sourceMatchId>:<actor>:<n>`, so rebuilding the same record always yields the same ids (and the
 * same game digest, hence the same review job).
 */
export function rebuildGameFromRecord(record: SavedGameRecord): RebuildResult {
  if (!record.dealSeed) return fail('no_deal_seed', 'The record has no server-issued deal seed, so it cannot be replayed.');
  const dealSize: BotDealSize = record.dealSize === 14 ? 14 : 7;
  const winningScore = record.winningScore ?? 60;
  const starter: BotPlayerId = record.matchStarter === 'bot' ? 'bot' : 'you';

  let state: BotMatchState = {
    ...createFixedBotMatchWithStarter(firstHandDeal(record.dealSeed, dealSize), starter, winningScore, dealSize),
    dealSeed: record.dealSeed,
  };
  const stepper = createReplayStepper(record.sourceMatchId);
  const { moveLog, snapshots, recorder } = stepper;

  for (let i = 0; i < record.moves.length; i += 1) {
    const entry = record.moves[i]!;
    if (state.gameOver) return fail('not_replayable', 'The record continues after the game is over.', i);
    if (state.handOver) state = startNextBotHand(state);
    const actor: BotPlayerId = entry.actor === 'you' ? 'you' : 'bot';
    const branch = entry.branch ?? null;
    const tile = parseTile(entry.tile_played);

    let action: ReviewActorAction;
    if (branch === 'draw') action = { kind: 'draw' };
    else if (branch === 'pass') action = { kind: 'pass' };
    else if (tile && branch) action = { kind: 'play', tile, position: branch as PlacementPosition };
    else return fail('not_replayable', 'An action is neither a play, a draw nor a pass.', i);

    if (state.currentPlayer !== actor) {
      // The server's replayer ignores a pass logged by a seat that is not on turn (an engine-implied pass), so a record it
      // verified must rebuild here too. Any other off-turn action is a real inconsistency.
      if (action.kind === 'pass') continue;
      return fail('not_replayable', `${actor} acted but it was ${state.currentPlayer}'s turn.`, i);
    }

    const stepped = stepper.step(state, actor, action);
    if (!stepped.ok) return fail('not_replayable', stepped.detail, i);
    state = stepped.state;
  }

  if (!state.gameOver) return fail('incomplete_game', 'The record does not finish the game.');
  if (state.players.you.score !== record.result.you || state.players.bot.score !== record.result.opponent) {
    return fail(
      'result_mismatch',
      `The replay ended ${state.players.you.score}-${state.players.bot.score}, the record says ${record.result.you}-${record.result.opponent}.`,
    );
  }
  return { ok: true, game: { moveLog, snapshots, finalState: state, recorder } };
}
