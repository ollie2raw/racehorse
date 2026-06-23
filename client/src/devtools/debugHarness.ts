/**
 * devtools/debugHarness.ts
 *
 * Developer-only validation harness for Phase 2 (move analysis pipeline).
 *
 * PURPOSE:
 *   Run buildMoveEvaluationResult() on concrete board positions and print
 *   every graded field — rank, engineScore, delta, category, reasons,
 *   concept tags, risk flags, explanationShort, interventionLevel — so we
 *   can inspect whether classifications and threshold values are sensible
 *   before wiring Phase 3.
 *
 * NOT FOR PRODUCTION:  no UI, no game integration, no React.
 *
 * Run with:
 *   cd client
 *   npx ts-node --esm src/devtools/debugHarness.ts
 */

import type { BoardState, Tile } from '../types.ts';
import type { BotMatchState } from '../bot/botEngine.ts';
import type { Move } from '../types.ts';
import {
  buildMoveEvaluationResult,
  computeInterventionLevel,
  type MoveEvaluationResult,
  type LearningMoveAnalysis,
} from '../learning/moveAnalysis.ts';
import {
  buildCoachingFeedback,
  type CoachingFeedbackPacket,
} from '../learning/coachMessaging.ts';
import { DEFAULT_THRESHOLD_CONFIG } from '../learning/types.ts';

// ─── Board / state factory helpers ────────────────────────────────────────────
//
// Mirrors the pattern in botHeuristics.behaviorTests.ts.
// IMPORTANT: mkBoard requires leftEnd ≤ rightEnd because tile.low = Math.min
// and tile.high = Math.max; horizontal-normal orientation maps tile.low to the
// left endpoint.  Scenarios are designed accordingly.

function mkBoard(left: number, right: number): BoardState {
  return {
    mainLine: [
      {
        tile: { low: Math.min(left, right), high: Math.max(left, right) },
        orientation: 'horizontal-normal',
      },
    ],
    leftEnd: left,
    rightEnd: right,
    leftEndIsDouble: left === right,
    rightEndIsDouble: left === right,
    hubDoubles: [],
  };
}

function mkLearningState(args: {
  youHand: Tile[];
  botHand: Tile[];
  leftEnd: number;
  rightEnd: number;
  boneyard?: Tile[];
  turnIndex?: number;
  handNumber?: number;
  youScore?: number;
  botScore?: number;
  opponentKnownMissing?: number[];
  opponentPassedOnEnds?: number[];
}): BotMatchState {
  return {
    players: {
      you: { hand: args.youHand, score: args.youScore ?? 0 },
      bot: { hand: args.botHand, score: args.botScore ?? 0 },
    },
    board: mkBoard(args.leftEnd, args.rightEnd),
    boneyard: args.boneyard ?? [],
    deadTiles: [],
    handOpen: true,
    currentPlayer: 'you',    // ← learning harness always evaluates from 'you'
    consecutivePasses: 0,
    handNumber: args.handNumber ?? 1,
    turnIndex: args.turnIndex ?? 2,
    handOver: false,
    gameOver: false,
    winnerId: null,
    winningScore: 60,
    lastHandWinner: null,
    lastHandReason: null,
    dealSize: 7,
    opponentPassedOnEnds: args.opponentPassedOnEnds ?? [],
    opponentDrawCount: 0,
    opponentKnownMissing: args.opponentKnownMissing ?? [],
    opponentMissingEvidence: [],
  };
}

// ─── Output formatting ────────────────────────────────────────────────────────

const COL = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
};

const CATEGORY_COLOR: Record<string, string> = {
  best:      COL.green,
  excellent: COL.cyan,
  good:      COL.blue,
  dubious:   COL.yellow,
  blunder:   COL.red,
};

const INTERVENTION_COLOR: Record<string, string> = {
  none:   COL.dim,
  light:  COL.blue,
  medium: COL.yellow,
  strong: COL.red,
};

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printSeparator(char = '─', len = 78): void {
  console.log(COL.dim + char.repeat(len) + COL.reset);
}

function printHeader(title: string): void {
  printSeparator('═');
  console.log(`${COL.bold}${COL.cyan}  ${title}${COL.reset}`);
  printSeparator('═');
}

function printSubHeader(label: string): void {
  console.log(`\n${COL.bold}${COL.magenta}  ▶ ${label}${COL.reset}`);
  printSeparator();
}

function printMoveRow(
  analysis: LearningMoveAnalysis,
  isChosen: boolean,
  gameMode: 'guided' | 'training' | 'challenge' = 'guided',
  neitherScores = false,
): void {
  const interventionLevel = computeInterventionLevel(
    analysis.category,
    1,           // confidence supplied separately; here we use full for per-move display
    false,
    gameMode,
    neitherScores,
  );

  const catColor = CATEGORY_COLOR[analysis.category] ?? '';
  const intColor = INTERVENTION_COLOR[interventionLevel] ?? '';
  const chosen   = isChosen ? `${COL.bold}${COL.yellow}★ CHOSEN  ${COL.reset}` : '          ';

  console.log(
    `${chosen}` +
    `${COL.bold}#${analysis.rank}${COL.reset} ` +
    `${pad(analysis.moveNotation, 16)} ` +
    `score=${pad(String(analysis.engineScore), 7)} ` +
    `Δ=${pad(String(analysis.scoreDeltaFromBest), 5)} ` +
    `pts=${analysis.immediatePoints} ` +
    `${catColor}[${pad(analysis.category, 9)}]${COL.reset} ` +
    `intervention=${intColor}${interventionLevel}${COL.reset}`,
  );

  console.log(
    `           ` +
    `primary=${COL.bold}${pad(analysis.primaryReason, 28)}${COL.reset}` +
    (analysis.secondaryReason
      ? ` secondary=${analysis.secondaryReason}`
      : ''),
  );

  if (analysis.conceptTags.length > 0) {
    console.log(`           concepts=[${analysis.conceptTags.join(', ')}]`);
  }
  if (analysis.riskFlags.length > 0) {
    console.log(`           ${COL.yellow}risks=[${analysis.riskFlags.join(', ')}]${COL.reset}`);
  }
  console.log(
    `           ${COL.dim}"${analysis.explanationShort}"${COL.reset}`,
  );
  if (analysis.explanationLong) {
    console.log(
      `           ${COL.dim}LONG: ${analysis.explanationLong}${COL.reset}`,
    );
  }
  console.log();
}

function printResult(
  result: MoveEvaluationResult,
  scenarioLabel: string,
  playerMoveId?: string,
): void {
  printSubHeader(scenarioLabel);

  console.log(
    `  confidence=${result.engineConfidence.toFixed(3)}  ` +
    `ambiguous=${result.isAmbiguousPosition}  ` +
    `neitherScores=${result.neitherScores}  ` +
    `moves evaluated=${result.rankedMoves.length}`,
  );

  if (result.isAmbiguousPosition) {
    console.log(
      `  ${COL.yellow}⚠ Ambiguous position — top-2 gap ≤ lowConfidenceBand (${result.thresholds.lowConfidenceBand}). Coach should hedge.${COL.reset}`,
    );
  }
  if (result.neitherScores) {
    console.log(
      `  ${COL.blue}ℹ Non-scoring position — intervention softened by one tier; strategic framing used.${COL.reset}`,
    );
  }
  console.log();

  for (const analysis of result.rankedMoves) {
    const isChosen = analysis.moveId === (result.chosenMove?.moveId ?? playerMoveId);
    printMoveRow(analysis, isChosen, 'guided', result.neitherScores);
  }

  if (result.chosenMove) {
    const cat     = result.chosenMove.category;
    const intLevel = computeInterventionLevel(
      cat,
      result.engineConfidence,
      result.isAmbiguousPosition,
      'guided',
      result.neitherScores,
    );
    console.log(
      `  ${COL.bold}Chosen move summary:${COL.reset} ` +
      `${result.chosenMove.moveNotation} → ` +
      `${CATEGORY_COLOR[cat]}${cat}${COL.reset}, ` +
      `intervention=${INTERVENTION_COLOR[intLevel]}${intLevel}${COL.reset}`,
    );
    // Show the "best was" note for dubious/blunder, but soften label in non-scoring positions
    const effectiveCat = result.neitherScores && cat === 'blunder' ? 'dubious' : cat;
    if (effectiveCat === 'blunder' || effectiveCat === 'dubious') {
      const best = result.bestMove;
      const label = result.neitherScores ? 'strategic miss' : 'missed';
      console.log(
        `  ${COL.yellow}${label}: ${best.moveNotation} (+${result.chosenMove.scoreDeltaFromBest.toFixed(1)} delta)${COL.reset}`,
      );
      console.log(
        `  ${COL.dim}Coach would say: "${best.explanationShort}"${COL.reset}`,
      );
    }
  }
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

/**
 * SCENARIO A — Clear best scoring move
 *
 * Board:  [0|5], leftEnd=0, rightEnd=5
 * Player hand: [0|5], [0|3], [5|4], [5|6]
 *
 * Pip arithmetic (open ends after each play):
 *   [0|5] on left  → new leftEnd=5, rightEnd=5, sum=10 → 2 scoring units  ← BEST
 *   [0|5] on right → new leftEnd=0, rightEnd=0, sum= 0 → 0 units
 *   [0|3] on left  → new leftEnd=3, rightEnd=5, sum= 8 → 0 units
 *   [5|4] on right → new leftEnd=0, rightEnd=4, sum= 4 → 0 units
 *   [5|6] on right → new leftEnd=0, rightEnd=6, sum= 6 → 0 units
 *
 * Expected: [0|5]→left is rank-1 by a wide margin (Δ ≥ 34 vs non-scoring moves).
 * Category: best (Δ=0).  All others should be good/dubious/blunder.
 */
function runScenarioA(): void {
  const state = mkLearningState({
    leftEnd:  0,
    rightEnd: 5,
    youHand: [
      { low: 0, high: 5 },
      { low: 0, high: 3 },
      { low: 4, high: 5 },
      { low: 5, high: 6 },
    ],
    botHand: [
      { low: 2, high: 3 },
      { low: 1, high: 6 },
      { low: 3, high: 4 },
    ],
  });

  // Player chooses [0|5] on left — the obvious best scoring move
  // We'll pass the move as a play-type Move
  const playerMove: Move = {
    type: 'play',
    tile: { low: 0, high: 5 },
    position: 'left',
  };

  const result = buildMoveEvaluationResult({
    state,
    playerMove,
    thresholds: DEFAULT_THRESHOLD_CONFIG,
    playerLevel: 'beginner',
  });

  printResult(
    result,
    'Scenario A — Clear best scoring move (board: 0 | ■ | 5)',
  );
}

/**
 * SCENARIO B — Multiple near-equal moves (ambiguous position)
 *
 * Board:  [2|3], leftEnd=2, rightEnd=3
 * Player hand: [2|4], [3|4], [2|6]
 *
 * Pip arithmetic — none of the plays produce a multiple-of-5 open sum:
 *   [2|4] on left  → new leftEnd=4, rightEnd=3, sum=7  → 0 units
 *   [3|4] on right → new leftEnd=2, rightEnd=4, sum=6  → 0 units
 *   [2|6] on left  → new leftEnd=6, rightEnd=3, sum=9  → 0 units
 *
 * All moves score 0 immediately, so differences are purely strategic
 * (end control, flexibility, future value).  Expect small Δ values and
 * isAmbiguousPosition = true or at least low confidence.
 * Coach should hedge — no move should get a "strong" intervention.
 */
function runScenarioB(): void {
  const state = mkLearningState({
    leftEnd:  2,
    rightEnd: 3,
    youHand: [
      { low: 2, high: 4 },
      { low: 3, high: 4 },
      { low: 2, high: 6 },
    ],
    botHand: [
      { low: 1, high: 3 },
      { low: 4, high: 5 },
      { low: 0, high: 2 },
    ],
  });

  // Player chooses [2|6] on left — not obviously worst, but let's see
  const playerMove: Move = {
    type: 'play',
    tile: { low: 2, high: 6 },
    position: 'left',
  };

  const result = buildMoveEvaluationResult({
    state,
    playerMove,
    thresholds: DEFAULT_THRESHOLD_CONFIG,
    playerLevel: 'intermediate',
  });

  printResult(
    result,
    'Scenario B — Near-equal moves, no immediate scoring (board: 2 | ■ | 3)',
  );
}

/**
 * SCENARIO C — Safest move beats tempting scoring move
 *
 * Board:  [4|5], leftEnd=4, rightEnd=5
 * Player hand: [1|5], [2|4], [3|5]
 *
 * Pip arithmetic:
 *   [1|5] on right → new leftEnd=4, rightEnd=1, sum=5  → 1 scoring unit ← tempting!
 *                    BUT rightEnd=1 is now a dangerous open end:
 *                    bot holds [1|6] and [1|4] → can score immediately after.
 *   [2|4] on left  → new leftEnd=2, rightEnd=5, sum=7  → 0 units (safe)
 *   [3|5] on right → new leftEnd=4, rightEnd=3, sum=7  → 0 units (safe)
 *
 * Expected: [1|5]→right may NOT be rank-1 despite scoring 1 unit, because
 * the endDangerPenalty from Fritz's evaluator should penalise the open 1-end.
 * The "safest" non-scoring move may rank higher.
 * This scenario tests whether risk flags and deny_return_score reasons appear.
 */
function runScenarioC(): void {
  const state = mkLearningState({
    leftEnd:  4,
    rightEnd: 5,
    youHand: [
      { low: 1, high: 5 },
      { low: 2, high: 4 },
      { low: 3, high: 5 },
    ],
    // Bot has two 1-tiles it can score on immediately if rightEnd opens to 1
    botHand: [
      { low: 1, high: 6 },
      { low: 1, high: 4 },
      { low: 2, high: 3 },
    ],
  });

  // Player (naively) picks the scoring move — let's see what the coach says
  const playerMove: Move = {
    type: 'play',
    tile: { low: 1, high: 5 },
    position: 'right',
  };

  const result = buildMoveEvaluationResult({
    state,
    playerMove,
    thresholds: DEFAULT_THRESHOLD_CONFIG,
    playerLevel: 'intermediate',
  });

  printResult(
    result,
    'Scenario C — Tempting score vs safer play (board: 4 | ■ | 5, bot holds [1|6],[1|4])',
  );
}

// ─── Threshold review ─────────────────────────────────────────────────────────

function printThresholdReview(): void {
  printSubHeader('Threshold Review');

  const t = DEFAULT_THRESHOLD_CONFIG;
  console.log(`  Current DEFAULT_THRESHOLD_CONFIG:`);
  console.log(`    excellentDelta         = ${t.excellentDelta}  (< 1/5 scoring unit; effectively tied)`);
  console.log(`    goodDelta              = ${t.goodDelta} (moderate strategic miss)`);
  console.log(`    dubiousDelta           = ${t.dubiousDelta} (≈ 1 missed scoring unit; Fritz scale: 1 unit × 34)`);
  console.log(`    strongInterventionDelta= ${t.strongInterventionDelta} (used in confidence interpolation)`);
  console.log(`    lowConfidenceBand      = ${t.lowConfidenceBand}  (top-2 gap ≤ this → coach hedges)`);
  console.log(`    missedScoreSeverity    = ${t.missedScoreSeverity}  (minimum immediate pts to flag as missed score)`);
  console.log();

  console.log(`  Scale reference:`);
  console.log(`    Fritz strategic evaluator (botHeuristics.evaluateStrategicMove):`);
  console.log(`      immediateScore × 34   — dominates; 1 scoring unit (5 pts) = 34 scale points`);
  console.log(`      end control factors   — typically ±5 to ±15 per move`);
  console.log(`      pressure / orphan     — typically ±5 to ±20 per move`);
  console.log();

  console.log(`  Assessment:`);
  console.log(`    • excellentDelta=6 means moves within ~0.18 scoring units are tied. `);
  console.log(`      This seems ${COL.green}reasonable${COL.reset} — a 6-point gap is noise on the Fritz scale.`);
  console.log(`    • goodDelta=18 is ~0.5 scoring units. A genuine strategic miss `);
  console.log(`      but no immediate points lost. ${COL.green}Feels right${COL.reset} for "good but not best".`);
  console.log(`    • dubiousDelta=34 == exactly 1 Fritz scoring unit. `);
  console.log(`      Moves that miss a full 5-point score are dubious. ${COL.green}Well-calibrated${COL.reset}.`);
  console.log(`    • lowConfidenceBand=6 matches excellentDelta. Top-2 within 6 → ambiguous. `);
  console.log(`      ${COL.green}Consistent${COL.reset}.`);
  console.log();

  console.log(`  ${COL.yellow}Watch for in output above:${COL.reset}`);
  console.log(`    - Scenario A: non-scoring moves should be dubious/blunder (Δ ≥ 34).`);
  console.log(`      If they're showing "good" with Δ < 18, raise dubiousDelta or lower goodDelta.`);
  console.log(`    - Scenario B: moves should have small deltas (< 18) and isAmbiguousPosition=true.`);
  console.log(`      If Δ values are large, the position is less ambiguous than expected — review pip math.`);
  console.log(`    - Scenario C: the scoring move [1|5] may or may not be rank-1 depending on`);
  console.log(`      how Fritz weights endDangerPenalty vs immediateScore.`);
  console.log(`      If it's always rank-1 despite the open 1-end, consider whether`);
  console.log(`      risk flags are surfacing correctly in the reason tagging layer.`);
  console.log();

  console.log(`  ${COL.bold}Recommendation:${COL.reset} keep thresholds as-is for Phase 3.`);
  console.log(`  They are grounded in the Fritz scale and match the spec intent.`);
  console.log(`  Revisit after live playtesting reveals systematic mis-gradings.`);
}

// ─── Phase 3: Coaching packet printer ────────────────────────────────────────

function printCoachingPacket(
  packet: CoachingFeedbackPacket,
  label: string,
  playerLevel: string,
  gameMode: string,
): void {
  printSubHeader(`${label}  [${playerLevel} / ${gameMode}]`);

  const intColor = INTERVENTION_COLOR[packet.interventionLevel] ?? '';
  const catColor = packet.moveGrade ? (CATEGORY_COLOR[packet.moveGrade] ?? '') : '';

  console.log(
    `  Grade: ${catColor}${packet.moveGrade ?? '—'}${COL.reset}  ` +
    `Intervention: ${intColor}${packet.interventionLevel}${COL.reset}  ` +
    `Confidence: ${packet.confidence.toFixed(2)}`,
  );
  if (packet.bestMoveLabel) {
    console.log(`  Best play:  ${COL.green}${packet.bestMoveLabel}${COL.reset}`);
  }
  if (packet.retryRecommended) {
    console.log(`  ${COL.red}⟳ Retry recommended${COL.reset}`);
  }
  console.log();

  if (packet.coachHeadline) {
    console.log(`  ${COL.bold}${packet.coachHeadline}${COL.reset}`);
  }
  if (packet.coachBodyShort) {
    console.log(`  ${packet.coachBodyShort}`);
  }
  if (packet.coachBodyLong) {
    console.log();
    console.log(`  ${COL.dim}Why? ${packet.coachBodyLong}${COL.reset}`);
  }
  if (packet.teachableMoments.length > 0) {
    console.log();
    console.log(`  ${COL.dim}Teachable: [${packet.teachableMoments.join(', ')}]${COL.reset}`);
  }
  console.log();
}

// ─── Phase 3 Scenario helpers ─────────────────────────────────────────────────

/**
 * Build a state, run Phase 2 analysis, then run Phase 3 coaching for all
 * requested (playerLevel, gameMode) combinations.
 */
function runCoachingScenario(opts: {
  label: string;
  state: ReturnType<typeof mkLearningState>;
  playerMove: Move;
  playerLevel: 'beginner' | 'intermediate' | 'advanced';
  gameMode: 'guided' | 'training' | 'challenge';
}): void {
  const { label, state, playerMove, playerLevel, gameMode } = opts;

  const result = buildMoveEvaluationResult({
    state,
    playerMove,
    thresholds:  DEFAULT_THRESHOLD_CONFIG,
    playerLevel,
  });

  const packet = buildCoachingFeedback({ result, playerLevel, gameMode });
  printCoachingPacket(packet, label, playerLevel, gameMode);
}

// ─── Phase 3: 5 required scenarios ───────────────────────────────────────────

/**
 * P3-1: Best move
 * Board: 0|5, player plays [0|5]→left (scores 2 units). Clearly rank-1.
 * Expected: celebrate tone, no intervention, brief positive headline.
 */
function runP3BestMove(): void {
  const state = mkLearningState({
    leftEnd:  0, rightEnd: 5,
    youHand: [
      { low: 0, high: 5 }, { low: 0, high: 3 },
      { low: 4, high: 5 }, { low: 5, high: 6 },
    ],
    botHand: [{ low: 2, high: 3 }, { low: 1, high: 6 }, { low: 3, high: 4 }],
  });
  const playerMove: Move = { type: 'play', tile: { low: 0, high: 5 }, position: 'left' };

  runCoachingScenario({
    label: 'P3-1 Best move (scored 2 units)',
    state, playerMove, playerLevel: 'beginner', gameMode: 'guided',
  });
}

/**
 * P3-2: Near-best move (both options score — excellent move with tiny edge to the other)
 *
 * Board: 1|2, leftEnd=1, rightEnd=2
 * Player hand: [1|3], [2|4], [0|6]
 *
 * Pip arithmetic:
 *   [2|4] → right → new rightEnd=2→4, leftEnd=1, sum=5 → 1 unit  ← BEST   (Δ=0.0)
 *   [1|3] → left  → new leftEnd=1→3,  rightEnd=2, sum=5 → 1 unit  ← EXCELLENT (Δ≈0.1)
 *   [0|6] → *     → 0 units on this board
 *
 * Both top moves score exactly 1 unit.  Fritz prefers [2|4]→right by ~0.1 on purely
 * strategic grounds (end-control factors).  The player picks [1|3]→left — almost
 * identical quality, but not the engine's first choice.
 *
 * Expected: grade=excellent, intervention=none, tone=praise_near.
 *   Coach acknowledges the solid scoring play; notes the marginal edge to [2|4]→right.
 *   This is the purest "near-best" scenario: the choice was barely distinguishable
 *   and the coach should reinforce rather than correct.
 */
function runP3NearBest(): void {
  const state = mkLearningState({
    leftEnd:  1, rightEnd: 2,
    youHand: [
      { low: 1, high: 3 },  // left→ 3|2, sum=5 → 1 unit  (EXCELLENT, Δ≈0.1)
      { low: 2, high: 4 },  // right→ 1|4, sum=5 → 1 unit  (BEST)
      { low: 0, high: 6 },  // 0 units — clearly weaker
    ],
    botHand: [{ low: 0, high: 2 }, { low: 5, high: 6 }, { low: 3, high: 4 }],
  });
  // Player picks [1|3]→left: scores 1 unit, barely below best (Δ≈0.1, 'excellent')
  const playerMove: Move = { type: 'play', tile: { low: 1, high: 3 }, position: 'left' };

  runCoachingScenario({
    label: 'P3-2 Near-best move (both options score — tiny strategic edge to other side)',
    state, playerMove, playerLevel: 'intermediate', gameMode: 'guided',
  });
}

/**
 * P3-3: Strategic miss (non-scoring position)
 * Board: 2|3, no immediate scoring available.
 * Player picks the weaker strategic move.
 * neitherScores=true → softer tone, strategy framing.
 */
function runP3StrategicMiss(): void {
  const state = mkLearningState({
    leftEnd:  2, rightEnd: 3,
    youHand: [
      { low: 2, high: 4 },  // left→ 4|3 = 7 pts = 0
      { low: 3, high: 4 },  // right→ 2|4 = 6 pts = 0 (rank-1)
      { low: 2, high: 6 },  // left→ 6|3 = 9 pts = 0 (weaker)
    ],
    botHand: [{ low: 1, high: 3 }, { low: 4, high: 5 }, { low: 0, high: 2 }],
  });
  // Player picks the weakest strategic option
  const playerMove: Move = { type: 'play', tile: { low: 2, high: 6 }, position: 'left' };

  runCoachingScenario({
    label: 'P3-3 Strategic miss (no scoring possible — board control)',
    state, playerMove, playerLevel: 'intermediate', gameMode: 'guided',
  });
}

/**
 * P3-4: Scoring but risky
 * Board: 4|5, player plays [1|5]→right (scores 1 unit, opens dangerous 1-end).
 * Bot holds [1|6],[1|4] → can score back immediately.
 * Player made the correct call but coach flags the trade-off.
 */
function runP3ScoringButRisky(): void {
  const state = mkLearningState({
    leftEnd:  4, rightEnd: 5,
    youHand: [
      { low: 1, high: 5 },  // right→ 4|1, sum=5 → 1 unit (scores but risky)
      { low: 2, high: 4 },  // left→  2|5 = 7 → 0 units
      { low: 3, high: 5 },  // right→ 4|3 = 7 → 0 units
    ],
    botHand: [{ low: 1, high: 6 }, { low: 1, high: 4 }, { low: 2, high: 3 }],
  });
  const playerMove: Move = { type: 'play', tile: { low: 1, high: 5 }, position: 'right' };

  runCoachingScenario({
    label: 'P3-4 Scoring but risky (bot holds two 1-tiles after opening 1-end)',
    state, playerMove, playerLevel: 'intermediate', gameMode: 'guided',
  });
}

/**
 * P3-5: Clear blunder (missed clean score)
 * Board: 0|5, player has [0|5] but plays a non-scoring tile instead.
 * Best move scores 2 units. Player picks [5|6]→right (0 points).
 * Delta ~169 → blunder, strong intervention.
 */
function runP3ClearBlunder(): void {
  const state = mkLearningState({
    leftEnd:  0, rightEnd: 5,
    youHand: [
      { low: 0, high: 5 },  // left→ 5|5, sum=10 → 2 units (BEST)
      { low: 0, high: 3 },
      { low: 4, high: 5 },
      { low: 5, high: 6 },  // right→ 0|6, sum=6 → 0 units
    ],
    botHand: [{ low: 2, high: 3 }, { low: 1, high: 6 }, { low: 3, high: 4 }],
  });
  // Player ignores the obvious 2-unit score and plays [5|6]→right
  const playerMove: Move = { type: 'play', tile: { low: 5, high: 6 }, position: 'right' };

  runCoachingScenario({
    label: 'P3-5 Clear blunder (played non-scoring tile, missed 2-unit score)',
    state, playerMove, playerLevel: 'beginner', gameMode: 'guided',
  });
}

function runPhase3Suite(): void {
  printHeader('Phase 3: Coaching Layer — 5 Example Outputs');
  console.log(`  Validates: tone, headlines, body copy, intervention level, teachable moments`);
  console.log();

  try { runP3BestMove();        } catch (e) { console.error(`${COL.red}P3-1 failed:${COL.reset}`, e); }
  try { runP3NearBest();        } catch (e) { console.error(`${COL.red}P3-2 failed:${COL.reset}`, e); }
  try { runP3StrategicMiss();   } catch (e) { console.error(`${COL.red}P3-3 failed:${COL.reset}`, e); }
  try { runP3ScoringButRisky(); } catch (e) { console.error(`${COL.red}P3-4 failed:${COL.reset}`, e); }
  try { runP3ClearBlunder();    } catch (e) { console.error(`${COL.red}P3-5 failed:${COL.reset}`, e); }

  printSeparator('═');
  console.log(`${COL.bold}${COL.green}  Phase 3 suite complete.${COL.reset}`);
  printSeparator('═');
  console.log();
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function runLearningDebugSuite(): void {
  printHeader('Racehorse Learn Academy — Phase 2 Validation Harness');
  console.log(`  Checking: move classification, reason tagging, intervention levels`);
  console.log(`  Thresholds: ${JSON.stringify(DEFAULT_THRESHOLD_CONFIG)}`);
  console.log();

  try {
    runScenarioA();
  } catch (e) {
    console.error(`${COL.red}Scenario A failed:${COL.reset}`, e);
  }

  try {
    runScenarioB();
  } catch (e) {
    console.error(`${COL.red}Scenario B failed:${COL.reset}`, e);
  }

  try {
    runScenarioC();
  } catch (e) {
    console.error(`${COL.red}Scenario C failed:${COL.reset}`, e);
  }

  printThresholdReview();

  printSeparator('═');
  console.log(`${COL.bold}${COL.green}  Phase 2 suite complete.${COL.reset}`);
  printSeparator('═');
  console.log();

  // ── Phase 3: coaching layer ─────────────────────────────────────────────
  runPhase3Suite();
}

// Run when executed directly via ts-node --esm
runLearningDebugSuite();
