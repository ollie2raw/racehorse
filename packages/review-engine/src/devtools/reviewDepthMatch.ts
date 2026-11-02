/**
 * Does searching one ply deeper actually pick better moves? Two players use the review engine as their move chooser, identical except for search depth
 * (same 2,500 sampled hidden states, same node budget): "d2" looks 2 plies ahead (its move, the reply), "d3" looks 3. They play complete games to 60 on
 * IDENTICAL deals with the seats swapped, so luck of the deal cancels in pairs. Each only ever sees what a player legally sees (the review snapshot is built
 * from the public position plus the player's own hand).
 *
 * Writes one JSON line per game; `reviewDepthMatchSummary.ts` aggregates shards. Manually invoked:
 *   npx tsx src/devtools/reviewDepthMatch.ts <shardIndex> <dealsPerShard> <outFile> [depthA=2] [depthB=3]
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import {
  applyGameCommand,
  chooseOfficialFritzDecision,
  createDeterministicRandom,
  createInitialState,
  DEFAULT_CONFIG,
  generateFullSet,
  getOpenEnds,
  shuffleDeterministically,
  startNewHand,
  type GameCommand,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import { createReviewPositionSnapshotV2, type ReviewKnownMissingPipEvidence } from '@racehorse/game-core/review';
import { evaluateReviewPosition } from '../evaluateReviewPosition';

const shard = Number(process.argv[2] ?? '0');
const deals = Number(process.argv[3] ?? '10');
const outFile = process.argv[4] ?? `depth-match-shard-${shard}.jsonl`;
const depthA = Number(process.argv[5] ?? '2');
const depthB = Number(process.argv[6] ?? '3');

const deck = (seed: string): Tile[] => shuffleDeterministically(generateFullSet(DEFAULT_CONFIG.maxPips), createDeterministicRandom(seed));

type Policy = { name: string; depth: number };

function chooseWithDepth(state: GameState, actorId: string, depth: number, seed: string, evidence: ReviewKnownMissingPipEvidence[], tag: string): GameCommand {
  const opponentId = state.playerIds.find((id) => id !== actorId)!;
  // A legal provisional command (any legal action works for building the snapshot); the evaluation then ranks ALL legal actions.
  const provisional = chooseOfficialFritzDecision({ state, participantId: actorId, tier: 'standard' });
  const toCommand = (d: { kind: string; tile?: Tile; position?: unknown }, id: string): GameCommand =>
    (d.kind === 'play'
      ? { version: 1, commandId: id, sequence: state.sequence, actorId, kind: 'play', tile: d.tile!, position: d.position }
      : { version: 1, commandId: id, sequence: state.sequence, actorId, kind: d.kind }) as GameCommand;
  const snapshot = createReviewPositionSnapshotV2({
    authorityPreState: state,
    command: toCommand(provisional as never, `${tag}:prov`),
    identifiers: { sessionId: tag, gameId: tag, handId: `${tag}:h${state.handNumber}`, decisionId: `${tag}:${state.sequence}`, mode: 'fixture', gameNumber: 1, actionNumber: state.sequence },
    knownMissingPipEvidence: evidence.filter((item) => item.opponentId === opponentId),
  });
  if (snapshot.legalActions.length <= 1) return toCommand(provisional as never, `${tag}:${state.sequence}`);
  const evaluation = evaluateReviewPosition(
    snapshot,
    { maxNodes: 5_000_000, maxHiddenStateSamples: 2500, maxPlyDepth: depth, seed },
    0.02,
    () => 0,
  );
  const best = evaluation.best.action;
  return toCommand(best as never, `${tag}:${state.sequence}`);
}

function playGame(seed: string, players: Record<string, Policy>): { winner: string; scores: Record<string, number> } {
  let state: GameState = createInitialState(['player', 'opponent'], DEFAULT_CONFIG);
  state = startNewHand(state, deck(`${seed}:hand1`));
  let evidence: ReviewKnownMissingPipEvidence[] = [];
  for (let i = 0; i < 4000 && !state.gameOver; i += 1) {
    if (state.handOver) {
      state = startNewHand(state, deck(`${seed}:hand${state.handNumber + 1}`));
      evidence = [];
      continue;
    }
    const actorId = state.playerIds[state.currentPlayerIndex];
    const command = chooseWithDepth(state, actorId, players[actorId]!.depth, `${seed}:${actorId}`, evidence, `${seed}:${actorId}:${i}`);
    if (command.kind === 'draw' || command.kind === 'pass') {
      const openEnds = getOpenEnds(state.board).map((end) => end.matchValue);
      for (const pip of new Set(openEnds)) {
        evidence.push({ opponentId: actorId, pip, reason: command.kind === 'pass' ? 'passed_on_open_end' : 'drew_past_open_end', observedHandNumber: state.handNumber, observedSequence: state.sequence, openEnds });
      }
    }
    state = applyGameCommand(state, command).state;
  }
  if (!state.gameOver) throw new Error(`game ${seed} did not finish`);
  const scores = Object.fromEntries(state.playerIds.map((id) => [id, state.players[id]!.score]));
  const winner = (state.winnerId ?? (scores.player! >= scores.opponent! ? 'player' : 'opponent')) as string;
  return { winner, scores };
}

writeFileSync(outFile, '');
for (let d = 0; d < deals; d += 1) {
  const dealSeed = `depth-match:s${shard}:d${d}`;
  for (const first of [depthA, depthB]) {
    const second = first === depthA ? depthB : depthA;
    const players: Record<string, Policy> = { player: { name: `d${first}`, depth: first }, opponent: { name: `d${second}`, depth: second } };
    const started = Date.now();
    const result = playGame(dealSeed, players);
    const winnerDepth = players[result.winner]!.depth;
    appendFileSync(outFile, JSON.stringify({
      dealSeed,
      seating: `d${first}-first`,
      winnerDepth,
      scoreDepthA: result.scores[Object.keys(players).find((k) => players[k]!.depth === depthA)!],
      scoreDepthB: result.scores[Object.keys(players).find((k) => players[k]!.depth === depthB)!],
      depthA,
      depthB,
      seconds: Math.round((Date.now() - started) / 1000),
    }) + '\n');
  }
  process.stderr.write(`shard ${shard}: ${d + 1}/${deals} deals\n`);
}
