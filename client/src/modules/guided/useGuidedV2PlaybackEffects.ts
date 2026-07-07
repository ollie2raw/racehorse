import { useEffect } from 'react';
import {
  notifyGuidedV2EventToasts,
  sameTileKeyMultiset,
  syncGuidedBoneyardCount,
} from './guidedBotMatchHelpers.ts';
import type { BotMatchState, BotPlayerId } from '../match/runtime/botEngine.ts';
import { parseTileKey, toTileKey } from '../../game/tileKeys.ts';
import type { LessonV2, LessonV2Event } from '../../learn/lessonV2.ts';
import { getLessonV2Module, parseLessonV2BoardState } from '../match/bootstrap/lessonV2LazyRegistry.ts';
import {
  playDrawSound,
  playHandLoseSound,
  playHandWinSound,
  playScoreSound,
  playTileSound,
  queueSound,
} from '../../utils/sound.ts';
import type { BotHandReveal } from '../match/types.ts';
import { buildBotMatchStateFromV2Event } from './guidedV2State.ts';

export type UseGuidedV2PlaybackEffectsArgs = {
  guidedV2PlaybackReady: boolean;
  frozenV2Lesson: LessonV2 | null;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
  guidedV2EventIndex: number;
  setGuidedV2EventIndex: React.Dispatch<React.SetStateAction<number>>;
  setIsGuidedV2OffLine: React.Dispatch<React.SetStateAction<boolean>>;
  fritzV2LastAppliedIndexRef: React.MutableRefObject<number>;
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  setSelectedTile: (tile: import('../../types.ts').Tile | null) => void;
  setSelectedController: (player: BotPlayerId | null) => void;
  clearHandReveal: () => void;
  scheduleHandReveal: (reveal: BotHandReveal, delayMs: number) => void;
  scheduleDrawStepAnimation: (drawer: BotPlayerId, nextState: BotMatchState) => void;
  opponentLabel: string;
  showScoreToast: (player: 'you' | 'bot', points: number) => void;
  showBoardToast: (message: string, tone: 'you' | 'bot') => void;
  isMuted: boolean;
  currentExpectedV2PlayerEvent: LessonV2Event | null;
};

export function useGuidedV2PlaybackEffects(args: UseGuidedV2PlaybackEffectsArgs): void {
  const {
    guidedV2PlaybackReady,
    frozenV2Lesson,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    guidedV2EventIndex,
    setGuidedV2EventIndex,
    setIsGuidedV2OffLine,
    fritzV2LastAppliedIndexRef,
    match,
    matchRef,
    setMatch,
    setSelectedTile,
    setSelectedController,
    clearHandReveal,
    scheduleHandReveal,
    scheduleDrawStepAnimation,
    opponentLabel,
    showScoreToast,
    showBoardToast,
    isMuted,
    currentExpectedV2PlayerEvent,
  } = args;

  useEffect(() => {
    if (!guidedV2PlaybackReady || !frozenV2Lesson) return;
    const playback = getLessonV2Module().initGuidedV2Playback(frozenV2Lesson, 1);
    if (!playback.state) return;

    fritzV2LastAppliedIndexRef.current = -1;
    setGuidedV2EventIndex(playback.firstEventIndex);
    setIsGuidedV2OffLine(false);
    setSelectedTile(null);
    setSelectedController(null);
    clearHandReveal();
    setMatch({
      ...playback.state,
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
      opponentMissingEvidence: [],
    });
  }, [guidedV2PlaybackReady, frozenV2Lesson, clearHandReveal, setMatch, setSelectedTile, setSelectedController, fritzV2LastAppliedIndexRef, setGuidedV2EventIndex, setIsGuidedV2OffLine]);

  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    if (match.handOver || match.gameOver) return;

    const event = frozenV2Lesson.events[guidedV2EventIndex];
    if (!event || event.actor !== 'fritz') return;

    const timer = setTimeout(() => {
      if (fritzV2LastAppliedIndexRef.current === guidedV2EventIndex) return;
      fritzV2LastAppliedIndexRef.current = guidedV2EventIndex;

      console.log('[guided-v2-fritz-apply]', {
        guidedV2EventIndex,
        eventIndex: event.eventIndex,
        tile: event.tile ?? null,
        position: event.position ?? null,
        expectedPlayerHandAfter: event.playerHandAfter,
        expectedFritzHandAfter: event.fritzHandAfter,
      });

      const nextState = buildBotMatchStateFromV2Event(matchRef.current, event);
      const { playerHand, fritzHand } = (() => {
        const board = parseLessonV2BoardState(event.boardAfter);
        void board;
        return {
          playerHand: nextState.players.you.hand,
          fritzHand: nextState.players.bot.hand,
        };
      })();

      setMatch(nextState);
      if (event.action === 'draw') {
        scheduleDrawStepAnimation('bot', nextState);
      }

      window.setTimeout(() => {
        const live = matchRef.current;
        console.log('[guided-v2-fritz-after]', {
          guidedV2EventIndex,
          eventIndex: event.eventIndex,
          tile: event.tile ?? null,
          liveCurrentPlayer: live.currentPlayer,
          livePlayerHand: live.players.you.hand.map(toTileKey),
          liveFritzHand: live.players.bot.hand.map(toTileKey),
        });
      }, 0);

      notifyGuidedV2EventToasts(event, opponentLabel, { showScoreToast, showBoardToast });

      if (event.pointsScored > 0) queueSound(() => playScoreSound(event.pointsScored, isMuted), 80);
      if (event.action === 'play') queueSound(() => playTileSound('standard', isMuted), 0);
      if (event.action === 'draw') queueSound(() => playDrawSound(isMuted), 0);
      if (event.handOver) {
        const won = event.handEnded?.winner === 'fritz';
        queueSound(() => won ? playHandWinSound(isMuted) : playHandLoseSound(isMuted), 400);
      }

      setGuidedV2EventIndex((i) => i + 1);

      if (event.handOver && event.handEnded) {
        scheduleHandReveal({
          winner: event.handEnded.winner === 'player' ? 'you'
            : event.handEnded.winner === 'fritz' ? 'bot'
            : null,
          reason: event.handEnded.reason,
          pointsAwarded: event.handEnded.pointsAwarded,
          loserPips: event.handEnded.loserPips,
          calcText: event.handEnded.calcText,
          yourRemainingTiles: playerHand,
          botRemainingTiles: fritzHand,
        }, 600);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine, match.handOver, match.gameOver, isMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    if (match.handOver || match.gameOver || match.currentPlayer !== 'you') return;

    const event = frozenV2Lesson.events[guidedV2EventIndex];
    if (!event || event.actor !== 'player' || event.action !== 'play' || !event.tile) return;

    const liveHandKeys = match.players.you.hand.map(toTileKey);
    if (liveHandKeys.includes(event.tile)) return;
    if (!sameTileKeyMultiset(liveHandKeys, event.playerHandAfter)) return;

    const missingTile = parseTileKey(event.tile);
    if (!missingTile) return;

    console.log('[guided-v2-player-repair-draw]', {
      guidedV2EventIndex,
      eventIndex: event.eventIndex,
      missingTile: event.tile,
      liveHandKeys,
      expectedHandAfter: event.playerHandAfter,
      repairedBoneyardCount: event.boneyardCountAfter + 1,
    });

    setMatch((prev) => ({
      ...prev,
      boneyard: syncGuidedBoneyardCount(prev.boneyard, event.boneyardCountAfter + 1),
      players: {
        ...prev.players,
        you: {
          ...prev.players.you,
          hand: [...prev.players.you.hand, missingTile],
        },
      },
    }));
  }, [
    isGuidedV2Mode,
    frozenV2Lesson,
    guidedV2EventIndex,
    isGuidedV2OffLine,
    match.handOver,
    match.gameOver,
    match.currentPlayer,
    match.players.you.hand,
    setMatch,
  ]);

  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    if (match.handOver || match.gameOver) return;

    const event = frozenV2Lesson.events[guidedV2EventIndex];
    if (!event || event.actor !== 'player') return;
    if (event.action !== 'draw' && event.action !== 'pass') return;

    const timer = setTimeout(() => {
      const nextState = buildBotMatchStateFromV2Event(matchRef.current, event);
      const playerHand = nextState.players.you.hand;
      const fritzHand = nextState.players.bot.hand;

      setMatch(nextState);

      notifyGuidedV2EventToasts(event, opponentLabel, { showScoreToast, showBoardToast });
      if (event.action === 'draw') {
        scheduleDrawStepAnimation('you', nextState);
        queueSound(() => playDrawSound(isMuted), 0);
      }

      setGuidedV2EventIndex((i) => i + 1);

      if (event.handOver && event.handEnded) {
        scheduleHandReveal({
          winner: event.handEnded.winner === 'player' ? 'you'
            : event.handEnded.winner === 'fritz' ? 'bot'
            : null,
          reason: event.handEnded.reason,
          pointsAwarded: event.handEnded.pointsAwarded,
          loserPips: event.handEnded.loserPips,
          calcText: event.handEnded.calcText,
          yourRemainingTiles: playerHand,
          botRemainingTiles: fritzHand,
        }, 600);
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine, match.handOver, match.gameOver, isMuted]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isGuidedV2Mode || !frozenV2Lesson || isGuidedV2OffLine) return;
    const currentEvent = frozenV2Lesson.events[guidedV2EventIndex];
    if (!currentEvent) return;

    const nextPlayerEv = getLessonV2Module().nextPlayerEvent(frozenV2Lesson.events, guidedV2EventIndex);
    if (!nextPlayerEv) return;
    if (currentEvent.eventIndex !== nextPlayerEv.eventIndex) return;

    const uiStepNumber = frozenV2Lesson.events
      .slice(0, guidedV2EventIndex)
      .filter((e) => e.actor === 'player' && e.action === 'play').length;

    console.log('[guided-note-align]', JSON.stringify({
      uiStepNumber,
      eventsArrayIndex: guidedV2EventIndex,
      eventIndex: currentEvent.eventIndex,
      actor: currentEvent.actor,
      action: currentEvent.action,
      tile: currentEvent.tile,
      placementSide: currentEvent.position,
      coachingTextStart: (currentEvent.coachingText || '').substring(0, 80),
      bestMoveTile: currentExpectedV2PlayerEvent?.tile,
      playerHandTiles: currentEvent.playerHandAfter,
    }));
  }, [isGuidedV2Mode, frozenV2Lesson, guidedV2EventIndex, isGuidedV2OffLine, currentExpectedV2PlayerEvent]);
}