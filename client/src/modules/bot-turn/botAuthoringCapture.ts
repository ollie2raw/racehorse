import type { BotActionResult } from '../match/runtime/botEngine.ts';
import type { BotChoice } from '../fritz/botHeuristics.ts';
import type { GhostResolvedMove } from '../ghost/ghostContracts.ts';
import type { Tile } from '../../types.ts';
import type { BotTurnPorts } from './types.ts';

export function deriveBotCaptureAction(result: BotActionResult): 'play' | 'draw' | 'pass' {
  if (result.drew) return 'draw';
  if (result.passed) return 'pass';
  return 'play';
}

export function notifyBotAuthoringCaptures(
  ports: BotTurnPorts,
  input: {
    result: BotActionResult;
    playedTileForHighlight: Tile | null;
    ghostChosen: GhostResolvedMove | null;
    chosen: BotChoice | null;
  },
): void {
  const captureAction = deriveBotCaptureAction(input.result);
  ports.onAuthoringFritzActionCaptured?.({
    result: input.result,
    captureAction,
    playedTileForHighlight: input.playedTileForHighlight,
    ghostChosen: input.ghostChosen,
    chosen: input.chosen,
  });
  ports.onAuthoringV2FritzEvent?.({
    result: input.result,
    captureAction,
    playedTileForHighlight: input.playedTileForHighlight,
    ghostChosen: input.ghostChosen,
    chosen: input.chosen,
  });
}