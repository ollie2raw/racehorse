import {
  createFixedBotHand,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';

export function shouldRunDailyFritzPreGameDraw(
  dailyFritzPackage: DailyFritzStartResponse | null | undefined,
): boolean {
  return Boolean(dailyFritzPackage && dailyFritzPackage.current_hand_index === 0);
}

export function createDailyFritzOfficialMatch(
  dailyFritzPackage: DailyFritzStartResponse,
  winningScore: number,
): BotMatchState {
  const scores = dailyFritzPackage.current_game_scores ?? { you: 0, fritz: 0 };
  return createFixedBotHand(
    { you: scores.you, bot: scores.fritz },
    dailyFritzPackage.current_hand_index + 1,
    winningScore,
    dailyFritzPackage.deal_size,
    dailyFritzPackage.first_hand,
    dailyFritzPackage.draw_winner === 'bot' ? 'bot' : 'you',
  );
}
