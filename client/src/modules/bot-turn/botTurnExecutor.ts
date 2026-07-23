import {
  getLegalMoves,
  type BotActionResult,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { BotChoice, BotDifficulty } from '../fritz/botHeuristics.ts';
import type { LocalRunToken } from '../match/types.ts';
import type { GhostProfileSummary, GhostResolvedMove } from '../ghost/ghostContracts.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';
import type { Tile } from '../../types.ts';
import {
  completeBotTurnAction,
  syncBotChoiceState,
} from './botActionCompletion.ts';
import { runBotDrawPassSequence } from './botDrawPassHandler.ts';
import { executeBotPlayMove, resolveBotMoveChoice } from './botMoveResolution.ts';
import { collectBotTurnSnapshot } from './botMoveSnapshot.ts';
import type { BotTurnPorts } from './types.ts';
import type { RunDrawSequence } from './drawSequence.ts';

export type BotTurnExecutionInput = {
  liveAtTurn: BotMatchState;
  matchSnapshotSource: BotMatchState;
  ports: BotTurnPorts;
  matchRef: React.MutableRefObject<BotMatchState>;
  runDrawSequence: RunDrawSequence;
  runToken: LocalRunToken;
  isLocalRunCurrent: (token: LocalRunToken) => boolean;
  cancelled: () => boolean;
  isGhostMode: boolean;
  ghostProfile: GhostProfileSummary | null;
  fritzDifficulty: BotDifficulty;
  isDailyFritzMode: boolean;
  isMuted: boolean;
  moveCounter: number;
  setBotChainPaused: (paused: boolean) => void;
};

export type BotTurnExecutionResult = {
  result: BotActionResult | null;
  drew: boolean;
  passed: boolean;
  drawCount: number;
  chosen: BotChoice | null;
  ghostChosen: GhostResolvedMove | null;
  playedTileForHighlight: Tile | null;
  workingHandNumber: number;
  actionResolved: boolean;
};

export async function executeBotTurn(
  input: BotTurnExecutionInput,
): Promise<BotTurnExecutionResult> {
  let working = input.liveAtTurn;
  let result: BotActionResult | null = null;
  let drew = false;
  let passed = false;
  let drawCount = 0;
  let chosen: BotChoice | null = null;
  let ghostChosen: GhostResolvedMove | null = null;
  let playedTileForHighlight: Tile | null = null;
  const snapshot = collectBotTurnSnapshot(input.matchSnapshotSource);

  const botPlayable = asPlayMoves(getLegalMoves(working, 'bot'));

  if (botPlayable.length === 0) {
    const drawPassOutcome = await runBotDrawPassSequence({
      working,
      snapshot,
      ports: input.ports,
      runDrawSequence: input.runDrawSequence,
      runToken: input.runToken,
      isLocalRunCurrent: input.isLocalRunCurrent,
      cancelled: input.cancelled,
      isGhostMode: input.isGhostMode,
      ghostProfile: input.ghostProfile,
      fritzDifficulty: input.fritzDifficulty,
      isDailyFritzMode: input.isDailyFritzMode,
      isMuted: input.isMuted,
      moveCounter: input.moveCounter,
      matchHandNumber: input.matchSnapshotSource.handNumber,
    });

    if (input.cancelled() || !input.isLocalRunCurrent(input.runToken)) {
      return {
        result: null,
        drew: false,
        passed: false,
        drawCount: 0,
        chosen: null,
        ghostChosen: null,
        playedTileForHighlight: null,
        workingHandNumber: working.handNumber,
        actionResolved: false,
      };
    }

    working = drawPassOutcome.working;
    result = drawPassOutcome.result;
    drew = drawPassOutcome.drew;
    passed = drawPassOutcome.passed;
    drawCount = drawPassOutcome.drawCount;
    chosen = drawPassOutcome.chosen;
    ghostChosen = drawPassOutcome.ghostChosen;
    playedTileForHighlight = drawPassOutcome.playedTileForHighlight;
  } else {
    const resolution = resolveBotMoveChoice({
      state: working,
      legalMoves: botPlayable,
      isGhostMode: input.isGhostMode,
      ghostProfile: input.ghostProfile,
      fritzDifficulty: input.fritzDifficulty,
      isDailyFritzMode: input.isDailyFritzMode,
    });
    chosen = resolution.chosen;
    ghostChosen = resolution.ghostChosen;
    playedTileForHighlight = resolution.playedTileForHighlight;
    result = executeBotPlayMove({
      working,
      resolution,
      isMuted: input.isMuted,
      captureGuided: (beforeState, playResult, move) => {
        input.ports.captureGuidedMatchCandidateAction(
          'fritz',
          'tile-play',
          beforeState,
          playResult,
          move,
        );
      },
    });
  }

  return {
    result,
    drew,
    passed,
    drawCount,
    chosen,
    ghostChosen,
    playedTileForHighlight,
    workingHandNumber: working.handNumber,
    actionResolved: false,
  };
}

export function finalizeBotTurnExecution(input: {
  execution: BotTurnExecutionResult;
  ports: BotTurnPorts;
  matchRef: React.MutableRefObject<BotMatchState>;
  matchSnapshotSource: BotMatchState;
  isGhostMode: boolean;
  isDailyFritzMode: boolean;
  moveCounter: number;
  setBotChainPaused: (paused: boolean) => void;
}): boolean {
  const { execution } = input;
  if (!execution.result) return false;

  syncBotChoiceState({
    ports: input.ports,
    chosen: execution.chosen,
    ghostChosen: execution.ghostChosen,
    isGhostMode: input.isGhostMode,
  });

  const snapshot = collectBotTurnSnapshot(input.matchSnapshotSource);
  return completeBotTurnAction({
    ports: input.ports,
    matchRef: input.matchRef,
    result: execution.result,
    drew: execution.drew,
    passed: execution.passed,
    drawCount: execution.drawCount,
    workingHandNumber: execution.workingHandNumber,
    snapshot,
    chosen: execution.chosen,
    ghostChosen: execution.ghostChosen,
    playedTileForHighlight: execution.playedTileForHighlight,
    isGhostMode: input.isGhostMode,
    isDailyFritzMode: input.isDailyFritzMode,
    moveCounter: input.moveCounter,
    setBotChainPaused: input.setBotChainPaused,
  });
}
