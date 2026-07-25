import type { BotMatchState } from '../../botEngine.ts';
import type { BotMatchViewPreGameDraw } from '../../view-model/botMatchViewModelTypes.ts';
import type { FritzPresentationState } from '../../../modules/bot-turn/fritzPresentation.ts';
import { buildFritzTurnLabel } from '../../../modules/bot-turn/fritzPresentation.ts';

export function selectTurnLabel(
  match: BotMatchState,
  opponentLabel: string,
  botTurn: boolean,
  presentation?: FritzPresentationState | null,
): string {
  return buildFritzTurnLabel({
    opponentLabel,
    botTurn,
    presentation,
    handOver: match.handOver,
    gameOver: match.gameOver,
    winnerId: match.winnerId,
  });
}

export type PreGameDrawHudContent = {
  label: string;
  tone: 'your-turn' | 'opp-turn';
};

export function buildPreGameDrawHudContent(
  preGameDraw: BotMatchViewPreGameDraw,
  opponentLabel: string,
): PreGameDrawHudContent | null {
  if (!preGameDraw.drawState) return null;

  if (preGameDraw.resultMessage) {
    return {
      label: preGameDraw.resultMessage,
      tone: preGameDraw.drawState.winner === 'bot' ? 'opp-turn' : 'your-turn',
    };
  }
  if (preGameDraw.isOpponentThinking) {
    return {
      label: `${opponentLabel} is thinking…`,
      tone: 'opp-turn',
    };
  }
  if (preGameDraw.isPlayerPickEnabled) {
    return {
      label: 'Tap a tile to draw',
      tone: 'your-turn',
    };
  }
  return null;
}
