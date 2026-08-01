import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildShareText } from './dailyFritzUiContracts.ts';
import {
  createBotMatchWithStarter,
  createFixedBotMatchWithStarter,
} from '../match/runtime/botEngine.ts';
import {
  dailyFritzDebugLog,
} from './dailyFritzMatchDiagnostics.ts';
import {
  normalizePreGameDrawTile,
  toPreGameDrawTileId,
} from '../../match/preGameDraw/preGameDrawLogic.ts';
import { usePreGameDraw, type PreGameDrawCompletePayload } from '../../match/preGameDraw/usePreGameDraw.ts';
import {
  useDailyFritzCompletion,
  useDailyFritzSessionPersistence,
} from './index.ts';
import type { BotMatchScreenProps } from '../match/types.ts';
import type { UseBotMatchBootstrapResult } from '../match/hooks/useBotMatchBootstrap.ts';
import type { UseGuidedLessonBootResult } from '../guided/index.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
export type UseDailyFritzRuntimeArgs = {
  props: BotMatchScreenProps;
  bootstrap: UseBotMatchBootstrapResult;
  guidedBoot: UseGuidedLessonBootResult;
  moveLog: readonly MoveEntry[];
  ghostResultLoading: boolean;
  ghostResultError: string | null;
  setGhostResultLoading: (loading: boolean) => void;
  setGhostResultError: (error: string | null) => void;
  drawSequenceActive: boolean;
};

export function useDailyFritzRuntime({
  props,
  bootstrap,
  guidedBoot,
  moveLog,
  ghostResultLoading,
  ghostResultError,
  setGhostResultLoading,
  setGhostResultError,
  drawSequenceActive,
}: UseDailyFritzRuntimeArgs) {
  const {
    dailyFritzSetOverlay = null,
    onDailyFritzGameComplete = null,
    userId = null,
  } = props;

  const {
    mode,
    dealSize,
    winningScore,
    dailyFritzPackage,
    dailyFritzStorageKey,
    isDailyFritzMode,
    match,
    setMatch,
    movesUsed,
    preGameDrawActive,
    setPreGameDrawCompleted,
    dailyFritzScriptedDrawReady,
    resumablePersistedDailyFritzMatch,
    opponentLabel,
  } = bootstrap;

  const { isGuidedMode, isAuthoringMode } = guidedBoot;

  const [shareCopied, setShareCopied] = useState(false);
  const dailyFritzShareText = useMemo(
    () => (dailyFritzSetOverlay ? buildShareText(dailyFritzSetOverlay) : ''),
    [dailyFritzSetOverlay],
  );

  const handleShareResult = useCallback(() => {
    if (!dailyFritzShareText) return;
    const markShared = (): void => {
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    };
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      void navigator
        .share({
          title: 'Daily Fritz',
          text: dailyFritzShareText,
        })
        .then(() => {
          markShared();
        })
        .catch(() => {
          /* user dismissed native share */
        });
      return;
    }
    void navigator.clipboard.writeText(dailyFritzShareText).then(() => {
      markShared();
    });
  }, [dailyFritzShareText]);

  useEffect(() => {
    setShareCopied(false);
  }, [dailyFritzShareText]);

  const [dailyFritzHandIndex, setDailyFritzHandIndex] = useState(() => {
    const persisted = resumablePersistedDailyFritzMatch?.currentHandIndex;
    if (typeof persisted === 'number' && Number.isFinite(persisted)) {
      return persisted;
    }
    return dailyFritzPackage?.current_hand_index ?? 0;
  });
  const [persistedHandResult, setPersistedHandResult] = useState(
    resumablePersistedDailyFritzMatch?.handResult ?? null,
  );

  const [dailyLeaderboard, setDailyLeaderboard] = useState<import('../../dailyPuzzle/api.ts').DailyPuzzleLeaderboardEntry[]>([]);
  const [dailyLeaderboardLoading, setDailyLeaderboardLoading] = useState(false);
  const [dailyLeaderboardError, setDailyLeaderboardError] = useState<string | null>(null);
  useDailyFritzSessionPersistence({
    enabled: isDailyFritzMode,
    storageKey: dailyFritzStorageKey,
    attemptId: dailyFritzPackage?.attempt_id,
    runDate: dailyFritzPackage?.run_date,
    runFingerprint: dailyFritzPackage?.run_fingerprint,
    gameNumber: dailyFritzPackage?.current_game_number ?? 1,
    dailyFritzHandIndex,
    match,
    moveLog,
    movesUsed,
    preGameDrawActive,
    drawSequenceActive,
    handResult: persistedHandResult,
    initialRevision: resumablePersistedDailyFritzMatch?.revision,
    initialStartedAt: resumablePersistedDailyFritzMatch?.startedAt,
    transcriptProtocolVersion: resumablePersistedDailyFritzMatch?.transcriptProtocolVersion ?? 2,
  });

  const {
    dailyFritzLeaderboard,
    dailyFritzRank,
    retryDailyFritzCompletion,
    submitSucceededRef: dailyFritzSubmitSucceededRef,
  } = useDailyFritzCompletion({
    enabled: isDailyFritzMode,
    dailyFritzPackage,
    dailyFritzHandIndex,
    match,
    moveLog,
    movesUsed,
    userId,
    isGuidedMode,
    isAuthoringMode,
    onDailyFritzGameComplete,
    setResultLoading: setGhostResultLoading,
    setResultError: setGhostResultError,
    resultLoading: ghostResultLoading,
    resultError: ghostResultError,
  });

  const handlePreGameDrawComplete = useCallback(
    (payload: PreGameDrawCompletePayload) => {
      setPreGameDrawCompleted(true);
      if (mode === 'daily-fritz' && dailyFritzPackage) {
        setMatch(
          createFixedBotMatchWithStarter(
            dailyFritzPackage.first_hand,
            dailyFritzPackage.draw_winner,
            winningScore,
            dealSize,
          ),
        );
        return;
      }
      setMatch(createBotMatchWithStarter(payload.remainingDeck, payload.winner, winningScore, dealSize));
    },
    [dealSize, winningScore, mode, dailyFritzPackage, setPreGameDrawCompleted, setMatch],
  );

  const dailyFritzScriptedDraw = dailyFritzScriptedDrawReady ? dailyFritzPackage : null;
  const scriptedPlayerTile = dailyFritzScriptedDraw
    ? normalizePreGameDrawTile(dailyFritzScriptedDraw.draw_player_tile)
    : null;
  const scriptedFritzTile = dailyFritzScriptedDraw
    ? normalizePreGameDrawTile(dailyFritzScriptedDraw.draw_fritz_tile)
    : null;
  const scriptedPlayerTileId = scriptedPlayerTile ? toPreGameDrawTileId(scriptedPlayerTile) : null;
  const scriptedFritzTileId = scriptedFritzTile ? toPreGameDrawTileId(scriptedFritzTile) : null;

  const preGameDraw = usePreGameDraw({
    enabled: preGameDrawActive,
    opponentLabel,
    scriptedPlayerTileId,
    scriptedFritzTileId,
    scriptedWinner: dailyFritzScriptedDraw ? dailyFritzScriptedDraw.draw_winner : null,
    persistenceKey:
      isDailyFritzMode && dailyFritzPackage?.attempt_id
        ? `df-draw:${dailyFritzPackage.attempt_id}:${dailyFritzPackage.current_game_number ?? 1}`
        : null,
    onComplete: handlePreGameDrawComplete,
  });

  const handleDailyFritzBotMoveApplied = useCallback((info: {
    handNumber: number;
    handOver: boolean;
    gameOver: boolean;
    nextPlayer: import('../match/runtime/botEngine.ts').BotMatchState['currentPlayer'];
    scored: number;
  }) => {
    dailyFritzDebugLog('[daily-flow] bot move applied', info);
  }, []);

  return {
    shareCopied,
    handleShareResult,
    dailyFritzHandIndex,
    setDailyFritzHandIndex,
    persistedHandResult,
    setPersistedHandResult,
    dailyFritzLeaderboard,
    dailyFritzRank,
    retryDailyFritzCompletion,
    dailyFritzSubmitSucceededRef,
    handlePreGameDrawComplete,
    handleDailyFritzBotMoveApplied,
    preGameDraw,
    scriptedPlayerTileId,
    scriptedFritzTileId,
    dailyLeaderboard,
    setDailyLeaderboard,
    dailyLeaderboardLoading,
    setDailyLeaderboardLoading,
    dailyLeaderboardError,
    setDailyLeaderboardError,
  };
}

export type UseDailyFritzRuntimeResult = ReturnType<typeof useDailyFritzRuntime>;
