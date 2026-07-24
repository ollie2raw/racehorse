import { useCallback, useRef } from 'react';
import type { BotChoice } from '../fritz/botHeuristics.ts';
import { useBotTurnEffect } from './useBotTurnEffect.ts';
import type { UseBotTurnEffectArgs } from './useBotTurnEffect.ts';

export type UseBotTurnOrchestrationArgs = Omit<
  UseBotTurnEffectArgs,
  'botChainPauseRef' | 'botTurnInFlightRef'
> & {
  lastBotChoice: BotChoice | null;
  setLastBotChoice: (choice: BotChoice | null) => void;
};

export type UseBotTurnOrchestrationResult = {
  lastBotChoice: BotChoice | null;
  setLastBotChoice: (choice: BotChoice | null) => void;
  isBotChainPaused: () => boolean;
};

export function useBotTurnOrchestration(
  args: UseBotTurnOrchestrationArgs,
): UseBotTurnOrchestrationResult {
  const { lastBotChoice, setLastBotChoice, ...effectArgs } = args;
  const botChainPauseRef = useRef(false);
  const botTurnInFlightRef = useRef(false);
  const isBotChainPaused = useCallback(() => botChainPauseRef.current, []);

  useBotTurnEffect({
    ...effectArgs,
    botChainPauseRef,
    botTurnInFlightRef,
  });

  return {
    lastBotChoice,
    setLastBotChoice,
    isBotChainPaused,
  };
}
