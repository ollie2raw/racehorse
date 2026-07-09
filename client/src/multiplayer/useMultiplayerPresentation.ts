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
      const prevScore = prev.players[pid]?.score ?? 0;
      const nextScore = state.players[pid]?.score ?? 0;
      const delta = nextScore - prevScore;

      if (delta > 0 && !state.handOver && !state.gameOver) {
        const tone = pid === you ? 'you' : 'opp';
        const label = players.find((p) => p.id === pid)?.username?.trim() || (pid === you ? 'You' : opponentName);

        const timer = setTimeout(() => {
          playScoreSound(delta, isMutedRef.current);
          showScoreToast(tone, delta, label);
        }, 80);

        return () => clearTimeout(timer);
      }
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