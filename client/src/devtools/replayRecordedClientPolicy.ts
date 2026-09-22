/** Reconstruct committed client-policy games from seeds and actions, never from policy reruns. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createDeterministicDoubleSixDeal, type GameCommand } from '@racehorse/game-core';
import type { ReviewCaptureRecord } from '@racehorse/review-engine';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { applyPlayMove, createFixedBotMatch, drawOne, passTurn, startNextFixedBotHand,
  type BotMatchState } from '../modules/match/runtime/botEngine.ts';
import { captureReviewSnapshotAtDecision } from '../modules/review/captureReviewSnapshotAtDecision.ts';
import { observeActorDrawPastOpenEnds, observeActorPassOnOpenEnds } from '../modules/review/missingPipEvidenceAccumulate.ts';

export type RecordedPosition = { snapshot: ReviewPositionSnapshotV2; evaluation: ReviewEvaluationV1; file: string };

function deal(seed: string, handNumber: number) {
  const value = createDeterministicDoubleSixDeal({ seed: `${seed}:h${handNumber}`, tilesPerPlayer: 7, deadTileCount: 2 });
  return { player_tiles: [...value.playerTiles], fritz_tiles: [...value.opponentTiles],
    boneyard: [...value.boneyard], locked: [...value.deadTiles] };
}

export function replayRecordedClientPolicy(directory: string): RecordedPosition[] {
  const positions: RecordedPosition[] = [];
  for (const file of readdirSync(directory).filter(file => file.endsWith('.jsonl')).sort()) {
    const records = readFileSync(join(directory, file), 'utf8').trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as ReviewCaptureRecord);
    let state: BotMatchState | undefined;
    let currentGame = '';
    let expectedMove = 1;
    for (const row of records) {
      const game = `${row.seed}:game${row.gameIndex}`;
      if (game !== currentGame) {
        if (state && !state.gameOver) throw new Error(`Incomplete recorded game before ${game}`);
        state = createFixedBotMatch(deal(game, 1)); currentGame = game; expectedMove = 1;
      }
      if (!state) throw new Error('Missing initial state');
      if (state.handOver && !state.gameOver) state = startNextFixedBotHand(state, deal(game, state.handNumber + 1));
      if (state.gameOver || state.handNumber !== row.handNumber || state.currentPlayer !== row.actorId || row.moveNumber !== expectedMove++) {
        throw new Error(`Recorded cursor mismatch: ${file}:${row.moveNumber}`);
      }
      const actor = state.currentPlayer;
      const action = row.evaluation.played.action;
      if (action.kind === 'draw') state = observeActorDrawPastOpenEnds(state, actor);
      if (action.kind === 'pass') state = observeActorPassOnOpenEnds(state, actor);
      const command: GameCommand = { version: 1, commandId: `recorded-replay:${game}:${row.moveNumber}`,
        sequence: state.turnIndex ?? 0, actorId: actor, ...action };
      const snapshot = captureReviewSnapshotAtDecision({ preState: state, command, identifiers: {
        sessionId: `client-policy:${row.seed}:${row.gameIndex}`, gameId: `client-policy:${row.seed}:${row.gameIndex}`,
        handId: `client-policy:${row.seed}:${row.gameIndex}:hand-${row.handNumber}`,
        decisionId: row.evaluation.snapshotId, mode: 'fixture', gameNumber: 1, actionNumber: row.moveNumber,
      } });
      if (snapshot.outcome.immediatePoints !== row.evaluation.played.immediatePoints) {
        throw new Error(`Recorded immediate-score mismatch: ${row.evaluation.snapshotId}`);
      }
      positions.push({ snapshot, evaluation: row.evaluation, file });
      state = action.kind === 'play'
        ? applyPlayMove(state, actor, { type: 'play', tile: action.tile, position: action.position }).state
        : action.kind === 'draw' ? drawOne(state, actor).state : passTurn(state, actor).state;
    }
    if (state && !state.gameOver) throw new Error(`Incomplete final recorded game: ${file}`);
  }
  return positions;
}
