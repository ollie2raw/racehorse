import { useEffect } from 'react';
import { createPreGameDrawShellMatch } from '../../../match/preGameDraw/preGameDrawEligibility.ts';
import type { BotDealSize, BotMatchState } from '../runtime/botEngine.ts';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import { resolveNextMoveCounter } from './moveCounterSync.ts';

export type UseMatchTurnStackEffectsArgs = {
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  preGameDrawActive: boolean;
  winningScore: number;
  dealSize: BotDealSize;
  moveLog: readonly MoveEntry[];
  moveCounterRef: React.MutableRefObject<number>;
};

export function useMatchTurnStackEffects(args: UseMatchTurnStackEffectsArgs): void {
  const {
    match,
    matchRef,
    setMatch,
    preGameDrawActive,
    winningScore,
    dealSize,
    moveLog,
    moveCounterRef,
  } = args;

  useEffect(() => {
    if (!preGameDrawActive) return;
    setMatch((current) => {
      const isDrawShell =
        current.handNumber === 0 &&
        current.players.you.hand.length === 0 &&
        current.players.bot.hand.length === 0 &&
        current.handOver &&
        !current.gameOver;
      return isDrawShell ? current : createPreGameDrawShellMatch(winningScore, dealSize);
    });
  }, [preGameDrawActive, winningScore, dealSize, setMatch]);

  useEffect(() => {
    matchRef.current = match;
  }, [match, matchRef]);

  useEffect(() => {
    moveCounterRef.current = resolveNextMoveCounter(moveLog);
  }, [moveLog, moveCounterRef]);
}