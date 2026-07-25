import { useCallback, useRef, useState } from 'react';
import type { BotChoice } from '../fritz/botHeuristics.ts';
import { useBotTurnEffect } from './useBotTurnEffect.ts';
import type { UseBotTurnEffectArgs } from './useBotTurnEffect.ts';
import {
  IDLE_FRITZ_PRESENTATION,
  type FritzPresentationState,
} from './fritzPresentation.ts';

export type UseBotTurnOrchestrationArgs = Omit<
  UseBotTurnEffectArgs,
  'botChainPauseRef' | 'botTurnInFlightRef' | 'setFritzPresentation'
> & {
  lastBotChoice: BotChoice | null;
  setLastBotChoice: (choice: BotChoice | null) => void;
};

export type UseBotTurnOrchestrationResult = {
  lastBotChoice: BotChoice | null;
  setLastBotChoice: (choice: BotChoice | null) => void;
  isBotChainPaused: () => boolean;
  fritzPresentation: FritzPresentationState;
};

export function useBotTurnOrchestration(
  args: UseBotTurnOrchestrationArgs,
): UseBotTurnOrchestrationResult {
  const { lastBotChoice, setLastBotChoice, ...effectArgs } = args;
  const botChainPauseRef = useRef(false);
  const botTurnInFlightRef = useRef(false);
  const [fritzPresentation, setFritzPresentation] = useState<FritzPresentationState>(
    IDLE_FRITZ_PRESENTATION,
  );
  const isBotChainPaused = useCallback(() => botChainPauseRef.current, []);

  useBotTurnEffect({
    ...effectArgs,
    botChainPauseRef,
    botTurnInFlightRef,
    setFritzPresentation,
  });

  return {
    lastBotChoice,
    setLastBotChoice,
    isBotChainPaused,
    fritzPresentation,
  };
}
