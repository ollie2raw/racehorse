import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import type { Tile } from '../../../types.ts';
import { buildPlayableTileKeys } from '../../../utils/handTileLegality.ts';
import { logger } from '../../../utils/logger.ts';
import {
  assertDisplayedOpenCountMatchesCanonical,
  computePlayScore,
  computeOpenEndsSum,
  getDisplayOpenEnds,
  getLegalMoves,
} from '../runtime/botEngine.ts';
import { asPlayMoves } from '../../../game/tileUtils.ts';
import {
  playMatchLoseSound,
  playMatchWinSound,
  playScoreSound,
  playYourTurnSound,
  queueSound,
} from '../../../utils/sound.ts';
import {
  hasDebugLocalStorageFlag,
} from '../runtime/botMatchDebug.ts';
import { traceDailyFritzEvent } from '../../daily/dailyFritzMatchDiagnostics.ts';
import {
  BOT_LAST_PLAYED_HOLD_MS,
  BOT_SCORE_CUE_DELAY_MS,
  BOT_SCORE_HOLD_MS,
  BOT_SCORE_TOAST_CLEAR_MS,
  BOT_SCORE_TOAST_HIDE_MS,
} from '../../bot-turn/botTurnGuards.ts';
import {
  clearScoreToastEvent,
  hideScoreToastEvent,
  resolveCommittedScoreEvent,
  type MatchScoreSnapshot,
} from '../presentation/scoreToastEvents.ts';
import type { UseBotMatchBootstrapResult } from './useBotMatchBootstrap.ts';
import type { UseBotMatchRefsResult } from './useBotMatchRefs.ts';
import type { UseGuidedLessonBootResult } from '../../guided/index.ts';

export type BoardToastOptions = {
  sticky?: boolean;
  holdMs?: number;
  points?: number;
  turnTotal?: number;
  actorLabel?: string;
};

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
    dailyFritzPackage,
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

  const [lastPlayedTile, setLastPlayedTile] = useState<Tile | null>(null);
  const [scoreToast, setScoreToast] = useState<{
    eventId: number;
    kind: 'score' | 'notice';
    message: string;
    tone: 'you' | 'bot';
    visible: boolean;
    actorLabel?: string;
    points?: number;
    turnTotal?: number;
  } | null>(null);
  const scoreToastEventIdRef = useRef(0);
  const scoreCueTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const scoreIdentity = `${mode}:${dailyFritzPackage?.attempt_id ?? 'no-attempt'}`;
  const scoreBaselineRef = useRef<{
    identity: string;
    scores: MatchScoreSnapshot;
  }>({
    identity: scoreIdentity,
    scores: {
      you: match.players.you.score,
      bot: match.players.bot.score,
    },
  });
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

  const showBoardToast = useCallback((
    message: string,
    tone: 'you' | 'bot',
    options?: BoardToastOptions,
  ) => {
    const eventId = scoreToastEventIdRef.current + 1;
    scoreToastEventIdRef.current = eventId;
    if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
    if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    setScoreToast({
      eventId,
      kind: typeof options?.points === 'number' ? 'score' : 'notice',
      message,
      tone,
      visible: true,
      actorLabel: options?.actorLabel,
      points: options?.points,
      turnTotal: options?.turnTotal,
    });

    // Always time-dismiss. "Sticky" only lengthens the hold for chain ceremony —
    // never leave a toast without an expiry (bot-tenure cancel can skip clearBoardToast).
    const holdMs = options?.sticky
      ? (options?.holdMs ?? Math.max(BOT_SCORE_HOLD_MS * 2, 2100))
      : (options?.holdMs ?? BOT_SCORE_TOAST_HIDE_MS);
    const clearMs = Math.max(holdMs + 300, BOT_SCORE_TOAST_CLEAR_MS);
    scoreToastHideTimerRef.current = window.setTimeout(() => {
      setScoreToast((prev) => hideScoreToastEvent(prev, eventId));
    }, holdMs);
    scoreToastClearTimerRef.current = window.setTimeout(() => {
      setScoreToast((prev) => clearScoreToastEvent(prev, eventId));
    }, clearMs);
  }, [scoreToastHideTimerRef, scoreToastClearTimerRef]);

  const pushToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    showBoardToast(message, 'bot');
  }, [showBoardToast, toastTimerRef]);

  const clearBoardToast = useCallback(() => {
    scoreToastEventIdRef.current += 1;
    if (scoreToastHideTimerRef.current) clearTimeout(scoreToastHideTimerRef.current);
    if (scoreToastClearTimerRef.current) clearTimeout(scoreToastClearTimerRef.current);
    scoreToastHideTimerRef.current = null;
    scoreToastClearTimerRef.current = null;
    setScoreToast(null);
  }, [scoreToastHideTimerRef, scoreToastClearTimerRef]);

  const showScoreToast = useCallback((player: 'you' | 'bot', points: number) => {
    showBoardToast(
      `${player === 'you' ? 'You' : opponentLabel} scored +${points}`,
      player,
      {
        holdMs: BOT_SCORE_HOLD_MS,
        points,
        turnTotal: points,
        actorLabel: player === 'you' ? 'YOU' : opponentLabel.toUpperCase().slice(0, 10),
      },
    );
  }, [opponentLabel, showBoardToast]);

  useEffect(() => {
    const currentScores = {
      you: match.players.you.score,
      bot: match.players.bot.score,
    };
    const baseline = scoreBaselineRef.current;

    if (baseline.identity !== scoreIdentity) {
      baseline.identity = scoreIdentity;
      baseline.scores = currentScores;
      if (scoreCueTimerRef.current) {
        clearTimeout(scoreCueTimerRef.current);
        scoreCueTimerRef.current = null;
      }
      return;
    }

    const playedTilePoints = match.handOver
      && match.lastHandReason === 'domino'
      && match.board
      ? computePlayScore(match.board)
      : 0;
    const scoreEvent = resolveCommittedScoreEvent(baseline.scores, currentScores, {
      handOver: match.handOver,
      playedTilePoints,
    });
    baseline.scores = currentScores;
    if (!isDailyFritzMode || !scoreEvent) return;

    if (scoreCueTimerRef.current) clearTimeout(scoreCueTimerRef.current);
    scoreCueTimerRef.current = window.setTimeout(() => {
      scoreCueTimerRef.current = null;
      showScoreToast(scoreEvent.player, scoreEvent.points);
      queueSound(() => playScoreSound(scoreEvent.points, isMuted), 0);
    }, BOT_SCORE_CUE_DELAY_MS);
  }, [
    isDailyFritzMode,
    isMuted,
    match.players.bot.score,
    match.players.you.score,
    match.board,
    match.handOver,
    match.lastHandReason,
    scoreIdentity,
    showScoreToast,
  ]);

  const flashLastPlayed = useCallback((tile: Tile | null) => {
    if (lastPlayedTileTimerRef.current) clearTimeout(lastPlayedTileTimerRef.current);
    setLastPlayedTile(tile);
    if (tile) {
      lastPlayedTileTimerRef.current = setTimeout(() => {
        setLastPlayedTile(null);
        lastPlayedTileTimerRef.current = null;
      }, BOT_LAST_PLAYED_HOLD_MS);
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
      if (scoreCueTimerRef.current) clearTimeout(scoreCueTimerRef.current);
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
    clearBoardToast,
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
