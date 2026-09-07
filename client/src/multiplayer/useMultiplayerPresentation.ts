import { useEffect, useRef } from 'react';
import { getBoardTileCount } from '../match/boardSessionUtils';
import { playTileSound, playScoreSound, playDrawSound, playYourTurnSound } from '../utils/sound';
import type { GameState, Tile } from '../types';
import type { RoomPlayer } from './protocol';
import type { FlyingTile } from '../match/liveMatchScreenTypes';

interface PresentationCoordinatorParams {
  state: GameState | null;
  you: string;
  isMutedRef: React.MutableRefObject<boolean>;
  opponentName: string;
  players: RoomPlayer[];
  myHand: Tile[];
  opponentTileCount: number;
  drawSequenceActive: boolean;
  boneyardCount: number;
  showScoreLikeToast: (message: string, tone: 'you' | 'opp') => void;
  showScoreToast: (player: 'you' | 'opp', points: number, label?: string) => void;
  setFlyingTiles: React.Dispatch<React.SetStateAction<FlyingTile[]>>;
  boneyardRef: React.RefObject<HTMLElement | null>;
  handAreaRef: React.RefObject<HTMLElement | null>;
  opponentPillRef: React.RefObject<HTMLElement | null>;
  recentAutoPasses?: string[];
}

export function useMultiplayerPresentation({
  state,
  you,
  isMutedRef,
  opponentName,
  players,
  myHand,
  opponentTileCount,
  drawSequenceActive,
  showScoreLikeToast,
  showScoreToast,
  setFlyingTiles,
  boneyardRef,
  handAreaRef,
  opponentPillRef,
  recentAutoPasses,
}: PresentationCoordinatorParams) {
  const prevStateRef = useRef<GameState | null>(null);
  const prevMyHandLenRef = useRef<number>(0);
  const prevOpponentHandLenRef = useRef<number>(0);
  const localFlyingTileIdRef = useRef<number>(0);
  const lastHandNumberRef = useRef<number | null>(null);
  const lastTurnPlayerRef = useRef<string | null>(null);
  // Highest score already announced per player. The score toast is deferred
  // ~80ms so the tile-fly animation leads; with MP-JIT-2 the optimistic apply
  // and the authoritative echo are two `state` transitions ~45ms apart, so a
  // per-render effect cleanup would cancel the pending toast before it fires.
  // Keying off "last announced score" makes the announcement idempotent across
  // that double update and lets the timer run uncancelled.
  const announcedScoreRef = useRef<Record<string, number>>({});
  const scoreToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (scoreToastTimerRef.current) clearTimeout(scoreToastTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (!state) {
      lastTurnPlayerRef.current = null;
      return;
    }
    const currentTurnPlayer = state.playerIds[state.currentPlayerIndex] ?? null;
    const prevTurnPlayer = lastTurnPlayerRef.current;
    lastTurnPlayerRef.current = currentTurnPlayer;

    if (
      prevTurnPlayer &&
      prevTurnPlayer !== currentTurnPlayer &&
      currentTurnPlayer === you &&
      !state.handOver &&
      !state.gameOver
    ) {
      playYourTurnSound(isMutedRef.current);
    }
  }, [state, you, isMutedRef]);

  useEffect(() => {
    if (!state) {
      prevStateRef.current = null;
      announcedScoreRef.current = {};
      return;
    }
    const prev = prevStateRef.current;
    prevStateRef.current = state;
    if (!prev) return;

    if (state.handNumber !== prev.handNumber) return;

    const actorId = prev.playerIds[prev.currentPlayerIndex] ?? null;
    if (!actorId) return;

    const prevBoardCount = getBoardTileCount(prev.board);
    const nextBoardCount = getBoardTileCount(state.board);
    const prevBoneyardLen = prev.boneyard?.length ?? 0;
    const nextBoneyardLen = state.boneyard?.length ?? 0;

    if (nextBoardCount > prevBoardCount) {
      if (actorId !== you) {
        playTileSound('standard', isMutedRef.current);
      }
    }

    if (actorId !== you && nextBoardCount === prevBoardCount) {
      if (nextBoneyardLen < prevBoneyardLen) {
        showScoreLikeToast(`${opponentName} drew a tile`, 'opp');
      } else if (recentAutoPasses?.includes(actorId)) {
        showScoreLikeToast(`${opponentName} passed`, 'opp');
      }
    }

    for (const pid of state.playerIds) {
      const nextScore = state.players[pid]?.score ?? 0;
      const announced = announcedScoreRef.current[pid] ?? (prev.players[pid]?.score ?? 0);
      const delta = nextScore - announced;

      if (delta > 0 && !state.handOver && !state.gameOver) {
        announcedScoreRef.current[pid] = nextScore;
        const tone = pid === you ? 'you' : 'opp';
        const label = players.find((p) => p.id === pid)?.username?.trim() || (pid === you ? 'You' : opponentName);

        if (scoreToastTimerRef.current) clearTimeout(scoreToastTimerRef.current);
        scoreToastTimerRef.current = setTimeout(() => {
          scoreToastTimerRef.current = null;
          playScoreSound(delta, isMutedRef.current);
          showScoreToast(tone, delta, label);
        }, 80);
        break;
      }

      announcedScoreRef.current[pid] = Math.max(announced, nextScore);
    }
  }, [state, you, isMutedRef, opponentName, players, showScoreLikeToast, showScoreToast, recentAutoPasses]);

  useEffect(() => {
    if (!state) {
      prevMyHandLenRef.current = 0;
      prevOpponentHandLenRef.current = 0;
      lastHandNumberRef.current = null;
      return;
    }

    const currentMyHandLen = myHand.length;
    const currentOppHandLen = opponentTileCount;
    const prevMyHandLen = prevMyHandLenRef.current;
    const prevOppHandLen = prevOpponentHandLenRef.current;

    const currentHandNumber = state.handNumber;
    const isNewHand = lastHandNumberRef.current !== null && lastHandNumberRef.current !== currentHandNumber;
    lastHandNumberRef.current = currentHandNumber;

    if (isNewHand) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (prevMyHandLen === 0 && prevOppHandLen === 0) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    if (drawSequenceActive) {
      prevMyHandLenRef.current = currentMyHandLen;
      prevOpponentHandLenRef.current = currentOppHandLen;
      return;
    }

    const animationTimers: number[] = [];

    if (currentMyHandLen > prevMyHandLen) {
      const drawnCount = currentMyHandLen - prevMyHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !handAreaRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = handAreaRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    if (currentOppHandLen > prevOppHandLen) {
      const drawnCount = currentOppHandLen - prevOppHandLen;
      for (let i = 0; i < drawnCount; i++) {
        const t = window.setTimeout(() => {
          if (!boneyardRef.current || !opponentPillRef.current) return;
          playDrawSound(isMutedRef.current);
          const from = boneyardRef.current.getBoundingClientRect();
          const to = opponentPillRef.current.getBoundingClientRect();
          const id = ++localFlyingTileIdRef.current;

          setFlyingTiles((prevTiles) => [
            ...(prevTiles || []),
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);

          const ftRemove = window.setTimeout(() => {
            setFlyingTiles((prevTiles) => (prevTiles || []).filter((tile) => tile.id !== id));
          }, 1800);
          animationTimers.push(ftRemove);
        }, i * 150);
        animationTimers.push(t);
      }
    }

    prevMyHandLenRef.current = currentMyHandLen;
    prevOpponentHandLenRef.current = currentOppHandLen;

    return () => {
      animationTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    state,
    myHand.length,
    opponentTileCount,
    drawSequenceActive,
    isMutedRef,
    boneyardRef,
    handAreaRef,
    opponentPillRef,
    setFlyingTiles,
  ]);
}