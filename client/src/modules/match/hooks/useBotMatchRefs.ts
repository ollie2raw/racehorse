import { useCallback, useRef, useState } from 'react';
import type { BoardHandle } from '../../../components/index.ts';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { AuthoredStep } from '../../../learn/guidedAuthoring.ts';

export type UseBotMatchRefsArgs = {
  initialMoveLog?: MoveEntry[];
};

export function useBotMatchRefs({ initialMoveLog = [] }: UseBotMatchRefsArgs = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const boardStageRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<BoardHandle>(null);
  const handAreaRef = useRef<HTMLDivElement>(null);
  const boneyardRef = useRef<HTMLDivElement>(null);
  const opponentPillRef = useRef<HTMLButtonElement>(null);
  const guidedBoneyardAnchorRef = useRef<HTMLDivElement>(null);
  const guidedFritzAnchorRef = useRef<HTMLButtonElement>(null);

  const [drawPulseIndex, setDrawPulseIndex] = useState<number | null>(null);
  const [drawSequenceActive, setDrawSequenceActive] = useState(false);
  const drawSequenceActiveRef = useRef(false);
  const setDrawSequenceActiveBoth = useCallback((val: boolean) => {
    drawSequenceActiveRef.current = val;
    setDrawSequenceActive(val);
  }, []);

  const [flyingTiles, setFlyingTiles] = useState<
    { x: number; y: number; toX: number; toY: number; id: number }[]
  >([]);
  const flyingTileIdRef = useRef(0);

  const moveCounterRef = useRef(
    initialMoveLog.reduce(
      (max, entry) => Math.max(max, entry.moveNumber),
      0,
    ) + 1,
  );

  const dailyResultSyncKeyRef = useRef('');
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scoreToastClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lastPlayedTileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameWinConfettiKeyRef = useRef('');
  const gameOverSoundKeyRef = useRef('');
  const lastDailyFlowLabelRef = useRef('init');
  const prevTurnRef = useRef<import('../runtime/botEngine.ts').BotPlayerId>('you');
  const localPendingRegisteredRef = useRef(false);
  const localPendingResolvedRef = useRef(false);
  const accessTokenRef = useRef<string | null>(null);
  const fritzSessionReplyRef = useRef<Required<AuthoredStep>['fritzReplyEvents']>([]);
  const isTransitioningRef = useRef(false);

  return {
    rootRef,
    boardStageRef,
    boardRef,
    handAreaRef,
    boneyardRef,
    opponentPillRef,
    guidedBoneyardAnchorRef,
    guidedFritzAnchorRef,
    drawPulseIndex,
    setDrawPulseIndex,
    drawSequenceActive,
    drawSequenceActiveRef,
    setDrawSequenceActiveBoth,
    flyingTiles,
    setFlyingTiles,
    flyingTileIdRef,
    moveCounterRef,
    dailyResultSyncKeyRef,
    toastTimerRef,
    scoreToastHideTimerRef,
    scoreToastClearTimerRef,
    lastPlayedTileTimerRef,
    gameWinConfettiKeyRef,
    gameOverSoundKeyRef,
    lastDailyFlowLabelRef,
    prevTurnRef,
    localPendingRegisteredRef,
    localPendingResolvedRef,
    accessTokenRef,
    fritzSessionReplyRef,
    isTransitioningRef,
  };
}

export type UseBotMatchRefsResult = ReturnType<typeof useBotMatchRefs>;