import type { BotActionResult } from './botEngine';

export function toastFromResult(result: BotActionResult, opponentLabel: string): string {
  if (result.handEnded) {
    const winner = result.handEnded.winner === 'you' ? 'You' : opponentLabel;
    return `${winner} won hand (${result.handEnded.reason}) +${result.handEnded.pointsAwarded}`;
  }
  if (result.passed) return `${result.passed.player === 'you' ? 'You' : opponentLabel} passed`;
  return '';
}
