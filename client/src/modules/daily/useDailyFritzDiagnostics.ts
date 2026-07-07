import { useEffect } from 'react';
import type { Tile } from '../../types.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import {
  dailyFritzDebugLog,
  isPersistedDailyFritzPlayableResume,
  logDailyFritzScriptedDrawMount,
} from './dailyFritzMatchDiagnostics.ts';
import {
  initPreGameDraw,
  normalizePreGameDrawTile,
  toPreGameDrawTileId,
} from '../../match/preGameDraw/preGameDrawLogic.ts';
import type { DailyFritzPersistedSnapshot } from './dailyFritzSessionStorage.ts';

export type UseDailyFritzDiagnosticsArgs = {
  isDailyFritzMode: boolean;
  matchInstanceKey: string | null;
  dailyFritzPackage: DailyFritzStartResponse | null | undefined;
  dailyFritzScriptedDrawReady: boolean;
  match: BotMatchState;
  mode: string;
  dealSize: number;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  preGameDrawEligibilityInput: {
    isDailyFritzMode: boolean;
    hasPersistedDailyFritzMatch: boolean;
  };
  initialPersistedDailyFritzMatch: DailyFritzPersistedSnapshot | null;
  preGameDrawEligibleBase: boolean;
  preGameDrawEligible: boolean;
  preGameDrawCompleted: boolean;
  preGameDrawActive: boolean;
  scriptedPlayerTileId: string | null;
  scriptedFritzTileId: string | null;
  lastDailyFlowLabelRef: React.MutableRefObject<string>;
  getDebugSnapshot: () => {
    nextHandPrefetched: boolean;
  };
};

export function useDailyFritzDiagnostics(args: UseDailyFritzDiagnosticsArgs): void {
  const {
    isDailyFritzMode,
    matchInstanceKey,
    dailyFritzPackage,
    dailyFritzScriptedDrawReady,
    match,
    mode,
    dealSize,
    isGuidedMode,
    isAuthoringMode,
    preGameDrawEligibilityInput,
    initialPersistedDailyFritzMatch,
    preGameDrawEligibleBase,
    preGameDrawEligible,
    preGameDrawCompleted,
    preGameDrawActive,
    scriptedPlayerTileId,
    scriptedFritzTileId,
    lastDailyFlowLabelRef,
    getDebugSnapshot,
  } = args;

  useEffect(() => {
    if (!isDailyFritzMode) return;
    console.log('[df-scripted-draw] BotMatchScreen mount', {
      matchInstanceKey,
      attemptId: dailyFritzPackage?.attempt_id ?? null,
    });
    return () => {
      console.log('[df-scripted-draw] BotMatchScreen unmount', {
        matchInstanceKey,
        attemptId: dailyFritzPackage?.attempt_id ?? null,
      });
    };
  // Log mount/unmount only — omit package fields that would fire on every deal update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDailyFritzMode || !dailyFritzPackage) return;

    const deckIds = new Set(initPreGameDraw().tiles.map((slot) => slot.id));
    const rawPlayer = dailyFritzPackage.draw_player_tile ?? null;
    const rawFritz = dailyFritzPackage.draw_fritz_tile ?? null;
    const normalizedPlayer = normalizePreGameDrawTile(rawPlayer);
    const normalizedFritz = normalizePreGameDrawTile(rawFritz);
    const playerTileId = normalizedPlayer ? toPreGameDrawTileId(normalizedPlayer) : null;
    const fritzTileId = normalizedFritz ? toPreGameDrawTileId(normalizedFritz) : null;
    const rawPlayerId =
      rawPlayer && typeof rawPlayer === 'object' && 'low' in rawPlayer && 'high' in rawPlayer
        ? `${(rawPlayer as Tile).low}-${(rawPlayer as Tile).high}`
        : null;
    const rawFritzId =
      rawFritz && typeof rawFritz === 'object' && 'low' in rawFritz && 'high' in rawFritz
        ? `${(rawFritz as Tile).low}-${(rawFritz as Tile).high}`
        : null;

    logDailyFritzScriptedDrawMount({
      matchInstanceKey,
      attemptId: dailyFritzPackage.attempt_id ?? null,
      gameNumber: dailyFritzPackage.current_game_number ?? null,
      handIndex: dailyFritzPackage.current_hand_index ?? null,
      drawWinner: dailyFritzPackage.draw_winner ?? null,
      rawDrawPlayerTile: rawPlayer,
      rawDrawFritzTile: rawFritz,
      rawPlayerTileId: rawPlayerId,
      rawFritzTileId: rawFritzId,
      normalizedDrawPlayerTile: normalizedPlayer,
      normalizedDrawFritzTile: normalizedFritz,
      playerTileId,
      fritzTileId,
      playerTileIdInDeck: playerTileId ? deckIds.has(playerTileId) : false,
      fritzTileIdInDeck: fritzTileId ? deckIds.has(fritzTileId) : false,
      rawPlayerIdMismatch: rawPlayerId != null && playerTileId != null && rawPlayerId !== playerTileId,
      rawFritzIdMismatch: rawFritzId != null && fritzTileId != null && rawFritzId !== fritzTileId,
      mode,
      dealSize,
      isDailyFritzMode: mode === 'daily-fritz',
      isDailyFritzModePassedToGate: preGameDrawEligibilityInput.isDailyFritzMode,
      hasPersistedDailyFritzMatch: preGameDrawEligibilityInput.hasPersistedDailyFritzMatch,
      hasRawPersistedSessionMatch: Boolean(initialPersistedDailyFritzMatch),
      rawPersistedIsPlayableResume: Boolean(
        initialPersistedDailyFritzMatch?.match &&
          isPersistedDailyFritzPlayableResume(initialPersistedDailyFritzMatch.match),
      ),
      isGuidedMode,
      isAuthoringMode,
      preGameDrawEligibleBase,
      scriptedDrawGatePass: mode !== 'daily-fritz' || dailyFritzScriptedDrawReady,
      scriptedDrawReady: dailyFritzScriptedDrawReady,
      preGameDrawEligible,
      preGameDrawCompleted,
      preGameDrawActive,
      scriptedMode:
        scriptedPlayerTileId != null &&
        scriptedFritzTileId != null &&
        (dailyFritzPackage.draw_winner === 'you' || dailyFritzPackage.draw_winner === 'bot'),
    });

    dailyFritzDebugLog('[daily-flow] package boot', {
      attemptId: dailyFritzPackage.attempt_id ?? null,
      gameNumber: dailyFritzPackage.current_game_number ?? null,
      handIndex: dailyFritzPackage.current_hand_index ?? null,
      hasSetResult: Boolean(dailyFritzPackage.set_result),
      drawWinner: dailyFritzPackage.draw_winner ?? null,
      drawPlayerTile: dailyFritzPackage.draw_player_tile ?? null,
      drawFritzTile: dailyFritzPackage.draw_fritz_tile ?? null,
      scriptedDrawReady: dailyFritzScriptedDrawReady,
    });
  }, [
    isDailyFritzMode,
    matchInstanceKey,
    dailyFritzPackage,
    dailyFritzPackage?.attempt_id,
    dailyFritzPackage?.current_game_number,
    dailyFritzPackage?.current_hand_index,
    dailyFritzPackage?.set_result,
    dailyFritzPackage?.draw_winner,
    dailyFritzPackage?.draw_player_tile,
    dailyFritzPackage?.draw_fritz_tile,
    dailyFritzScriptedDrawReady,
    preGameDrawEligible,
    preGameDrawCompleted,
    preGameDrawActive,
    preGameDrawEligibleBase,
    scriptedPlayerTileId,
    scriptedFritzTileId,
    mode,
    dealSize,
    isGuidedMode,
    isAuthoringMode,
    preGameDrawEligibilityInput,
    initialPersistedDailyFritzMatch,
  ]);

  useEffect(() => {
    if (!isDailyFritzMode) return;
    lastDailyFlowLabelRef.current = 'match-init';
    dailyFritzDebugLog('[daily-flow] match init', {
      handNumber: match.handNumber,
      currentPlayer: match.currentPlayer,
      attemptId: dailyFritzPackage?.attempt_id ?? null,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isDailyFritzMode) return;
    lastDailyFlowLabelRef.current = 'hand-init';
    dailyFritzDebugLog('[daily-flow] hand init', {
      handNumber: match.handNumber,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
      currentPlayer: match.currentPlayer,
      prefetchReady: getDebugSnapshot().nextHandPrefetched,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.handNumber, getDebugSnapshot]);

  useEffect(() => {
    if (!isDailyFritzMode) return;
    if (match.handOver || match.gameOver) return;
    if (match.currentPlayer === 'you') {
      lastDailyFlowLabelRef.current = 'player-turn';
      dailyFritzDebugLog('[daily-flow] player turn start', {
        handNumber: match.handNumber,
        yourScore: match.players.you.score,
        botScore: match.players.bot.score,
      });
    } else {
      lastDailyFlowLabelRef.current = 'bot-turn';
      dailyFritzDebugLog('[daily-flow] bot turn start', {
        handNumber: match.handNumber,
        yourScore: match.players.you.score,
        botScore: match.players.bot.score,
      });
    }
  }, [match.currentPlayer, match.handOver, match.gameOver, match.handNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isDailyFritzMode || !match.gameOver) return;
    lastDailyFlowLabelRef.current = 'match-complete';
    dailyFritzDebugLog('[daily-flow] match complete', {
      handNumber: match.handNumber,
      yourScore: match.players.you.score,
      botScore: match.players.bot.score,
      winnerId: match.winnerId,
    });
  }, [match.gameOver]); // eslint-disable-line react-hooks/exhaustive-deps
}