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
import { buildBotGhostDrawEntry, buildBotGhostPassEntry } from './botGhostSync.ts';
import { executeBotPlayMove, resolveBotMoveChoice } from './botMoveResolution.ts';
import { collectBotTurnSnapshot, type BotTurnSnapshot } from './botMoveSnapshot.ts';
import type { BotTurnPorts } from './types.ts';
import { BOT_POST_DRAW_PLAY_DELAY_MS, waitMs } from './botTurnGuards.ts';

export type BotDrawPassOutcome = {
  working: BotMatchState;
  result: BotActionResult | null;
  drew: boolean;
  passed: boolean;
  /** Individual tiles drawn during the sequence (not including forced play draws). */
  drawCount: number;
  /**
   * Real, positively-observed onStep draw count (uncorrected by the boneyard
   * delta). Use this — never the boneyard-corrected `drawCount` above — to
   * cap how many 'draw' MoveEntries a Daily Fritz transcript may log; see
   * capDailyFritzDrawLogCount for why fabricating an extra draw beyond what
   * onStep actually observed is an unrecoverable server-side rejection.
   */
  onStepDrawCount: number;
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
  fritzPolicyVersion?: number;
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
  let onStepDrawCount = 0;
  const boneyardBefore = working.boneyard.length;
  const drawSnapshots: BotTurnSnapshot[] = [];
  const drawnTiles: ({ low: number; high: number } | null)[] = [];

  input.ports.setDrawSequenceActiveBoth(true);
  const drawPass = await input.runDrawSequence(
    working,
    'bot',
    input.runToken,
    (step) => {
      if (step.actionKind === 'draw') {
        drawCount += 1;
        onStepDrawCount += 1;
        drawSnapshots.push(collectBotTurnSnapshot(step.beforeState));
        drawnTiles.push(step.result.drew?.tile ?? null);
      }
      input.ports.captureGuidedMatchCandidateAction(
        'fritz',
        step.actionKind,
        step.beforeState,
        step.result,
      );
    },
  );

  if (input.cancelled() || !input.isLocalRunCurrent(input.runToken)) {
    return {
      working,
      result,
      drew: false,
      passed: false,
      drawCount: 0,
      onStepDrawCount: 0,
      chosen,
      ghostChosen,
      playedTileForHighlight,
    };
  }

  working = drawPass.state;
  // Boneyard delta is the source of truth — onStep can undercount if a turn is interrupted.
  drawCount = Math.max(drawCount, boneyardBefore - working.boneyard.length);

  if (drawPass.drew) {
    if (input.isGhostMode) {
      // Same per-draw discipline as playerGhostSync.ts's buildGhostDrawMoveLogEntry
      // (RT-2, HARDENING_PLAN §9.3) — one entry per real draw this turn, using
      // that step's own before-state, never the single pre-sequence snapshot
      // standing in for a whole multi-draw sequence.
      const ghostDrawLogCount = Math.min(drawCount, drawSnapshots.length);
      for (let index = 0; index < ghostDrawLogCount; index += 1) {
        const stepSnapshot = drawSnapshots[index] ?? input.snapshot;
        input.ports.appendGhostMove(
          buildBotGhostDrawEntry({
            turn: input.moveCounter,
            handNumber: input.matchHandNumber,
            boardStateKey: stepSnapshot.ghostBoardStateKey,
            handBefore: stepSnapshot.ghostHandBefore,
            drawnTile: drawnTiles[index] ?? null,
          }),
        );
      }
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
    // Draw-until-legal found a play — pause so the tile does not slam in.
    if (drawPass.drew && !input.cancelled()) {
      await waitMs(BOT_POST_DRAW_PLAY_DELAY_MS);
      if (input.cancelled() || !input.isLocalRunCurrent(input.runToken)) {
        return {
          working,
          result: null,
          drew: Boolean(drawPass.drew),
          passed: false,
          drawCount,
          onStepDrawCount,
          chosen,
          ghostChosen,
          playedTileForHighlight,
        };
      }
    }
    const resolution = resolveBotMoveChoice({
      state: working,
      legalMoves: afterDraw,
      isGhostMode: input.isGhostMode,
      ghostProfile: input.ghostProfile,
      fritzDifficulty: input.fritzDifficulty,
      isDailyFritzMode: input.isDailyFritzMode,
      fritzPolicyVersion: input.fritzPolicyVersion,
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
    onStepDrawCount,
    chosen,
    ghostChosen,
    playedTileForHighlight,
  };
}
