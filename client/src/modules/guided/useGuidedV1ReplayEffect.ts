import { useEffect } from 'react';
import { parseGuidedTranscriptState } from './guidedBotMatchHelpers.ts';
import type { BotActionResult, BotHandEndReason, BotMatchState, BotPlayerId } from '../match/runtime/botEngine.ts';
import type { GuidedTranscript } from '../../learn/guidedAuthoring.ts';
import { parseTileKey } from '../../game/tileKeys.ts';
import type { Tile } from '../../types.ts';
import {
  playDrawSound,
  playTileSound,
  queueSound,
} from '../../utils/sound.ts';

export type UseGuidedV1ReplayEffectArgs = {
  isGuidedTranscriptMode: boolean;
  isOffAuthoredLine: boolean;
  guidedTranscript: GuidedTranscript | null;
  guidedV1Replay: { stepIndex: number; replyIndex: number } | null;
  setGuidedV1Replay: React.Dispatch<React.SetStateAction<{ stepIndex: number; replyIndex: number } | null>>;
  setLessonStepIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsOffAuthoredLine: React.Dispatch<React.SetStateAction<boolean>>;
  pushToast: (msg: string, ms?: number) => void;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  notifyBotActionResult: (result: BotActionResult) => void;
  flashLastPlayed: (tile: Tile | null) => void;
  isMuted: boolean;
  triggerDrawStepAnimation: (drawer: BotPlayerId, nextState: BotMatchState) => void;
};

export function useGuidedV1ReplayEffect(args: UseGuidedV1ReplayEffectArgs): void {
  const {
    isGuidedTranscriptMode,
    isOffAuthoredLine,
    guidedTranscript,
    guidedV1Replay,
    setGuidedV1Replay,
    setLessonStepIndex,
    setIsOffAuthoredLine,
    pushToast,
    setMatch,
    notifyBotActionResult,
    flashLastPlayed,
    isMuted,
    triggerDrawStepAnimation,
  } = args;

  useEffect(() => {
    if (!isGuidedTranscriptMode || isOffAuthoredLine || !guidedTranscript || !guidedV1Replay) return;

    const turn = guidedTranscript.turns.find((item) => item.stepIndex === guidedV1Replay.stepIndex) ?? null;
    const replyEvents = turn?.fritzReplies ?? [];
    if (replyEvents.length === 0) {
      pushToast('This transcript turn is missing Fritz reply events.');
      setGuidedV1Replay(null);
      setIsOffAuthoredLine(true);
      return;
    }
    if (guidedV1Replay.replyIndex >= replyEvents.length) {
      setGuidedV1Replay(null);
      setLessonStepIndex((prev) => prev + 1);
      return;
    }

    const event = replyEvents[guidedV1Replay.replyIndex]!;
    const delay = event.type === 'play' ? (event.pointsScored > 0 ? 1600 : 1200) : 800;

    const timer = window.setTimeout(() => {
      const nextState = parseGuidedTranscriptState(event.stateAfter);
      if (!nextState) {
        pushToast('This transcript reply is missing a valid state.');
        setGuidedV1Replay(null);
        setIsOffAuthoredLine(true);
        return;
      }

      const actionResult: BotActionResult = {
        state: nextState,
        scored: event.pointsScored > 0 ? { player: 'bot', points: event.pointsScored } : undefined,
        drew: event.type === 'draw' && event.tile ? { player: 'bot', tile: parseTileKey(event.tile)! } : undefined,
        passed: event.type === 'pass' ? { player: 'bot' } : undefined,
        handEnded: event.handEnded ? {
          winner: event.handEnded.winner as BotPlayerId | null,
          reason: event.handEnded.reason as BotHandEndReason,
          pointsAwarded: event.handEnded.pointsAwarded,
          loserPips: event.handEnded.loserPips,
          calcText: event.handEnded.calcText,
        } : undefined,
      };

      setMatch(nextState);
      notifyBotActionResult(actionResult);

      if (event.type === 'play' && event.tile) {
        const playedTile = parseTileKey(event.tile);
        if (playedTile) {
          flashLastPlayed(playedTile);
          queueSound(() => playTileSound('deal', isMuted), 0);
        }
      } else if (event.type === 'draw') {
        triggerDrawStepAnimation('bot', nextState);
        queueSound(() => playDrawSound(isMuted), 0);
      }

      setGuidedV1Replay((prev) =>
        prev && prev.stepIndex === guidedV1Replay.stepIndex
          ? { ...prev, replyIndex: prev.replyIndex + 1 }
          : prev,
      );
    }, delay);

    return () => window.clearTimeout(timer);
  }, [
    guidedTranscript,
    guidedV1Replay,
    isGuidedTranscriptMode,
    isMuted,
    isOffAuthoredLine,
    pushToast,
    flashLastPlayed,
    setMatch,
    triggerDrawStepAnimation,
    notifyBotActionResult,
    setGuidedV1Replay,
    setIsOffAuthoredLine,
    setLessonStepIndex,
  ]);
}