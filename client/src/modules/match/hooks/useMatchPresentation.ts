import { useCallback, useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import type { Tile } from '../../../types.ts';
import { buildPlayableTileKeys } from '../../../utils/handTileLegality.ts';
import { logger } from '../../../utils/logger.ts';
import {
  assertDisplayedOpenCountMatchesCanonical,
  computeOpenEndsSum,
  getDisplayOpenEnds,
  getLegalMoves,
} from '../runtime/botEngine.ts';
import { asPlayMoves } from '../../../game/tileUtils.ts';
import {
  playMatchLoseSound,
  playMatchWinSound,
  playYourTurnSound,
  queueSound,
} from '../../../utils/sound.ts';
import {
  hasDebugLocalStorageFlag,
} from '../runtime/botMatchDebug.ts';
import { traceDailyFritzEvent } from '../../daily/dailyFritzMatchDiagnostics.ts';
import type { UseBotMatchBootstrapResult } from './useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from './useBotMatchRefs.ts';
import type { UseGuidedLessonBootResult } from '../../guided/index.ts';

export type UseMatchPresentationArgs = {
  bootstrap: UseBotMatchBootstrapResult;
  refs: UseBotMatchRefsResult;
  guidedBoot: UseGuidedLessonBootResult;
  chrome: {
    isFullscreen: boolean;
    isMuted: boolean;
  };
  invalidateLocalRuns: () => void;
};

export function useMatchPresentation({
  bootstrap,
  refs,
  guidedBoot,
  chrome,
  invalidateLocalRuns,
}: UseMatchPresentationArgs) {
  const {
    match,
    mode,
    opponentLabel,
    isDailyFritzMode,
  } = bootstrap;
  const { isMuted } = chrome;
  const { lessonLayoutMode } = guidedBoot;
  const {
    rootRef,
    handAreaRef,
    toastTimerRef,
    scoreToastHideTimerRef,
    scoreToastClearTimerRef,
    lastPlayedTileTimerRef,
    gameWinConfettiKeyRef,
    gameOverSoundKeyRef,
    prevTurnRef,
  } = refs;

  const [, setToast] = useState('');
  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [scoreToast, setScoreToast] = useState<{
    message: string;
    tone: 'you' | 'bot';
    visible: boolean;
  } | null>(null);
  const [handTileSize, setHandTileSize] = useState(56);
  const [lessonHandRowCount, setLessonHandRowCount] = useState(1);

  const showDebug = hasDebugLocalStorageFlag('BOT_DEBUG');
  const enableDailyFritzProfiling =
    import.meta.env.DEV &&
    isDailyFritzMode &&
    typeof window !== 'undefined' &&
    window.localStorage.getItem('DAILY_FRITZ_PROFILE') === '1';

  if (enableDailyFritzProfiling && typeof window !== 'undefined') {
    const win = window as typeof window & {
      __dailyFritzProfile?: {
        botMatchScreenRenderCount?: number;
      };
    };
    const profile = (win.__dailyFritzProfile ??= {});
    profile.botMatchScreenRenderCount = (profile.botMatchScreenRenderCount ?? 0) + 1;
  }

  const pushToast = useCallback((_msg: string, _ms = 1400) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast('');
  }, [toastTimerRef]);

  const showBoardToast = useCallback((message: string, tone: 'you' | 'bot') => {
    if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
    if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    setScoreToast({
      message,
      tone,
      visible: true,
    });
    scoreToastHideTimerRef.current = setTimeout(() => {
      setScoreToast((prev) => (prev ? { ...prev, visible: false } : prev));
    }, 1700);
    scoreToastClearTimerRef.current = setTimeout(() => setScoreToast(null), 2000);
  }, [scoreToastHideTimerRef, scoreToastClearTimerRef]);

  const showScoreToast = useCallback((player: 'you' | 'bot', points: number) => {
    showBoardToast(`${player === 'you' ? 'You' : opponentLabel} scored +${points}`, player);
  }, [opponentLabel, showBoardToast]);

  const flashLastPlayed = useCallback((tile: Tile | null) => {
    if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, 2400);
    }
  }, [lastPlayedTileTimerRef]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (rootRef.current) {
        await rootRef.current.requestFullscreen();
      }
    } catch {
      // no-op
    }
  };

  const userLegalMoves = useMemo(() => {
    if (match.currentPlayer !== 'you' || match.handOver || match.gameOver) return [];

    try {
      const moves = getLegalMoves(match, 'you');
      if (mode === 'daily-fritz') {
        traceDailyFritzEvent('[state] legalMoves computed', {
          count: moves.length,
          handOver: match.handOver,
          gameOver: match.gameOver,
          currentPlayer: match.currentPlayer,
        });
      }
      return moves;
    } catch (e) {
      logger.error('BotMatchScreen.tsx', e, { message: '[guided-snapshot] getLegalMoves threw' });
      return [];
    }
  }, [mode, match]);

  const userPlayMoves = useMemo(() => asPlayMoves(userLegalMoves), [userLegalMoves]);
  const playableTileKeys = useMemo(() => buildPlayableTileKeys(userPlayMoves), [userPlayMoves]);

  const openEnds = useMemo(() => getDisplayOpenEnds(match), [match.board]);
  const openEndsSum = useMemo(() => (match.board ? computeOpenEndsSum(match.board) : 0), [match.board]);

  useEffect(() => {
    if (!match.board) return;
    assertDisplayedOpenCountMatchesCanonical(match.board, openEndsSum, 'bot-match');
  }, [match.board, openEndsSum]);

  useEffect(() => {
    const prev = prevTurnRef.current;
    const next = match.currentPlayer;
    if (prev === 'bot' && next === 'you' && !match.handOver && !match.gameOver) {
      queueSound(() => playYourTurnSound(isMuted), 400);
    }
    prevTurnRef.current = next;
  }, [match.currentPlayer, match.handOver, match.gameOver, isMuted, prevTurnRef]);

  useEffect(() => {
    if (!match.gameOver || match.winnerId !== 'you') return;
    const key = `${match.handNumber}:${match.players.you.score}:${match.players.bot.score}`;
    if (gameWinConfettiKeyRef.current === key) return;
    gameWinConfettiKeyRef.current = key;
    confetti({
      particleCount: 150,
      spread: 80,
      origin: { y: 0.55 },
      colors: ['#2ecc8e', '#95f0ca', '#d8b56f', '#ffffff'],
    });
  }, [match.gameOver, match.winnerId, match.handNumber, match.players.you.score, match.players.bot.score, gameWinConfettiKeyRef]);

  useEffect(() => {
    if (!match.gameOver || !match.winnerId) {
      gameOverSoundKeyRef.current = '';
      return;
    }
    const key = `${match.handNumber}:${match.winnerId}:${match.players.you.score}:${match.players.bot.score}`;
    if (gameOverSoundKeyRef.current === key) return;
    gameOverSoundKeyRef.current = key;
    if (match.winnerId === 'you') {
      queueSound(() => playMatchWinSound(isMuted), 320);
    } else {
      queueSound(() => playMatchLoseSound(isMuted), 320);
    }
  }, [match.gameOver, match.winnerId, match.handNumber, match.players.you.score, match.players.bot.score, isMuted, gameOverSoundKeyRef]);

  useEffect(() => {
    return () => {
      invalidateLocalRuns();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
      if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
      if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    };
  }, [invalidateLocalRuns, toastTimerRef, scoreToastHideTimerRef, scoreToastClearTimerRef, lastPlayedTileTimerRef]);

  useEffect(() => {
    const updateHandTileSize = () => {
      if (lessonLayoutMode) {
        const tileCount = Math.max(1, match.players.you.hand.length);
        const handDeck = handAreaRef.current?.closest('[data-ui="live-hand-deck"]') as HTMLElement | null;
        const containerWidth = handDeck?.clientWidth
          ? Math.max(handDeck.clientWidth - 36, 220)
          : Math.max(window.innerWidth - 56, 220);
        const maxTileSize = window.innerWidth <= 1440 ? 34 : 38;
        const minTileSize = 24;
        const rowGap = window.innerWidth <= 1440 ? 10 : 12;
        const rackPadding = 28;
        const tileMargin = 8;
        const computeHalfWidth = (tilesPerRow: number) => {
          const usableWidth = Math.max(
            160,
            containerWidth - rackPadding - Math.max(0, (tilesPerRow - 1) * rowGap),
          );
          return Math.floor(usableWidth / (tilesPerRow * 2)) - tileMargin;
        };

        const singleRowHalfWidth = computeHalfWidth(tileCount);
        const shouldStack = tileCount >= 7 || singleRowHalfWidth < 28;
        const rowCount = shouldStack ? 2 : 1;
        const tilesPerRow = rowCount === 1 ? tileCount : Math.ceil(tileCount / 2);
        const resolvedHalfWidth = Math.max(
          minTileSize,
          Math.min(maxTileSize, computeHalfWidth(tilesPerRow)),
        );

        setLessonHandRowCount(rowCount);
        setHandTileSize(resolvedHalfWidth);
        return;
      }

      setLessonHandRowCount(1);

      const tileCount = Math.max(1, match.players.you.hand.length);
      const isLandscape = window.innerWidth > window.innerHeight;
      const isMobileWidth = window.innerWidth <= 900;
      const forceTwoRows = tileCount > 9;
      const maxTileSize = (isLandscape && isMobileWidth ? 42 : (tileCount > 9 ? 46 : 60));
      const handDeck = handAreaRef.current?.closest('[data-ui="live-hand-deck"]') as HTMLElement | null;
      const containerWidth = handDeck?.clientWidth
        ? Math.max(handDeck.clientWidth - 32, 220)
        : window.innerWidth - 40;
      const effectiveLen = forceTwoRows ? Math.ceil(tileCount / 2) : tileCount;
      const gapBudget = 10;
      const usableWidth = containerWidth - Math.max(0, (effectiveLen - 1) * gapBudget);
      const tileWidth = Math.min(maxTileSize, Math.floor(usableWidth / effectiveLen));
      setHandTileSize(tileWidth);
    };

    updateHandTileSize();
    window.addEventListener('resize', updateHandTileSize);
    return () => window.removeEventListener('resize', updateHandTileSize);
  }, [lessonLayoutMode, match.players.you.hand.length, handAreaRef]);

  const handActive = !bootstrap.preGameDrawActive && !match.handOver && !match.gameOver;
  const botTurn = match.currentPlayer === 'bot' && handActive;
  const dailyFritzBoardHasPlay = (match.board?.mainLine?.length ?? 0) > 0;

  return {
    pushToast,
    showBoardToast,
    showScoreToast,
    flashLastPlayed,
    lastPlayedTile,
    scoreToast,
    handTileSize,
    lessonHandRowCount,
    toggleFullscreen,
    userLegalMoves,
    userPlayMoves,
    playableTileKeys,
    openEnds,
    openEndsSum,
    handActive,
    botTurn,
    dailyFritzBoardHasPlay,
    showDebug,
    enableDailyFritzProfiling,
  };
}

export type UseMatchPresentationResult = ReturnType<typeof useMatchPresentation>;