import { useEffect, useRef } from 'react';
import type { MoveEntry } from '../../game/moveLogger.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { buildGameRecordBody, saveGameRecord } from './gameRecord.ts';

/** How long the move log must stay unchanged after game over before it is saved (the last action lands a beat late). */
export const GAME_RECORD_SETTLE_MS = 1_500;

/**
 * Save the finished game to the server, once. Waits for the move log to stop changing after game over so a record
 * is never stored short of its final action (the server keeps the first save it receives).
 */
export function useGameRecordSave(input: {
  enabled: boolean;
  match: Pick<BotMatchState, 'gameOver' | 'winnerId' | 'dealSize' | 'dealSeed' | 'matchStarter' | 'players'>;
  moveLog: readonly MoveEntry[];
  sourceMatchId: string;
  localMatchId: string | null;
  fritzTier: string | null;
  winningScore: number | null;
}): void {
  const { enabled, match, moveLog, sourceMatchId, localMatchId, fritzTier, winningScore } = input;
  const savedRef = useRef<Set<string>>(new Set());
  const moveCount = moveLog.length;

  useEffect(() => {
    if (!enabled || !match.gameOver || moveCount === 0 || savedRef.current.has(sourceMatchId)) return;
    const timer = setTimeout(() => {
      const body = buildGameRecordBody({
        sourceMatchId,
        localMatchId,
        fritzTier,
        dealSize: match.dealSize,
        winningScore,
        matchStarter: match.matchStarter,
        dealSeed: match.dealSeed,
        scores: { you: match.players.you.score, opponent: match.players.bot.score },
        winnerId: match.winnerId,
        moveLog,
      });
      if (!body) return;
      savedRef.current.add(sourceMatchId);
      saveGameRecord(body);
    }, GAME_RECORD_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled, match, moveLog, moveCount, sourceMatchId, localMatchId, fritzTier, winningScore]);
}
