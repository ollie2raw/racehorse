import { useEffect, useRef } from 'react';
import { playTileSound, playScoreSound, playDrawSound } from '../utils/sound';
import type { GameState, Tile } from '../types';

function getBoardTileCount(board: any): number {
  if (!board || !Array.isArray(board.tiles)) return 0;
  return board.tiles.length;
}

interface PresentationCoordinatorParams {
  state: GameState | null;
  you: string;
  isMutedRef: React.MutableRefObject<boolean>;
  opponentName: string;
  players: any[];
  myHand: Tile[];
  opponentTileCount: number;
  drawSequenceActive: boolean;
  boneyardCount: number;
  showScoreLikeToast: (message: string, tone: 'you' | 'opp') => void;
  showScoreToast: (player: 'you' | 'opp', points: number, label?: string) => void;
  setFlyingTiles: React.Dispatch<React.SetStateAction<any[]>>;
  boneyardRef: React.RefObject<HTMLElement | null>;
  handAreaRef: React.RefObject<HTMLElement | null>;
  opponentPillRef: React.RefObject<HTMLElement | null>;
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
}: PresentationCoordinatorParams) {
  const prevStateRef = useRef<GameState | null>(null);
  const prevMyHandLenRef = useRef<number>(0);
  const prevOpponentHandLenRef = useRef<number>(0);
  const localFlyingTileIdRef = useRef<number>(0);

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
      } else if (state.currentPlayerIndex !== prev.currentPlayerIndex) {
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
  }, [state, you, isMutedRef, opponentName, players, showScoreLikeToast, showScoreToast]);

  useEffect(() => {
    if (!state) {
      prevMyHandLenRef.current = 0;
      prevOpponentHandLenRef.current = 0;
      return;
    }

    const currentMyHandLen = myHand.length;
    const currentOppHandLen = opponentTileCount;
    const prevMyHandLen = prevMyHandLenRef.current;
    const prevOppHandLen = prevOpponentHandLenRef.current;

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
