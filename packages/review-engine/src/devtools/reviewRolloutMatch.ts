/**
 * Does choosing moves by the LONG view play better than the review's 2-ply score gap? Two players, on identical deals with seats swapped, games to 60:
 *
 *   "review2"  picks the review engine's top move (2 plies, 2,500 sampled hidden hands, leaf value = current score difference): what the review calls best today.
 *   "rollout"  plays every legal move out to the end of the hand against sampled opponent hands (both sides continuing with a fixed policy) and picks the best average.
 *
 * Each only sees what a player legally sees. Writes one JSON line per game in the same shape `reviewDepthMatchSummary.ts` reads (depthA = review2 = 2, depthB =
 * rollout = 3 as labels only). Manually invoked:
 *   npx tsx src/devtools/reviewRolloutMatch.ts <shardIndex> <deals> <outFile> [rolloutSamples=40]
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
import { createReviewPositionSnapshotV2, type ReviewAction, type ReviewKnownMissingPipEvidence } from '@racehorse/game-core/review';
import { evaluateReviewPosition } from '../evaluateReviewPosition';
import { rolloutGain, sampleAllocations } from './rolloutValue';

const shard = Number(process.argv[2] ?? '0');
const deals = Number(process.argv[3] ?? '10');
const outFile = process.argv[4] ?? `rollout-match-shard-${shard}.jsonl`;
const rolloutSamples = Number(process.argv[5] ?? '40');

type Kind = 'review2' | 'rollout';
const deck = (seed: string): Tile[] => shuffleDeterministically(generateFullSet(DEFAULT_CONFIG.maxPips), createDeterministicRandom(seed));

function choose(kind: Kind, state: GameState, actorId: string, seed: string, evidence: ReviewKnownMissingPipEvidence[], tag: string): GameCommand {
  const opponentId = state.playerIds.find((id) => id !== actorId)!;
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

  if (kind === 'review2') {
    const evaluation = evaluateReviewPosition(snapshot, { maxNodes: 5_000_000, maxHiddenStateSamples: 2500, maxPlyDepth: 2, seed }, 0.02, () => 0);
    return toCommand(evaluation.best.action as never, `${tag}:${state.sequence}`);
  }
  const allocs = sampleAllocations(snapshot, seed, rolloutSamples);
  if (allocs.length === 0) return toCommand(provisional as never, `${tag}:${state.sequence}`);
  let best: ReviewAction = snapshot.legalActions[0]!;
  let bestValue = -Infinity;
  for (const action of snapshot.legalActions) {
    const value = allocs.reduce((s, a) => s + rolloutGain(snapshot, a, action, 'standard'), 0) / allocs.length;
    if (value > bestValue) { bestValue = value; best = action; }
  }
  return toCommand(best as never, `${tag}:${state.sequence}`);
}

function playGame(seed: string, players: Record<string, Kind>): { winner: string; scores: Record<string, number> } {
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
    const command = choose(players[actorId]!, state, actorId, `${seed}:${actorId}`, evidence, `${seed}:${actorId}:${i}`);
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
const label: Record<Kind, number> = { review2: 2, rollout: 3 };
for (let d = 0; d < deals; d += 1) {
  const dealSeed = `rollout-match:s${shard}:d${d}`;
  for (const first of ['review2', 'rollout'] as const) {
    const second: Kind = first === 'review2' ? 'rollout' : 'review2';
    const players: Record<string, Kind> = { player: first, opponent: second };
    const started = Date.now();
    const result = playGame(dealSeed, players);
    const winnerKind = players[result.winner]!;
    const scoreOf = (k: Kind) => result.scores[Object.keys(players).find((p) => players[p] === k)!]!;
    appendFileSync(outFile, JSON.stringify({
      dealSeed,
      seating: `${first}-first`,
      winnerDepth: label[winnerKind],
      scoreDepthA: scoreOf('review2'),
      scoreDepthB: scoreOf('rollout'),
      depthA: 2,
      depthB: 3,
      labelA: 'review (2-ply score gap)',
      labelB: 'rollout (play to end of hand)',
      seconds: Math.round((Date.now() - started) / 1000),
    }) + '\n');
  }
  process.stderr.write(`shard ${shard}: ${d + 1}/${deals} deals\n`);
}
