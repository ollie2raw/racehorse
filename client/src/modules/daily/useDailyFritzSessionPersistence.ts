import { useEffect, useRef } from 'react';
import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { pruneNonPlayableDailyFritzSnapshot } from './dailyFritzSessionStorage';

type UseDailyFritzSessionPersistenceArgs = {
  enabled: boolean;
  storageKey: string | null;
  attemptId: string | null | undefined;
  dailyFritzHandIndex: number;
  match: BotMatchState;
  moveLog: readonly MoveEntry[];
  movesUsed: number;
  preGameDrawActive: boolean;
};

export function useDailyFritzSessionPersistence({
  enabled,
  storageKey,
  attemptId,
  dailyFritzHandIndex,
  match,
  moveLog,
  movesUsed,
  preGameDrawActive,
}: UseDailyFritzSessionPersistenceArgs): void {
  const storageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storagePendingRef = useRef<{ key: string; payload: object } | null>(null);

  useEffect(() => {
    if (!enabled || !storageKey || typeof window === 'undefined') return;
    if (preGameDrawActive) return;
    if (match.gameOver) {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
      }
      const finalSnapshot = {
        attemptId: attemptId ?? null,
        currentHandIndex: dailyFritzHandIndex,
        match,
        movesUsed,
        moveLog,
      };
      storagePendingRef.current = { key: storageKey, payload: finalSnapshot };
      window.sessionStorage.setItem(storageKey, JSON.stringify(finalSnapshot));
      return;
    }
    if (storageTimerRef.current) clearTimeout(storageTimerRef.current);
    const snapshot = {
      attemptId: attemptId ?? null,
      currentHandIndex: dailyFritzHandIndex,
      match,
      movesUsed,
      moveLog,
    };
    storagePendingRef.current = { key: storageKey, payload: snapshot };
    storageTimerRef.current = setTimeout(() => {
      window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
      storagePendingRef.current = null;
      storageTimerRef.current = null;
    }, 1000);
    return () => {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
      }
    };
  }, [
    attemptId,
    dailyFritzHandIndex,
    enabled,
    match,
    moveLog,
    movesUsed,
    preGameDrawActive,
    storageKey,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      const pending = storagePendingRef.current;
      if (!pending) return;
      try {
        window.sessionStorage.setItem(pending.key, JSON.stringify(pending.payload));
      } catch {
        // sessionStorage may be unavailable during unload
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !preGameDrawActive || !storageKey) return;
    pruneNonPlayableDailyFritzSnapshot(storageKey);
  }, [enabled, preGameDrawActive, storageKey]);
}