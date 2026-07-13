import type { BoardState, PlacementPosition, Tile } from '../types.ts';
import type { BotMatchState } from '../modules/match/runtime/botEngine.ts';
import type { JourneyContentId, JourneyLessonDefinition, JourneyRulesetRef } from './journeyContentContract.ts';
import { getLegalMoves, isDouble, previewPlayMove } from '../modules/match/runtime/botEngine.ts';
import { removeJourneyTile } from './journeyBoardAnalysis.ts';

export type JourneyAuthoredMoveAction = { tile: Tile; position: PlacementPosition };
export type JourneyBoardDemonstrationStep =
  | { id: string; kind: 'position'; caption: string; boardDescription: string; board: BoardState; highlightedTileIds?: string[]; highlightedEnds?: number[] }
  | { id: string; kind: 'preview_move'; caption: string; boardDescription: string; board: BoardState; action: JourneyAuthoredMoveAction; highlightedTileIds?: string[]; highlightedEnds?: number[] };
export type JourneyScenarioInteraction =
  | { kind: 'move' }
  | { kind: 'pip_count'; targetPip: number; prompt: string; options: number[] }
  | { kind: 'pip_count_then_move'; targetPip: number; prompt: string; options: number[] };
export type JourneyScenarioResponse =
  | { kind: 'move'; action: JourneyAuthoredMoveAction }
  | { kind: 'pip_count'; predictedUnseenCount: number }
  | { kind: 'pip_count_then_move'; predictedUnseenCount: number; action: JourneyAuthoredMoveAction };
export type JourneyAuthoredScenario = {
  id: string;
  variantSetId: string | null;
  kind: 'demo' | 'guided' | 'independent' | 'proof';
  ruleset: JourneyRulesetRef;
  board: BoardState;
  playerHand: Tile[];
  interaction: JourneyScenarioInteraction;
  acceptedActions: JourneyAuthoredMoveAction[];
  temptingActions: JourneyAuthoredMoveAction[];
  feedbackByAction: Record<string, string>;
  demonstrationSteps?: JourneyBoardDemonstrationStep[];
};
export type JourneyAuthoredMoveConsequence = {
  action: JourneyAuthoredMoveAction;
  playedDouble: boolean;
  legal: boolean;
  resultingBoard: BoardState | null;
  resultingOpenEnds: number[];
  immediateScoreDelta: number;
  handExited: boolean;
  remainingHand: Tile[];
  remainingPlayableTileCount: number;
  remainingLegalActionCount: number;
  resultingOpenDoubleCount: number;
  resultingCrossedHubCount: number;
};
export type JourneyFeedbackAsset = { key: string; heading: string; explanation: string; fritzRemark: string | null; retryExpected: boolean };
export type JourneyScenarioEvaluation = { kind: 'illegal' | 'evaluated'; result?: 'completed' | 'passed' | 'failed'; feedbackOutcomeKey: string; decisionSummary: { total: number; correct: number; incorrect: number }; mistakeCategoryIds: string[]; nextBoard: BoardState | null; openEndsBefore: number[]; openEndsAfter: number[]; consequence?: JourneyAuthoredMoveConsequence; accountedTiles?: Tile[]; expectedUnseenCount?: number; predictedUnseenCount?: number };
export type JourneyAuthoredLessonBundle = {
  contentId: JourneyContentId;
  definition: JourneyLessonDefinition;
  scenarios: Readonly<Record<string, JourneyAuthoredScenario>>;
  feedback: Readonly<Record<string, JourneyFeedbackAsset>>;
  presentation: { tableTitle: string; lessonTitle: string; framingLine: string; framingInstruction: string; completionLine: string };
  evaluateResponse: (scenario: JourneyAuthoredScenario, response: JourneyScenarioResponse) => JourneyScenarioEvaluation;
};

export function createJourneyScenarioState(scenario: JourneyAuthoredScenario): BotMatchState {
  return { players: { you: { hand: scenario.playerHand.map((tile) => ({ ...tile })), score: 0 }, bot: { hand: [], score: 0 } }, board: JSON.parse(JSON.stringify(scenario.board)) as BoardState, boneyard: [], deadTiles: [], handOpen: true, currentPlayer: 'you', consecutivePasses: 0, handNumber: 1, turnIndex: 0, handOver: false, gameOver: false, winnerId: null, winningScore: 999, lastHandWinner: null, lastHandReason: null, dealSize: 7 };
}

export function analyzeJourneyAuthoredMove(scenario: JourneyAuthoredScenario, action: JourneyAuthoredMoveAction): JourneyAuthoredMoveConsequence {
  const state = createJourneyScenarioState(scenario);
  const preview = previewPlayMove(state, 'you', { type: 'play', tile: action.tile, position: action.position });
  if (!preview) return { action, playedDouble: isDouble(action.tile), legal: false, resultingBoard: null, resultingOpenEnds: [], immediateScoreDelta: 0, handExited: false, remainingHand: removeJourneyTile(scenario.playerHand, action.tile), remainingPlayableTileCount: 0, remainingLegalActionCount: 0, resultingOpenDoubleCount: 0, resultingCrossedHubCount: 0 };
  const nextState: BotMatchState = { ...state, board: preview.nextBoard, players: { ...state.players, you: { ...state.players.you, hand: preview.nextHand } } };
  const nextLegal = getLegalMoves(nextState, 'you').filter((move) => move.type === 'play');
  const uniquePlayable = new Set(nextLegal.filter((move) => move.tile).map((move) => `${move.tile!.low}-${move.tile!.high}`));
  return { action, playedDouble: preview.isDouble, legal: true, resultingBoard: preview.nextBoard, resultingOpenEnds: preview.openEnds, immediateScoreDelta: preview.immediateScore, handExited: preview.nextHand.length === 0, remainingHand: preview.nextHand.map((tile) => ({ ...tile })), remainingPlayableTileCount: uniquePlayable.size, remainingLegalActionCount: nextLegal.length, resultingOpenDoubleCount: [preview.nextBoard.leftEndIsDouble, preview.nextBoard.rightEndIsDouble].filter(Boolean).length, resultingCrossedHubCount: preview.nextBoard.hubDoubles.filter((hub) => hub.isCrossed).length };
}
