import type { BotMatchState } from '../../botEngine.ts';
import type { BotMatchViewPreGameDraw } from '../../view-model/botMatchViewModelTypes.ts';

export function selectTurnLabel(
  match: BotMatchState,
  opponentLabel: string,
  botTurn: boolean,
): string {
  if (match.handOver) {
    if (match.gameOver) {
      return match.winnerId === 'you'
        ? 'You win the match'
        : `${opponentLabel} wins the match`;
    }
    return '';
  }
  return botTurn ? `${opponentLabel} thinking` : 'Your move';
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
      label: `${opponentLabel} thinking`,
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