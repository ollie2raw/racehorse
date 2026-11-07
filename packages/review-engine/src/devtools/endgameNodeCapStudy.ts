/**
 * Q4 (docs/review-bounded-exact-2026-11-07.md): the true-endgame outliers. A locked yard (drawable tiles = 0) goes to solveExactEndgame, which enumerates every hidden
 * opponent-hand allocation in lexicographic order and searches each exhaustively to the hand's end under ONE cumulative node budget; when the budget runs out mid-allocation
 * that allocation is discarded and the loop stops, so a capped result is the average over a LEXICOGRAPHIC PREFIX of the allocations (a biased slice: the first tiles in the
 * canonical order), and the dispatcher labels it "Exact analysis / high" regardless (adaptExactEndgameResult does not read `complete`). Production's budget here is 100,000,000
 * nodes (the exact-path budget), so in practice it never caps; the worst corpus decision takes 8.6 million nodes.
 *
 * This records every allocation's per-action value and nodes for each locked-yard decision of the corpus (bot play), then replays two capped variants against the full result:
 *   lexicographic  what solveExactEndgame does today at a cap
 *   random order   the same cap over the allocations in a seeded random permutation (an unbiased anytime answer), returned with partial = true
 * It reports how often a cap triggers on the corpus and what it does to the top move and the grade of the played move.
 *
 *   npx tsx packages/review-engine/src/devtools/endgameNodeCapStudy.ts
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { applyGameCommand, createDeterministicRandom, shuffleDeterministically, tileEquals, type Config, type GameState, type Tile } from '@racehorse/game-core';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { enumerateCombinationsLazy } from '../combinations';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';
import { resolveReviewConfig } from '../reviewRuleset';
import { commandForAction, searchGameTree, type GameTreeWalkConfig, type NodeBudget } from '../searchGameTree';
import { solveExactEndgame } from '../solveExactEndgame';
import { replayRecordedSelfPlay } from './replayRecordedSelfPlay';
import { canonicalActionKey, gradeOfLoss, type Grade } from './reviewSamplingStudyLib';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/recorded-self-play');
const CAPS = [50_000, 100_000, 250_000, 500_000, 1_000_000, 2_000_000];
const say = (line = '') => process.stdout.write(`${line}\n`);

const sortCanonical = (tiles: readonly Tile[]): Tile[] => [...tiles].sort((a, b) => Math.min(a.low, a.high) - Math.min(b.low, b.high) || Math.max(a.low, a.high) - Math.max(b.low, b.high));

type Alloc = { d: number[]; nodes: number };
type Recorded = { C: number; actionKeys: string[]; playedIndex: number; lexi: Alloc[]; ms: number; totalNodes: number; legal: number; handSize: number; gameId: string };

function record(snapshot: ReviewPositionSnapshotV2): Recorded | null {
  const { actorId, opponentId, handNumber } = snapshot.identifiers;
  const { actorHand, board, scores, consecutivePasses, handOpen, opponentTileCount } = snapshot.preAction;
  const rootDiff = scores.actor - scores.opponent;
  const { eligibleForOpponent, excludedTiles } = resolveHiddenPoolEligibility(snapshot, 6);
  const eligible = sortCanonical(eligibleForOpponent);
  if (eligible.length < opponentTileCount) return null;
  const config: Config = resolveReviewConfig(snapshot, 6);
  const walk = { shouldStop: undefined, actorId, opponentId, isCutoff: (s: GameState) => s.handOver || s.gameOver, leafValue: (s: GameState) => s.players[actorId].score - s.players[opponentId].score } as unknown as GameTreeWalkConfig;
  const lexi: Alloc[] = [];
  const started = performance.now();
  let totalNodes = 0;
  for (const allocation of enumerateCombinationsLazy(eligible, opponentTileCount)) {
    const leftover = eligible.filter((tile) => !allocation.some((chosen) => tileEquals(chosen, tile)));
    const deadTiles = [...leftover, ...excludedTiles];
    const d: number[] = [];
    let nodes = 0;
    for (const action of snapshot.legalActions) {
      const rootState = {
        config, playerIds: [actorId, opponentId],
        players: { [actorId]: { id: actorId, hand: actorHand, score: scores.actor }, [opponentId]: { id: opponentId, hand: allocation, score: scores.opponent } },
        board, boneyard: [], deadTiles, currentPlayerIndex: 0, handNumber, handOpen, handOver: false, gameOver: false, winnerId: null, consecutivePasses, sequence: 0,
      } as unknown as GameState;
      const command = commandForAction(rootState, actorId, action);
      const { state: post } = applyGameCommand(rootState, command);
      const budget: NodeBudget = { count: 0, max: Number.MAX_SAFE_INTEGER };
      const { diff } = searchGameTree(post, 0, walk, budget);
      d.push(diff - rootDiff);
      nodes += budget.count;
    }
    totalNodes += nodes;
    lexi.push({ d, nodes });
  }
  const actionKeys = snapshot.legalActions.map(canonicalActionKey);
  return { C: lexi.length, actionKeys, playedIndex: Math.max(0, actionKeys.indexOf(canonicalActionKey(snapshot.actualAction))), lexi, ms: performance.now() - started, totalNodes, legal: snapshot.legalActions.length, handSize: actorHand.length, gameId: snapshot.identifiers.gameId };
}

type Verdict = { top: string; grade: Grade; loss: number; allocations: number };
function verdictOver(rec: Recorded, allocs: readonly Alloc[]): Verdict {
  const A = rec.actionKeys.length;
  const sums = new Array<number>(A).fill(0);
  for (const a of allocs) for (let i = 0; i < A; i += 1) sums[i]! += a.d[i]!;
  const n = Math.max(1, allocs.length);
  const order = [...Array(A).keys()].sort((x, y) => (sums[y]! !== sums[x]! ? sums[y]! - sums[x]! : rec.actionKeys[x]! < rec.actionKeys[y]! ? -1 : 1));
  const loss = sums[order[0]!]! / n - sums[rec.playedIndex]! / n;
  return { top: rec.actionKeys[order[0]!]!, grade: gradeOfLoss(loss), loss, allocations: allocs.length };
}
/** The allocations a cumulative node cap lets through: those whose running total stays within the cap (the one that crosses it is discarded, as the solver does). */
function underCap(allocs: readonly Alloc[], cap: number): Alloc[] {
  const out: Alloc[] = [];
  let total = 0;
  for (const a of allocs) { total += a.nodes; if (total > cap) break; out.push(a); }
  return out;
}

const positions = replayRecordedSelfPlay(dir).filter(({ snapshot, evaluation }) => snapshot.preAction.boneyard.drawableCount === 0 && evaluation.candidates.length > 1);
const recs: Recorded[] = [];
for (const { snapshot } of positions) {
  const rec = record(snapshot);
  if (rec) recs.push(rec);
}
say(`${recs.length} locked-yard decisions (drawable tiles = 0) with more than one legal action; bot play\n`);
say('| decision | C(n,k) | legal | hand | nodes | ms |\n|---|---|---|---|---|---|');
for (const r of [...recs].sort((a, b) => b.totalNodes - a.totalNodes)) say(`| ${r.gameId.replace('self-play:demo-', '')} | ${r.C} | ${r.legal} | ${r.handSize} | ${r.totalNodes} | ${r.ms.toFixed(0)} |`);
const nodesSorted = recs.map((r) => r.totalNodes).sort((a, b) => a - b);
say(`\nnodes per decision: median ${nodesSorted[Math.floor(nodesSorted.length / 2)]}, p90 ${nodesSorted[Math.floor(nodesSorted.length * 0.9)]}, max ${nodesSorted[nodesSorted.length - 1]}; the production budget is 100,000,000 nodes, so no corpus decision reaches it\n`);

// sanity: our full pass equals solveExactEndgame (production), decision by decision
let agree = 0;
positions.forEach(({ snapshot }, i) => {
  const rec = recs[i];
  if (!rec) return;
  const prod = solveExactEndgame(snapshot, { maxNodes: 100_000_000, maxWallClockMs: Infinity });
  if (prod && canonicalActionKey(prod.best.action) === verdictOver(rec, rec.lexi).top) agree += 1;
});
say(`our full lexicographic pass picks the same top move as solveExactEndgame on ${agree} of ${recs.length}\n`);

say('| node cap | cap at 40x slowdown ~ | triggers (decisions cut short) | LEXICOGRAPHIC prefix: same top / same grade | RANDOM-order anytime (partial = true): same top / same grade | mean allocations kept (lex / random) |');
say('|---|---|---|---|---|---|');
for (const cap of CAPS) {
  let triggers = 0;
  let lexTop = 0, lexGrade = 0, rndTop = 0, rndGrade = 0;
  let keptLex = 0, keptRnd = 0;
  for (const r of recs) {
    const full = verdictOver(r, r.lexi);
    const order = shuffleDeterministically(r.lexi.map((_, i) => i), createDeterministicRandom(`eg:${r.gameId}:${r.C}:${r.totalNodes}`)) as number[];
    const lex = underCap(r.lexi, cap);
    const rnd = underCap(order.map((i) => r.lexi[i]!), cap);
    if (r.totalNodes > cap) triggers += 1;
    const vl = verdictOver(r, lex);
    const vr = verdictOver(r, rnd);
    if (vl.top === full.top) lexTop += 1;
    if (vl.grade === full.grade) lexGrade += 1;
    if (vr.top === full.top) rndTop += 1;
    if (vr.grade === full.grade) rndGrade += 1;
    keptLex += lex.length / r.C;
    keptRnd += rnd.length / r.C;
  }
  const n = recs.length;
  say(`| ${cap.toLocaleString()} | ${((cap * 4.5e-6 * 40)).toFixed(0)} s | ${triggers} of ${n} | ${lexTop}/${n} / ${lexGrade}/${n} | ${rndTop}/${n} / ${rndGrade}/${n} | ${((keptLex / n) * 100).toFixed(0)}% / ${((keptRnd / n) * 100).toFixed(0)}% |`);
}
say('\n(Agreement is against the full enumeration. With 19 decisions these are counts, not percentages with intervals; the cap column converts nodes to seconds at 4.5 microseconds per node on the laptop, times 40 for a machine 40x slower: a guess.)');
