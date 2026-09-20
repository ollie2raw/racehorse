/** Reconstructs positions from committed seed + played-action records; never re-runs a policy. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyGameCommand, createDeterministicRandom, createInitialState, DEFAULT_CONFIG, generateFullSet,
  getOpenEnds, shuffleDeterministically, startNewHand, type GameCommand, type GameState } from '@racehorse/game-core';
import { createReviewPositionSnapshotV2, type ReviewEvaluationV1, type ReviewKnownMissingPipEvidence,
  type ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';

export type RecordedPosition = { snapshot: ReviewPositionSnapshotV2; evaluation: ReviewEvaluationV1; file: string };
type Row = { seed: string; gameIndex: number; handNumber: number; moveNumber: number; actorId: string; evaluation: ReviewEvaluationV1 };

export function replayRecordedSelfPlay(directory: string): RecordedPosition[] {
  const positions: RecordedPosition[] = [];
  const deck = (seed: string) => shuffleDeterministically(generateFullSet(DEFAULT_CONFIG.maxPips), createDeterministicRandom(seed));
  for (const file of readdirSync(directory).filter(name => name.endsWith('.jsonl')).sort()) {
    const rows = readFileSync(join(directory, file), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Row);
    let state: GameState | undefined;
    let lastGame = '';
    let evidence: ReviewKnownMissingPipEvidence[] = [];
    for (const row of rows) {
      const game = `${row.seed}:game${row.gameIndex}`;
      if (lastGame !== game) {
        if (state && !state.gameOver) throw new Error(`Incomplete recorded game: ${lastGame}`);
        state = startNewHand(createInitialState(['player', 'opponent'], DEFAULT_CONFIG), deck(`${game}:hand1`));
        evidence = [];
        lastGame = game;
      }
      if (!state) throw new Error('Missing initial state.');
      if (state.handOver) { state = startNewHand(state, deck(`${game}:hand${state.handNumber + 1}`)); evidence = []; }
      const actorId = state.playerIds[state.currentPlayerIndex];
      if (actorId !== row.actorId || state.handNumber !== row.handNumber) throw new Error(`Recorded cursor mismatch: ${game}:${row.moveNumber}`);
      const opponentId = state.playerIds.find(id => id !== actorId)!;
      const command: GameCommand = { version: 1, commandId: `replay:${game}:${row.moveNumber}`, sequence: state.sequence,
        actorId, ...row.evaluation.played.action };
      const snapshot = createReviewPositionSnapshotV2({ authorityPreState: state, command,
        identifiers: { sessionId: `self-play:${row.seed}:${row.gameIndex}`, gameId: `self-play:${row.seed}:${row.gameIndex}`,
          handId: `self-play:${row.seed}:${row.gameIndex}:hand-${row.handNumber}`, decisionId: row.evaluation.snapshotId,
          mode: 'fixture', gameNumber: 1, actionNumber: row.moveNumber },
        knownMissingPipEvidence: evidence.filter(item => item.opponentId === opponentId) });
      positions.push({ snapshot, evaluation: row.evaluation, file });
      if (command.kind === 'pass' || command.kind === 'draw') {
        const openEnds = getOpenEnds(state.board).map(end => end.matchValue);
        for (const pip of new Set(openEnds)) evidence.push({ opponentId: actorId, pip,
          reason: command.kind === 'pass' ? 'passed_on_open_end' : 'drew_past_open_end',
          observedHandNumber: state.handNumber, observedSequence: state.sequence, openEnds });
      }
      state = applyGameCommand(state, command).state;
    }
    if (!state?.gameOver) throw new Error(`Incomplete corpus file: ${file}`);
  }
  return positions;
}
