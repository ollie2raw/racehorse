import { toTileTuple } from '../../game/moveLogger.ts';
import { shouldApplyBotActionResult } from '../match/hand-lifecycle/handLifecycleRules.ts';
import type { BotActionResult, BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotChoice } from '../fritz/botHeuristics.ts';
import type { GhostResolvedMove } from '../ghost/ghostContracts.ts';
import type { Tile } from '../../types.ts';
import { notifyBotAuthoringCaptures } from './botAuthoringCapture.ts';
import { computeBotChainPaused } from './botChainPause.ts';
import { buildBotGhostPlayEntry } from './botGhostSync.ts';
import { toEngineBestFromChoice } from './fritzEvaluation.ts';
import { buildBotPlaceMoveLogEntry } from './botMoveLogEntries.ts';
import type { BotTurnSnapshot } from './botMoveSnapshot.ts';
import type { BotTurnPorts } from './types.ts';

export function logBotPlaceMove(input: {
  ports: BotTurnPorts;
  snapshot: BotTurnSnapshot;
  chosen: BotChoice | null;
  ghostChosen: GhostResolvedMove | null;
}): void {
  const tile = input.ghostChosen?.tile ?? input.chosen?.move?.tile;
  if (!tile) return;

  input.ports.appendMove(
    buildBotPlaceMoveLogEntry({
      snapshot: input.snapshot,
      tile,
      position: input.ghostChosen?.position ?? input.chosen!.move.position!,
      engineBestMove: input.ghostChosen
        ? {
            tile: toTileTuple(input.ghostChosen.tile),
            position: input.ghostChosen.position,
            score: 0,
          }
        : toEngineBestFromChoice(input.chosen),
    }),
  );
}

export function syncBotChoiceState(input: {
  ports: BotTurnPorts;
  chosen: BotChoice | null;
  ghostChosen: GhostResolvedMove | null;
  isGhostMode: boolean;
}): void {
  if (input.chosen) input.ports.setLastBotChoice(input.chosen);
  if (input.isGhostMode) {
    input.ports.setLastBotChoice(null);
    input.ports.setGhostPlayedTile(input.ghostChosen?.tile ?? null);
  }
}

export function logBotGhostPlay(input: {
  ports: BotTurnPorts;
  snapshot: BotTurnSnapshot;
  workingHandNumber: number;
  ghostChosen: GhostResolvedMove | null;
  result: BotActionResult;
  moveCounter: number;
  isGhostMode: boolean;
}): void {
  if (!input.isGhostMode || !input.ghostChosen) return;
  input.ports.appendGhostMove(
    buildBotGhostPlayEntry({
      turn: input.moveCounter,
      handNumber: input.workingHandNumber,
      boardStateKey: input.snapshot.ghostBoardStateKey,
      handBefore: input.snapshot.ghostHandBefore,
      ghostChosen: input.ghostChosen,
      scoreDelta: input.result.scored?.points ?? 0,
      forcedDraw: Boolean(input.result.drew?.player === 'bot'),
    }),
  );
}

export function notifyDailyFritzBotMove(
  ports: BotTurnPorts,
  result: BotActionResult,
  isDailyFritzMode: boolean,
): void {
  if (!isDailyFritzMode) return;
  ports.onDailyFritzBotMoveApplied?.({
    handNumber: result.state.handNumber,
    handOver: result.state.handOver,
    gameOver: result.state.gameOver,
    nextPlayer: result.state.currentPlayer,
    scored: result.scored?.points ?? 0,
  });
}

export function completeBotTurnAction(input: {
  ports: BotTurnPorts;
  matchRef: React.MutableRefObject<BotMatchState>;
  result: BotActionResult;
  drew?: boolean;
  passed?: boolean;
  workingHandNumber: number;
  snapshot: BotTurnSnapshot;
  chosen: BotChoice | null;
  ghostChosen: GhostResolvedMove | null;
  playedTileForHighlight: Tile | null;
  isGhostMode: boolean;
  isDailyFritzMode: boolean;
  moveCounter: number;
  setBotChainPaused: (paused: boolean) => void;
}): boolean {
  if (input.result.error) {
    input.ports.showBoardToast(input.result.error.message, 'bot');
    return false;
  }

  if (!shouldApplyBotActionResult(input.matchRef.current, input.result)) {
    if (import.meta.env.DEV) {
      console.log('[BOT-TURN] apply skipped — stale result', {
        liveHandOver: input.matchRef.current.handOver,
        liveGameOver: input.matchRef.current.gameOver,
        resultHandOver: input.result.state.handOver,
        resultGameOver: input.result.state.gameOver,
        hasHandEnded: Boolean(input.result.handEnded),
      });
    }
    return false;
  }

  input.setBotChainPaused(computeBotChainPaused(input.result));
  input.ports.setSelectedTile(null);

  logBotGhostPlay({
    ports: input.ports,
    snapshot: input.snapshot,
    workingHandNumber: input.workingHandNumber,
    ghostChosen: input.ghostChosen,
    result: input.result,
    moveCounter: input.moveCounter,
    isGhostMode: input.isGhostMode,
  });

  logBotPlaceMove({
    ports: input.ports,
    snapshot: input.snapshot,
    chosen: input.chosen,
    ghostChosen: input.ghostChosen,
  });

  notifyDailyFritzBotMove(input.ports, input.result, input.isDailyFritzMode);

  notifyBotAuthoringCaptures(input.ports, {
    result: input.result,
    playedTileForHighlight: input.playedTileForHighlight,
    ghostChosen: input.ghostChosen,
    chosen: input.chosen,
  });

  input.ports.applyAndNotify(input.result);
  input.ports.flashLastPlayed(input.playedTileForHighlight);
  return true;
}
