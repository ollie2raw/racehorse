import type { BoardState, Tile } from '../../../types.ts';
import type { JourneyAuthoredMoveAction, JourneyAuthoredScenario, JourneyBoardDemonstrationStep } from '../../journeyAuthoredLessonBundle.ts';
import { createJourneyScenarioState } from '../../journeyAuthoredLessonBundle.ts';
import { previewPlayMove } from '../../../modules/match/runtime/botEngine.ts';
import { getCoreJourneyTileSet, getUnseenTileCountForPip } from '../../journeyCounting.ts';
import { CORE_JOURNEY_RULESET_ID } from '../../journeyContentContract.ts';
import { DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID, DEFENSIVE_HOLDING_PROOF_VARIANT_SET_ID } from './defensiveHoldingLesson.ts';

export type DefensiveHoldingScenario = JourneyAuthoredScenario & {
  denialFacts: { acceptedUnseenCount: number; temptingUnseenCount: number };
};

const tile = (low: number, high: number): Tile => ({ low, high });
const core = { kind: 'core_journey' as const, id: CORE_JOURNEY_RULESET_ID };

function singleTileBoard(a: number, b: number): BoardState {
  return { mainLine: [{ tile: tile(a, b), orientation: 'horizontal-normal' }], leftEnd: a, rightEnd: b, leftEndIsDouble: false, rightEndIsDouble: false, hubDoubles: [] };
}

function actionKey(action: JourneyAuthoredMoveAction): string {
  return `${action.tile.low}-${action.tile.high}@${action.position}`;
}

function otherPip(t: Tile, matched: number): number {
  return t.low === matched ? t.high : t.low;
}

function baseScenario(board: BoardState, hand: Tile[]): JourneyAuthoredScenario {
  return { id: 'tmp', variantSetId: null, kind: 'demo', ruleset: core, board, playerHand: hand, interaction: { kind: 'move' }, acceptedActions: [], temptingActions: [], feedbackByAction: {} };
}

function unseenAfterAction(board: BoardState, hand: Tile[], action: JourneyAuthoredMoveAction): number {
  const matchedEnd = action.position === 'left' ? board.leftEnd : board.rightEnd;
  const exposedPip = otherPip(action.tile, matchedEnd);
  return getUnseenTileCountForPip({ tileSet: getCoreJourneyTileSet(), board, playerHand: hand, pip: exposedPip });
}

function scenario(
  id: string,
  kind: DefensiveHoldingScenario['kind'],
  variantSetId: string | null,
  board: BoardState,
  hand: Tile[],
  accepted: JourneyAuthoredMoveAction,
  tempting: JourneyAuthoredMoveAction,
  acceptedFeedback: string,
  temptingFeedback: string,
): DefensiveHoldingScenario {
  const acceptedUnseenCount = unseenAfterAction(board, hand, accepted);
  const temptingUnseenCount = unseenAfterAction(board, hand, tempting);
  if (acceptedUnseenCount >= temptingUnseenCount) {
    throw new Error(`${id}: accepted action must expose a pip with a strictly lower unseen count than the tempting one (${acceptedUnseenCount} vs ${temptingUnseenCount})`);
  }
  return {
    id, variantSetId, kind, ruleset: core, board, playerHand: hand, interaction: { kind: 'move' },
    acceptedActions: [accepted], temptingActions: [tempting],
    feedbackByAction: { [actionKey(accepted)]: acceptedFeedback, [actionKey(tempting)]: temptingFeedback },
    denialFacts: { acceptedUnseenCount, temptingUnseenCount },
  };
}

const demoBoard = singleTileBoard(2, 4);
const demoHand = [tile(2, 6), tile(4, 1), tile(1, 3)];
const demoAccepted = { tile: tile(4, 1), position: 'right' as const };
const demoTempting = { tile: tile(2, 6), position: 'left' as const };
const demoBase = baseScenario(demoBoard, demoHand);

const demoSteps: JourneyBoardDemonstrationStep[] = [
  { id: 'holding-demo-position', kind: 'position', caption: 'Two legal replies.', boardDescription: 'You hold 2-6, 4-1, and 1-3. Both 2-6 and 4-1 are legal right now.', board: demoBoard, highlightedEnds: [2, 4] },
  { id: 'holding-demo-tempting', kind: 'preview_move', caption: 'Play the 2-end tile.', boardDescription: 'Playing 2-6 exposes a 6. Fewer of your own tiles account for 6s, so more of them are still unseen — Fritz is more likely to have a reply.', board: previewPlayMove(createJourneyScenarioState(demoBase), 'you', { type: 'play', tile: demoTempting.tile, position: demoTempting.position })!.nextBoard, action: demoTempting, highlightedEnds: [2, 4] },
  { id: 'holding-demo-accepted', kind: 'preview_move', caption: 'Compare playing 4-1 instead.', boardDescription: 'Playing 4-1 exposes a 1. You already hold another 1 yourself, so fewer 1-tiles remain unseen — this end is harder for Fritz to answer.', board: previewPlayMove(createJourneyScenarioState(demoBase), 'you', { type: 'play', tile: demoAccepted.tile, position: demoAccepted.position })!.nextBoard, action: demoAccepted, highlightedEnds: [2, 4] },
];

export const DEFENSIVE_HOLDING_SCENARIOS: DefensiveHoldingScenario[] = [
  { ...scenario('scenario:holding-demo', 'demo', null, demoBoard, demoHand, demoAccepted, demoTempting, 'exposed_the_safer_end', 'exposed_the_dangerous_end'), demonstrationSteps: demoSteps },
  scenario('scenario:holding-guided', 'guided', null, demoBoard, demoHand, demoAccepted, demoTempting, 'exposed_the_safer_end', 'exposed_the_dangerous_end'),
  scenario(
    'scenario:holding-practice-1', 'independent', DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(1, 5), [tile(1, 4), tile(5, 3), tile(4, 0)],
    { tile: tile(1, 4), position: 'left' }, { tile: tile(5, 3), position: 'right' },
    'read_the_denial', 'ignored_the_count',
  ),
  scenario(
    'scenario:holding-practice-2', 'independent', DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(0, 6), [tile(0, 2), tile(6, 4), tile(2, 5)],
    { tile: tile(0, 2), position: 'left' }, { tile: tile(6, 4), position: 'right' },
    'read_the_denial', 'ignored_the_count',
  ),
  scenario(
    'scenario:holding-practice-3', 'independent', DEFENSIVE_HOLDING_PRACTICE_VARIANT_SET_ID,
    singleTileBoard(3, 6), [tile(3, 0), tile(6, 5), tile(0, 2)],
    { tile: tile(3, 0), position: 'left' }, { tile: tile(6, 5), position: 'right' },
    'read_the_denial', 'ignored_the_count',
  ),
  scenario(
    'scenario:holding-proof-1', 'proof', DEFENSIVE_HOLDING_PROOF_VARIANT_SET_ID,
    singleTileBoard(3, 1), [tile(3, 2), tile(1, 6), tile(2, 4)],
    { tile: tile(3, 2), position: 'left' }, { tile: tile(1, 6), position: 'right' },
    'read_the_denial', 'ignored_the_count',
  ),
  scenario(
    'scenario:holding-proof-2', 'proof', DEFENSIVE_HOLDING_PROOF_VARIANT_SET_ID,
    singleTileBoard(6, 2), [tile(6, 5), tile(2, 0), tile(5, 3)],
    { tile: tile(6, 5), position: 'left' }, { tile: tile(2, 0), position: 'right' },
    'read_the_denial', 'ignored_the_count',
  ),
];
