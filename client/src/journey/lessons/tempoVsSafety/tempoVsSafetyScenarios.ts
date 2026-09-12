import type { BoardState, Tile } from '../../../types.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario, JourneyBoardDemonstrationStep } from '../../journeyAuthoredLessonBundle.ts';
import { analyzeJourneyAuthoredMove, createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID, TEMPO_VS_SAFETY_PROOF_VARIANT_SET_ID } from './tempoVsSafetyLesson.ts';

export type TempoVsSafetyScenario = JourneyAuthoredScenario & {
  tradeoffFacts: { acceptedScore: number; temptingScore: number; acceptedRemainingLegal: number; temptingRemainingLegal: number };
};

const tile = (low: number, high: number): Tile => ({ low, high });
const core = { kind: 'core_journey' as const, id: CORE_JOURNEY_RULESET_ID };

function singleTileBoard(a: number, b: number): BoardState {
  return { mainLine: [{ tile: tile(a, b), orientation: 'horizontal-normal' }], leftEnd: a, rightEnd: b, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] };
}

function actionKey(action: JourneyAuthoredMoveAction): string {
  return `${action.tile.low}-${action.tile.high}@${action.position}`;
}

function baseScenario(board: BoardState, hand: Tile[]): JourneyAuthoredScenario {
  return { id: 'tmp', variantSetId: null, kind: 'demo', ruleset: core, board, playerHand: hand, interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {} };
}

function scenario(
  id: string,
  kind: TempoVsSafetyScenario['kind'],
  variantSetId: string | null,
  board: BoardState,
  hand: Tile[],
  accepted: JourneyAuthoredMoveAction,
  tempting: JourneyAuthoredMoveAction,
  acceptedFeedback: string,
  temptingFeedback: string,
): TempoVsSafetyScenario {
  const base = baseScenario(board, hand);
  const acceptedConsequence = analyzeJourneyAuthoredMove(base, accepted);
  const temptingConsequence = analyzeJourneyAuthoredMove(base, tempting);
  if (temptingConsequence.immediateScoreDelta < acceptedConsequence.immediateScoreDelta) {
    throw new Error(`${id}: the tempting action must score at least as much as the accepted one, to be a genuine temptation (${temptingConsequence.immediateScoreDelta} vs ${acceptedConsequence.immediateScoreDelta})`);
  }
  if (acceptedConsequence.remainingLegalActionCount <= temptingConsequence.remainingLegalActionCount) {
    throw new Error(`${id}: the accepted action must leave strictly more remaining legal actions despite scoring less (${acceptedConsequence.remainingLegalActionCount} vs ${temptingConsequence.remainingLegalActionCount})`);
  }
  return {
    id, variantSetId, kind, ruleset: core, board, playerHand: hand, interaction: { kind: 'move' },
    acceptedActions: [accepted], temptingActions: [tempting],
    feedbackByAction: { [actionKey(accepted)]: acceptedFeedback, [actionKey(tempting)]: temptingFeedback },
    tradeoffFacts: {
      acceptedScore: acceptedConsequence.immediateScoreDelta,
      temptingScore: temptingConsequence.immediateScoreDelta,
      acceptedRemainingLegal: acceptedConsequence.remainingLegalActionCount,
      temptingRemainingLegal: temptingConsequence.remainingLegalActionCount,
    },
  };
}

const demoBoard = singleTileBoard(2, 6);
const demoHand = [tile(6, 3), tile(2, 5), tile(5, 1)];
const demoAccepted = { tile: tile(2, 5), position: 'left' as const };
const demoTempting = { tile: tile(6, 3), position: 'right' as const };
const demoBase = baseScenario(demoBoard, demoHand);

const demoSteps: JourneyBoardDemonstrationStep[] = [
  { id: 'tradeoff-demo-position', kind: 'position', caption: 'One play scores. One doesn’t — yet.', boardDescription: 'You hold 6-3, 2-5, and 5-1. Playing 6-3 scores immediately. Playing 2-5 does not.', board: demoBoard, highlightedEnds: [2, 6] },
  { id: 'tradeoff-demo-tempting', kind: 'preview_move', caption: 'Take the score.', boardDescription: 'Playing 6-3 scores now, but your 5-1 no longer matches either end — it goes dead in your hand.', board: previewPlayMove(createJourneyScenarioState(demoBase), 'you', { type: 'play', tile: demoTempting.tile, position: demoTempting.position })!.nextBoard, action: demoTempting, highlightedEnds: [2, 6] },
  { id: 'tradeoff-demo-accepted', kind: 'preview_move', caption: 'Compare the quieter play.', boardDescription: 'Playing 2-5 scores nothing this turn, but both 6-3 and 5-1 still have a legal reply after it. Your hand stays live.', board: previewPlayMove(createJourneyScenarioState(demoBase), 'you', { type: 'play', tile: demoAccepted.tile, position: demoAccepted.position })!.nextBoard, action: demoAccepted, highlightedEnds: [2, 6] },
];

export const TEMPO_VS_SAFETY_SCENARIOS: TempoVsSafetyScenario[] = [
  { ...scenario('scenario:tradeoff-demo', 'demo', null, demoBoard, demoHand, demoAccepted, demoTempting, 'banked_the_safer_position', 'chased_the_score'), demonstrationSteps: demoSteps },
  scenario('scenario:tradeoff-guided', 'guided', null, demoBoard, demoHand, demoAccepted, demoTempting, 'banked_the_safer_position', 'chased_the_score'),
  scenario(
    'scenario:tradeoff-practice-1', 'independent', TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(1, 4), [tile(4, 4), tile(1, 2), tile(2, 6)],
    { tile: tile(1, 2), position: 'left' }, { tile: tile(4, 4), position: 'right' },
    'read_the_trade_off', 'ignored_the_follow_up',
  ),
  scenario(
    'scenario:tradeoff-practice-2', 'independent', TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(0, 3), [tile(3, 5), tile(0, 1), tile(1, 4)],
    { tile: tile(0, 1), position: 'left' }, { tile: tile(3, 5), position: 'right' },
    'read_the_trade_off', 'ignored_the_follow_up',
  ),
  scenario(
    'scenario:tradeoff-practice-3', 'independent', TEMPO_VS_SAFETY_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(4, 1), [tile(1, 6), tile(4, 3), tile(3, 5)],
    { tile: tile(4, 3), position: 'left' }, { tile: tile(1, 6), position: 'right' },
    'read_the_trade_off', 'ignored_the_follow_up',
  ),
  scenario(
    'scenario:tradeoff-proof-1', 'proof', TEMPO_VS_SAFETY_PROOF_VARIANT_SET_ID,
    singleTileBoard(6, 2), [tile(2, 4), tile(6, 0), tile(0, 5)],
    { tile: tile(6, 0), position: 'left' }, { tile: tile(2, 4), position: 'right' },
    'read_the_trade_off', 'ignored_the_follow_up',
  ),
  scenario(
    'scenario:tradeoff-proof-2', 'proof', TEMPO_VS_SAFETY_PROOF_VARIANT_SET_ID,
    singleTileBoard(5, 0), [tile(0, 0), tile(5, 3), tile(3, 6)],
    { tile: tile(5, 3), position: 'left' }, { tile: tile(0, 0), position: 'right' },
    'read_the_trade_off', 'ignored_the_follow_up',
  ),
];
