import { toTileTuple } from '../../game/moveLogger.ts';
import {
  applyPlayMove,
  getLegalMoves,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { LocalRunToken } from '../match/types.ts';
import { shouldApplyBotActionResult } from '../match/hand-lifecycle/handLifecycleRules.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';
import type { Tile } from '../../types.ts';
import { computeBotChainPaused } from './botChainPause.ts';
import { collectBotTurnSnapshot } from './botMoveSnapshot.ts';
import { buildBotPlaceMoveLogEntry } from './botMoveLogEntries.ts';
import type { BotTurnPorts } from './types.ts';
import { chooseOfficialFritzBotChoice } from '../match/runtime/gameCoreAdapter.ts';

export type BotThinkingFallbackOutcome = {
  applied: boolean;
  cancelled: boolean;
  actionResolved: boolean;
};

export function executeBotThinkingFallback(input: {
  live: BotMatchState;
  ports: BotTurnPorts;
  runToken: LocalRunToken;
  isLocalRunCurrent: (token: LocalRunToken) => boolean;
  matchRef: React.MutableRefObject<BotMatchState>;
  finishLocalRun: (token: LocalRunToken) => void;
  setBotChainPaused: (paused: boolean) => void;
  cancelled: boolean;
  actionResolved: boolean;
  isDailyFritzMode: boolean;
  fritzDifficulty: import('../fritz/botHeuristics.ts').BotDifficulty;
}): BotThinkingFallbackOutcome {
  if (input.cancelled || input.actionResolved) {
    return { applied: false, cancelled: input.cancelled, actionResolved: input.actionResolved };
  }
  if (!input.isLocalRunCurrent(input.runToken)) {
    return { applied: false, cancelled: input.cancelled, actionResolved: input.actionResolved };
  }

  const live = input.live;
  if (!live || live.currentPlayer !== 'bot' || live.handOver || live.gameOver) {
    return { applied: false, cancelled: input.cancelled, actionResolved: input.actionResolved };
  }

  const officialChoice = input.isDailyFritzMode
    ? chooseOfficialFritzBotChoice(live, input.fritzDifficulty)?.move ?? null
    : null;
  const fallbackPlay = input.isDailyFritzMode
    ? (officialChoice?.type === 'play' ? officialChoice : null)
    : (officialChoice?.type === 'play'
      ? officialChoice
      : asPlayMoves(getLegalMoves(live, 'bot'))[0]);
  if (!fallbackPlay) {
    return { applied: false, cancelled: input.cancelled, actionResolved: input.actionResolved };
  }

  const snapshot = collectBotTurnSnapshot(live);
  const forcedResult = applyPlayMove(live, 'bot', fallbackPlay);
  if (forcedResult.error) {
    input.ports.showBoardToast(forcedResult.error.message, 'bot');
    return { applied: false, cancelled: input.cancelled, actionResolved: input.actionResolved };
  }
  input.ports.captureGuidedMatchCandidateAction(
    'fritz',
    'tile-play',
    live,
    forcedResult,
    fallbackPlay,
  );
  input.setBotChainPaused(computeBotChainPaused(forcedResult));

  if (fallbackPlay.tile) {
    input.ports.appendMove(
      buildBotPlaceMoveLogEntry({
        snapshot,
        tile: fallbackPlay.tile as Tile,
        position: fallbackPlay.position!,
        engineBestMove: fallbackPlay.tile
          ? {
              tile: toTileTuple(fallbackPlay.tile),
              position: fallbackPlay.position,
              score: 0,
            }
          : null,
      }),
      live.handNumber,
    );
  }

  input.ports.setLastBotChoice(null);
  input.ports.setSelectedTile(null);

  if (!input.isLocalRunCurrent(input.runToken)) {
    return { applied: false, cancelled: true, actionResolved: true };
  }
  if (!shouldApplyBotActionResult(input.matchRef.current, forcedResult)) {
    return { applied: false, cancelled: true, actionResolved: true };
  }

  input.finishLocalRun(input.runToken);
  input.ports.applyAndNotify(forcedResult);
  input.ports.flashLastPlayed(fallbackPlay.tile ?? null);

  return { applied: true, cancelled: true, actionResolved: true };
}
