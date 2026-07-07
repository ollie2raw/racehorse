import { buildBotHandOverReveals } from '../../components/handOver/handOverCopy.ts';
import type { HandOverTileReveal } from '../../components/handOver/handOverCopy.ts';
import type { BotHandReveal } from '../botMatchScreenTypes.ts';

export function buildHandRevealTileReveals(
  handReveal: BotHandReveal | null,
  opponentLabel: string,
): HandOverTileReveal[] {
  if (!handReveal) return [];
  return buildBotHandOverReveals(handReveal, opponentLabel);
}