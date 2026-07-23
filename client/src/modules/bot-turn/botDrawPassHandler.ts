import {
  getLegalMoves,
  type BotActionResult,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import type { LocalRunToken } from '../match/types.ts';
import type { GhostProfileSummary } from '../ghost/ghostContracts.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';
import type { RunDrawSequence } from './drawSequence.ts';
import { BOT_DRAW_STEP_MS } from './botTurnGuards.ts';
import { buildBotGhostDrawEntry, buildBotGhostPassEntry } from './botGhostSync.ts';
import { executeBotPlayMove, resolveBotMoveChoice } from './botMoveResolution.ts';
import type { BotTurnSnapshot } from './botMoveSnapshot.ts';
import type { BotTurnPorts } from './types.ts';

export type BotDrawPassOutcome = {
  working: BotMatchState;
  result: BotActionResult | null;
  drew: boolean;
  passed: boolean;
  /** Individual tiles drawn during the sequence (not including forced play draws). */
  drawCount: number;
  chosen: import('../fritz/botHeuristics.ts').BotChoice | null;
  ghostChosen: import('../ghost/ghostContracts.ts').GhostResolvedMove | null;
  playedTileForHighlight: import('../../types.ts').Tile | null;
};

export async function runBotDrawPassSequence(input: {
  working: BotMatchState;
  snapshot: BotTurnSnapshot;
  ports: BotTurnPorts;
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
  matchHandNumber: number;
}): Promise<BotDrawPassOutcome> {
  let working = input.working;
  let result: BotActionResult | null = null;
  let chosen: BotDrawPassOutcome['chosen'] = null;
  let ghostChosen: BotDrawPassOutcome['ghostChosen'] = null;
  let playedTileForHighlight: BotDrawPassOutcome['playedTileForHighlight'] = null;
  let drawCount = 0;

  input.ports.setDrawSequenceActiveBoth(true);
  const drawPass = await input.runDrawSequence(
    working,
    'bot',
    input.runToken,
    (step) => {
      if (step.actionKind === 'draw') drawCount += 1;
      input.ports.captureGuidedMatchCandidateAction(
        'fritz',
        step.actionKind,
        step.beforeState,
        step.result,
      );
    },
    BOT_DRAW_STEP_MS,
  );

  if (input.cancelled() || !input.isLocalRunCurrent(input.runToken)) {
    return {
      working,
      result,
      drew: false,
      passed: false,
      drawCount: 0,
      chosen,
      ghostChosen,
      playedTileForHighlight,
    };
  }

  working = drawPass.state;

  if (drawPass.drew) {
    if (input.isGhostMode) {
      input.ports.appendGhostMove(
        buildBotGhostDrawEntry({
          turn: input.moveCounter,
          handNumber: input.matchHandNumber,
          boardStateKey: input.snapshot.ghostBoardStateKey,
          handBefore: input.snapshot.ghostHandBefore,
        }),
      );
    }
  }

  if (drawPass.passed) {
    if (input.isGhostMode) {
      input.ports.appendGhostMove(
        buildBotGhostPassEntry({
          turn: input.moveCounter,
          handNumber: working.handNumber,
          boardStateKey: input.snapshot.ghostBoardStateKey,
          handBefore: input.snapshot.ghostHandBefore,
        }),
      );
    }
  }

  const afterDraw = asPlayMoves(getLegalMoves(working, 'bot'));
  if (afterDraw.length === 0) {
    result = drawPass;
  } else {
    const resolution = resolveBotMoveChoice({
      state: working,
      legalMoves: afterDraw,
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
    working,
    result,
    drew: Boolean(drawPass.drew),
    passed: Boolean(drawPass.passed),
    drawCount,
    chosen,
    ghostChosen,
    playedTileForHighlight,
  };
}
