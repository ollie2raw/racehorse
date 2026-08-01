import { useEffect, useMemo, useRef, useState } from 'react';
import type { Tile } from '../../../types.ts';
import type { BotPlayerId, BotMatchState } from '../runtime/botEngine.ts';
import { fairnessLog } from '../runtime/fairnessLog.ts';
import { FRITZ_TIERS } from '../../fritz/fritzConfig.ts';
import type { BotMatchScreenProps } from '../types.ts';
import { botMatchDebugLog } from '../runtime/botMatchDebug.ts';
import {
  loadPersistedDailyFritzMatch,
  resolveDailyFritzStorageKey,
} from '../../daily/index.ts';
import {
  isDailyFritzScriptedDrawReady,
  isPersistedDailyFritzPlayableResume,
} from '../../daily/dailyFritzMatchDiagnostics.ts';
import { isPreGameDrawEligible } from '../../../match/preGameDraw/preGameDrawEligibility.ts';
import { buildMatchCapabilitiesFromBotProps } from '../matchCapabilitiesFromProps.ts';
import { resolveInitialBotMatchState } from '../bootstrap/resolveInitialBotMatchState.ts';
import { useMatchRuntimeBridge } from './useMatchRuntimeBridge.ts';
import type { UseGuidedLessonBootResult } from '../../guided/index.ts';

import { BOT_DRAW_STEP_MS } from '../../bot-turn/botTurnGuards.ts';
import { shouldRunDailyFritzPreGameDraw } from '../../daily/createDailyFritzOfficialMatch.ts';
import { DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION } from '@racehorse/game-core';

/** Shared draw cadence for Fritz and player forced-draw presentation. */
export const DRAW_STEP_MS = BOT_DRAW_STEP_MS;

export function createLocalMatchId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export type UseBotMatchBootstrapArgs = {
  props: BotMatchScreenProps;
  guidedBoot: UseGuidedLessonBootResult;
};

export function useBotMatchBootstrap({ props, guidedBoot }: UseBotMatchBootstrapArgs) {
  const {
    mode = 'bot',
    dealSize,
    fritzTier = 'elite',
    winningScore = 60,
    opponentName = 'Fritz',
    userId = null,
    dailyPuzzleDate = null,
    journeyTrial = null,
    matchInstanceKey = null,
    dailyFritzPackage = null,
    enableGuidedMatchCandidateCapture = false,
  } = props;

  const {
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isLearnAcademyMode,
    guidedTranscript,
    frozenLesson,
    guidedInitSourceRef,
  } = guidedBoot;

  const dailyFritzStorageKey = resolveDailyFritzStorageKey(mode, dailyFritzPackage);
  const initialPersistedDailyFritzMatch = loadPersistedDailyFritzMatch(
    dailyFritzStorageKey,
    dailyFritzPackage?.attempt_id,
    Number(dailyFritzPackage?.current_hand_index ?? 0),
    dailyFritzPackage?.run_date,
    undefined,
    dailyFritzPackage?.run_fingerprint,
  );
  const resumablePersistedDailyFritzMatch =
    initialPersistedDailyFritzMatch?.match &&
    isPersistedDailyFritzPlayableResume(initialPersistedDailyFritzMatch.match)
      ? initialPersistedDailyFritzMatch
      : null;
  const dailyFritzTranscriptProtocolVersion: 1 | 2 =
    resumablePersistedDailyFritzMatch?.transcriptProtocolVersion ?? DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION;
  const dailyFritzScriptedDrawReady = isDailyFritzScriptedDrawReady(dailyFritzPackage);

  const preGameDrawEligibilityInput = {
    mode,
    dealSize,
    isGuidedMode,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isDailyFritzMode: mode === 'daily-fritz',
    hasPersistedDailyFritzMatch: Boolean(resumablePersistedDailyFritzMatch),
  };
  const preGameDrawEligibleBase = isPreGameDrawEligible(preGameDrawEligibilityInput);
  const preGameDrawEligible =
    preGameDrawEligibleBase &&
    (
      mode !== 'daily-fritz'
      || (
        dailyFritzScriptedDrawReady
        && shouldRunDailyFritzPreGameDraw(dailyFritzPackage)
      )
    );

  const [preGameDrawCompleted, setPreGameDrawCompleted] = useState(() =>
    Boolean(resumablePersistedDailyFritzMatch),
  );
  const preGameDrawActive = preGameDrawEligible && !preGameDrawCompleted;
  const preGameDrawActiveRef = useRef(preGameDrawActive);
  preGameDrawActiveRef.current = preGameDrawActive;

  botMatchDebugLog('[mode-debug]', { mode, isGuidedModeProp: props.isGuidedMode, isGuidedMode, isLearnAcademyMode });

  const fritzConfig = FRITZ_TIERS[fritzTier];
  const bootstrapInstanceKey =
    matchInstanceKey
    ?? (mode === 'daily-fritz' && dailyFritzPackage
      ? `daily-fritz:${dailyFritzPackage.run_date}:${dailyFritzPackage.attempt_id}`
      : 'local-bot');

  const matchCapabilities = useMemo(
    () => buildMatchCapabilitiesFromBotProps({
      mode,
      dealSize,
      winningScore,
      isGuidedMode,
      isAuthoringMode,
      isAuthoringV2Mode,
      isGuidedV2Mode,
      isJourneyTrial: Boolean(journeyTrial),
      isDailyPuzzleRun: Boolean(dailyPuzzleDate),
      isStandaloneFritzMatch: Boolean(
        userId
        && !journeyTrial
        && mode !== 'ghost'
        && mode !== 'daily-fritz'
        && !dailyPuzzleDate
        && !isGuidedMode
        && !isAuthoringMode
        && !isAuthoringV2Mode
        && !isGuidedV2Mode,
      ),
      enableGuidedMatchCandidateCapture,
      preGameDrawActive,
    }),
    [
      mode,
      dealSize,
      winningScore,
      isGuidedMode,
      isAuthoringMode,
      isAuthoringV2Mode,
      isGuidedV2Mode,
      journeyTrial,
      dailyPuzzleDate,
      userId,
      enableGuidedMatchCandidateCapture,
      preGameDrawActive,
    ],
  );

  const bootstrapInputRef = useRef({
    mode,
    winningScore,
    dealSize,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isGuidedMode,
    guidedTranscript,
    frozenLesson,
    resumablePersistedDailyFritzMatch,
    preGameDrawEligible,
    dailyFritzPackage,
    guidedInitSourceRef,
  });
  bootstrapInputRef.current = {
    mode,
    winningScore,
    dealSize,
    isAuthoringMode,
    isAuthoringV2Mode,
    isGuidedV2Mode,
    isGuidedMode,
    guidedTranscript,
    frozenLesson,
    resumablePersistedDailyFritzMatch,
    preGameDrawEligible,
    dailyFritzPackage,
    guidedInitSourceRef,
  };

  const { match, setMatch, matchRef, runtime: matchRuntime } = useMatchRuntimeBridge<BotMatchState>({
    createInitialState: () => resolveInitialBotMatchState({
      ...bootstrapInputRef.current,
      resumablePersistedDailyFritzMatch: bootstrapInputRef.current.resumablePersistedDailyFritzMatch?.match
        ? {
            match: bootstrapInputRef.current.resumablePersistedDailyFritzMatch.match,
            movesUsed: bootstrapInputRef.current.resumablePersistedDailyFritzMatch.movesUsed,
            moveLog: bootstrapInputRef.current.resumablePersistedDailyFritzMatch.moveLog,
          }
        : null,
    }),
    capabilities: matchCapabilities,
    instanceKey: bootstrapInstanceKey,
  });

  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [, setSelectedController] = useState<BotPlayerId | null>(null);
  const [movesUsed, setMovesUsed] = useState(
    resumablePersistedDailyFritzMatch?.movesUsed ?? 0,
  );
  const [showRecommendation, setShowRecommendation] = useState(true);

  const isGhostMode = mode === 'ghost';
  const isDailyFritzMode = mode === 'daily-fritz';
  const opponentLabel = isGhostMode ? 'Ghost' : opponentName.trim() || 'Fritz';
  const isDailyPuzzleRun = Boolean(dailyPuzzleDate);
  const isJourneyTrial = Boolean(journeyTrial);
  const isPlayVsFritzGameOver =
    mode === 'bot' &&
    !isGhostMode &&
    !isDailyFritzMode &&
    !isDailyPuzzleRun &&
    !isGuidedMode &&
    !isAuthoringMode &&
    !isAuthoringV2Mode &&
    !isGuidedV2Mode;
  const isStandaloneFritzMatch = Boolean(
    userId && !isJourneyTrial && !isGhostMode && !isDailyPuzzleRun && !isDailyFritzMode
    && !isGuidedMode && !isAuthoringMode && !isAuthoringV2Mode && !isGuidedV2Mode,
  );
  const showPostGameOverlays = match.gameOver;

  useEffect(() => {
    fairnessLog('match-init', {
      mode,
      handNumber: match.handNumber,
      youHand: match.players.you.hand.map((tile) => `${tile.low}-${tile.high}`),
      botHand: match.players.bot.hand.map((tile) => `${tile.low}-${tile.high}`),
      boneyardCount: match.boneyard.length,
      boneyardOrder: match.boneyard.map((tile) => `${tile.low}-${tile.high}`),
    });
  }, []);

  return {
    mode,
    dealSize,
    fritzTier,
    winningScore,
    opponentName,
    userId,
    dailyPuzzleDate,
    journeyTrial,
    dailyFritzPackage,
    matchInstanceKey,
    enableGuidedMatchCandidateCapture,
    dailyFritzStorageKey,
    dailyFritzTranscriptProtocolVersion,
    createLocalMatchId,
    initialPersistedDailyFritzMatch,
    resumablePersistedDailyFritzMatch,
    dailyFritzScriptedDrawReady,
    preGameDrawEligibilityInput,
    preGameDrawEligibleBase,
    preGameDrawEligible,
    preGameDrawCompleted,
    setPreGameDrawCompleted,
    preGameDrawActive,
    preGameDrawActiveRef,
    fritzConfig,
    bootstrapInstanceKey,
    matchCapabilities,
    bootstrapInputRef,
    match,
    setMatch,
    matchRef,
    matchRuntime,
    selectedTile,
    setSelectedTile,
    setSelectedController,
    movesUsed,
    setMovesUsed,
    showRecommendation,
    setShowRecommendation,
    isGhostMode,
    isDailyFritzMode,
    opponentLabel,
    isDailyPuzzleRun,
    isJourneyTrial,
    isPlayVsFritzGameOver,
    isStandaloneFritzMatch,
    showPostGameOverlays,
  };
}

export type UseBotMatchBootstrapResult = ReturnType<typeof useBotMatchBootstrap>;
