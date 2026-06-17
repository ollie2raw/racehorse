import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearPreGameDrawSnapshot,
  readPreGameDrawSnapshot,
  writePreGameDrawSnapshot,
} from './preGameDrawPersistence.ts';
import type { Tile } from '../../types.ts';
import {
  applyOpponentPick,
  applyPlayerPick,
  applyScriptedPlayerPick,
  initPreGameDraw,
  pickRandomOpponentTileId,
  type PreGameDrawPlayer,
  type PreGameDrawRoundPick,
  type PreGameDrawState,
  type Rng,
} from './preGameDrawLogic.ts';

export const PRE_GAME_DRAW_OPPONENT_PICK_DELAY_MS = 1000;
/** Both flipped tiles stay face-up with result pill visible before deal. */
export const PRE_GAME_DRAW_REVEAL_PAUSE_MS = 1500;
export const PRE_GAME_DRAW_RESULT_DISPLAY_MS = 1000;

export type UsePreGameDrawUiPhase =
  | 'idle'
  | 'pick-player'
  | 'pick-opponent'
  | 'showing-reveal'
  | 'showing-result'
  | 'done';

export interface PreGameDrawCompletePayload {
  winner: PreGameDrawPlayer;
  remainingDeck: Tile[];
  youPick: PreGameDrawRoundPick;
  botPick: PreGameDrawRoundPick;
}

export interface UsePreGameDrawOptions {
  /** When false, the hook stays idle and does not consume a draw deck. */
  enabled: boolean;
  opponentLabel?: string;
  opponentPickDelayMs?: number;
  revealPauseMs?: number;
  resultDisplayMs?: number;
  rng?: Rng;
  /**
   * Scripted mode (Daily Fritz):
   * - Player taps ANY tile, but the scripted player tile is revealed instead.
   * - Fritz reveals the scripted fritz tile after `opponentPickDelayMs`.
   * - Winner is taken from `scriptedWinner` (no pip-comparison tie/bias).
   *
   * Tile IDs must match the draw deck used by this hook (i.e. same shuffle RNG).
   */
  scriptedPlayerTileId?: string | null;
  scriptedFritzTileId?: string | null;
  scriptedWinner?: PreGameDrawPlayer | null;
  /** Survives React StrictMode remounts / parent re-renders for the same draw session. */
  persistenceKey?: string | null;
  onComplete: (payload: PreGameDrawCompletePayload) => void;
}

function resolveScriptedOutcome({
  stateAfterPlayerPick,
  scriptedFritzTileId,
  scriptedWinner,
}: {
  stateAfterPlayerPick: PreGameDrawState;
  scriptedFritzTileId: string;
  scriptedWinner: PreGameDrawPlayer;
}): PreGameDrawState {
  const youPick = stateAfterPlayerPick.currentRound.you;
  if (!youPick) {
    throw new Error('Scripted draw requires a player pick before resolving');
  }

  const botSlot = stateAfterPlayerPick.tiles.find((slot) => slot.id === scriptedFritzTileId);
  if (!botSlot || botSlot.outOfPlay || botSlot.revealed) {
    throw new Error('Scripted draw fritz tile id is not pickable');
  }

  // Reveal the scripted Fritz tile.
  const tilesRevealed = stateAfterPlayerPick.tiles.map((slot) =>
    slot.id === scriptedFritzTileId ? { ...slot, revealed: true } : slot,
  );

  const remainingDeck = tilesRevealed
    .filter((slot) => !slot.outOfPlay && !slot.revealed)
    .map((slot) => ({ low: slot.tile.low, high: slot.tile.high }));

  const botPick: PreGameDrawRoundPick = {
    player: 'bot',
    tileId: scriptedFritzTileId,
    tile: { low: botSlot.tile.low, high: botSlot.tile.high },
    pipSum: botSlot.tile.low + botSlot.tile.high,
  };

  return {
    ...stateAfterPlayerPick,
    phase: 'resolved',
    // Keep both flipped tiles on the board for reveal/result UI; deal pool excludes them.
    tiles: tilesRevealed,
    winner: scriptedWinner,
    remainingDeck,
    currentRound: { you: youPick, bot: botPick },
  };
}

export interface UsePreGameDrawResult {
  /** True while the draw sequence is in progress (not idle or done). */
  active: boolean;
  uiPhase: UsePreGameDrawUiPhase;
  drawState: PreGameDrawState | null;
  resultMessage: string | null;
  isPlayerPickEnabled: boolean;
  isOpponentThinking: boolean;
  handlePlayerTileTap: (tileId: string) => void;
  /** Re-run the draw from a fresh shuffled deck (e.g. rematch). */
  reset: () => void;
}

export function buildPreGameDrawResultMessage(
  winner: PreGameDrawPlayer,
  opponentLabel: string,
): string {
  return winner === 'you' ? 'You go first' : `${opponentLabel} goes first`;
}

function createFreshDrawState(rng?: Rng): PreGameDrawState {
  return initPreGameDraw(undefined, rng);
}

function readRestorableDrawSnapshot(persistenceKey: string | null | undefined) {
  if (!persistenceKey) return null;
  const saved = readPreGameDrawSnapshot(persistenceKey);
  if (!saved || saved.uiPhase === 'idle' || saved.uiPhase === 'done') return null;
  return saved;
}

/** True only on false→true — avoids re-shuffling when enabled stays true. */
export function shouldInitPreGameDrawOnEnable(wasEnabled: boolean, enabled: boolean): boolean {
  return enabled && !wasEnabled;
}

export function isPreGameDrawTapAllowed(
  uiPhase: UsePreGameDrawUiPhase,
  initPending: boolean,
  drawState: PreGameDrawState | null,
): boolean {
  return uiPhase === 'pick-player' && !initPending && drawState != null;
}

export function usePreGameDraw({
  enabled,
  opponentLabel = 'Fritz',
  opponentPickDelayMs = PRE_GAME_DRAW_OPPONENT_PICK_DELAY_MS,
  revealPauseMs = PRE_GAME_DRAW_REVEAL_PAUSE_MS,
  resultDisplayMs = PRE_GAME_DRAW_RESULT_DISPLAY_MS,
  rng,
  scriptedPlayerTileId,
  scriptedFritzTileId,
  scriptedWinner,
  persistenceKey,
  onComplete,
}: UsePreGameDrawOptions): UsePreGameDrawResult {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const rngRef = useRef(rng);
  rngRef.current = rng;

  const scriptedMode = scriptedPlayerTileId != null && scriptedFritzTileId != null && scriptedWinner != null;

  const opponentPickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealPauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasEnabledRef = useRef(enabled);
  const restoredSnapshot = enabled ? readRestorableDrawSnapshot(persistenceKey) : null;
  const didRestoreSnapshotRef = useRef(Boolean(restoredSnapshot));
  const persistenceKeyRef = useRef(persistenceKey);
  persistenceKeyRef.current = persistenceKey;

  const [uiPhase, setUiPhase] = useState<UsePreGameDrawUiPhase>(() =>
    restoredSnapshot?.uiPhase ?? (enabled ? 'pick-player' : 'idle'),
  );
  const [drawState, setDrawState] = useState<PreGameDrawState | null>(() =>
    restoredSnapshot?.drawState ?? (enabled ? createFreshDrawState(rng) : null),
  );
  const [resultMessage, setResultMessage] = useState<string | null>(
    () => restoredSnapshot?.resultMessage ?? null,
  );
  const [initPending, setInitPending] = useState(false);

  const clearOpponentPickTimer = useCallback(() => {
    if (opponentPickTimerRef.current) {
      clearTimeout(opponentPickTimerRef.current);
      opponentPickTimerRef.current = null;
    }
  }, []);

  const clearRevealPauseTimer = useCallback(() => {
    if (revealPauseTimerRef.current) {
      clearTimeout(revealPauseTimerRef.current);
      revealPauseTimerRef.current = null;
    }
  }, []);

  const clearResultTimer = useCallback(() => {
    if (resultTimerRef.current) {
      clearTimeout(resultTimerRef.current);
      resultTimerRef.current = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearOpponentPickTimer();
    clearRevealPauseTimer();
    clearResultTimer();
  }, [clearOpponentPickTimer, clearRevealPauseTimer, clearResultTimer]);

  const reset = useCallback(() => {
    clearAllTimers();
    didRestoreSnapshotRef.current = false;
    if (persistenceKeyRef.current) {
      clearPreGameDrawSnapshot(persistenceKeyRef.current);
    }
    setResultMessage(null);
    if (!enabled) {
      wasEnabledRef.current = false;
      setInitPending(false);
      setUiPhase('idle');
      setDrawState(null);
      return;
    }
    setInitPending(true);
    setDrawState(createFreshDrawState(rngRef.current));
    setUiPhase('pick-player');
  }, [clearAllTimers, enabled]);

  useEffect(() => {
    if (!enabled) {
      wasEnabledRef.current = false;
      setInitPending(false);
      clearOpponentPickTimer();
      clearRevealPauseTimer();
      clearResultTimer();
      setUiPhase('idle');
      setDrawState(null);
      setResultMessage(null);
      return;
    }

    if (!shouldInitPreGameDrawOnEnable(wasEnabledRef.current, enabled)) {
      return;
    }

    wasEnabledRef.current = true;
    setInitPending(true);
    setResultMessage(null);
    const restored = readRestorableDrawSnapshot(persistenceKey);
    if (restored) {
      didRestoreSnapshotRef.current = true;
      setDrawState(restored.drawState);
      setUiPhase(restored.uiPhase);
      setResultMessage(restored.resultMessage);
      return;
    }
    setDrawState(createFreshDrawState(rngRef.current));
    setUiPhase('pick-player');
  }, [enabled, persistenceKey, clearOpponentPickTimer, clearRevealPauseTimer, clearResultTimer]);

  useEffect(() => {
    if (!initPending) return;
    if (uiPhase === 'pick-player' && drawState !== null) {
      setInitPending(false);
    }
  }, [initPending, uiPhase, drawState]);

  useEffect(() => () => clearAllTimers(), [clearAllTimers]);

  const scheduleOpponentPick = useCallback(
    (stateAfterPlayerPick: PreGameDrawState) => {
      clearOpponentPickTimer();
      opponentPickTimerRef.current = setTimeout(() => {
        opponentPickTimerRef.current = null;

        let afterOpponent: PreGameDrawState;
        try {
          if (scriptedMode && scriptedFritzTileId != null && scriptedWinner != null) {
            afterOpponent = resolveScriptedOutcome({
              stateAfterPlayerPick,
              scriptedFritzTileId,
              scriptedWinner,
            });
          } else {
            const tileId = pickRandomOpponentTileId(stateAfterPlayerPick, rngRef.current);
            afterOpponent = applyOpponentPick(stateAfterPlayerPick, tileId);
          }
        } catch (err) {
          console.error('[df-scripted-draw] opponent resolve failed', {
            scriptedFritzTileId,
            scriptedWinner,
            error: err instanceof Error ? err.message : String(err),
            pickableTileIds: stateAfterPlayerPick.tiles
              .filter((slot) => !slot.outOfPlay && !slot.revealed)
              .map((slot) => slot.id),
          });
          // In scripted mode a mismatch between scripted ids and the underlying shuffled
          // deck should not permanently wedge the UI — just fall back to waiting for a retry.
          setUiPhase('pick-player');
          return;
        }

        setDrawState(afterOpponent);

        if (afterOpponent.phase === 'pick-player') {
          setUiPhase('pick-player');
          return;
        }

        if (
          afterOpponent.phase !== 'resolved' ||
          afterOpponent.winner == null ||
          afterOpponent.remainingDeck == null ||
          afterOpponent.currentRound.you == null ||
          afterOpponent.currentRound.bot == null
        ) {
          return;
        }

        const message = buildPreGameDrawResultMessage(afterOpponent.winner!, opponentLabel);
        setResultMessage(message);
        setUiPhase('showing-reveal');
        clearRevealPauseTimer();
        revealPauseTimerRef.current = setTimeout(() => {
          revealPauseTimerRef.current = null;
          setUiPhase('showing-result');

          clearResultTimer();
          resultTimerRef.current = setTimeout(() => {
            resultTimerRef.current = null;
            setUiPhase('done');
            if (persistenceKeyRef.current) {
              clearPreGameDrawSnapshot(persistenceKeyRef.current);
            }
            onCompleteRef.current({
              winner: afterOpponent.winner!,
              remainingDeck: afterOpponent.remainingDeck!,
              youPick: afterOpponent.currentRound.you!,
              botPick: afterOpponent.currentRound.bot!,
            });
          }, resultDisplayMs);
        }, revealPauseMs);
      }, opponentPickDelayMs);
    },
    [
      clearOpponentPickTimer,
      clearRevealPauseTimer,
      clearResultTimer,
      opponentLabel,
      opponentPickDelayMs,
      revealPauseMs,
      resultDisplayMs,
      scriptedMode,
      scriptedFritzTileId,
      scriptedWinner,
    ],
  );

  const handlePlayerTileTap = useCallback(
    (tileId: string) => {
      if (!isPreGameDrawTapAllowed(uiPhase, initPending, drawState) || !drawState) return;

      const effectiveTileId = scriptedMode && scriptedPlayerTileId != null ? scriptedPlayerTileId : tileId;
      let afterPlayer: PreGameDrawState;
      try {
        afterPlayer =
          scriptedMode && scriptedPlayerTileId != null
            ? applyScriptedPlayerPick(
                drawState,
                tileId,
                scriptedPlayerTileId,
                scriptedFritzTileId,
              )
            : applyPlayerPick(drawState, effectiveTileId);
      } catch (err) {
        console.error('[df-scripted-draw] player pick failed', {
          tappedTileId: tileId,
          effectiveTileId,
          scriptedMode,
          scriptedPlayerTileId,
          error: err instanceof Error ? err.message : String(err),
          deckTileIds: drawState.tiles.map((slot) => slot.id),
        });
        return;
      }

      setDrawState(afterPlayer);
      setUiPhase('pick-opponent');
      scheduleOpponentPick(afterPlayer);
    },
    [drawState, initPending, scheduleOpponentPick, uiPhase, scriptedMode, scriptedPlayerTileId, scriptedFritzTileId],
  );

  useEffect(() => {
    if (!enabled || !persistenceKey || !drawState) return;
    writePreGameDrawSnapshot(persistenceKey, { drawState, uiPhase, resultMessage });
  }, [drawState, enabled, persistenceKey, resultMessage, uiPhase]);

  useEffect(() => {
    if (!enabled || uiPhase !== 'pick-opponent' || !drawState || opponentPickTimerRef.current) return;
    if (!didRestoreSnapshotRef.current) return;
    didRestoreSnapshotRef.current = false;
    scheduleOpponentPick(drawState);
  }, [drawState, enabled, scheduleOpponentPick, uiPhase]);

  const active = enabled && uiPhase !== 'idle' && uiPhase !== 'done';
  const isPlayerPickEnabled = isPreGameDrawTapAllowed(uiPhase, initPending, drawState);
  const isOpponentThinking = uiPhase === 'pick-opponent';

  return {
    active,
    uiPhase,
    drawState,
    resultMessage,
    isPlayerPickEnabled,
    isOpponentThinking,
    handlePlayerTileTap,
    reset,
  };
}
