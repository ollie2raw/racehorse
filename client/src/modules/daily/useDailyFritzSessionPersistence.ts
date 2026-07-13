import { useEffect, useRef } from 'react';
import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotHandReveal } from '../match/types.ts';
import { pruneNonPlayableDailyFritzSnapshot } from './dailyFritzSessionStorage';
import { createDailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import { persistDailyFritzSnapshot, type DailyFritzPersistedSnapshot } from './dailyFritzSessionStorage.ts';
import { buildDailyFritzTranscript } from '../../dailyFritz/dailyFritzTranscript.ts';

type UseDailyFritzSessionPersistenceArgs = {
  enabled: boolean;
  storageKey: string | null;
  attemptId: string | null | undefined;
  runDate: string | null | undefined;
  gameNumber: number;
  dailyFritzHandIndex: number;
  match: BotMatchState;
  moveLog: readonly MoveEntry[];
  movesUsed: number;
  preGameDrawActive: boolean;
  handResult: BotHandReveal | null;
  initialRevision?: number;
  initialStartedAt?: string;
};

export function useDailyFritzSessionPersistence({
  enabled,
  storageKey,
  attemptId,
  runDate,
  gameNumber,
  dailyFritzHandIndex,
  match,
  moveLog,
  movesUsed,
  preGameDrawActive,
  handResult,
  initialRevision = 0,
  initialStartedAt,
}: UseDailyFritzSessionPersistenceArgs): void {
  const storageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storagePendingRef = useRef<{ key: string; payload: object } | null>(null);
  const startedAtRef = useRef(initialStartedAt ?? new Date().toISOString());
  const revisionRef = useRef(initialRevision);

  useEffect(() => {
    if (!enabled || !storageKey || !attemptId || !runDate || typeof window === 'undefined') return;
    if (preGameDrawActive) return;
    const now = new Date().toISOString();
    const lifecyclePhase = match.gameOver ? 'completed' : match.handOver ? 'hand_transition' : 'active_hand';
    const buildSnapshot = (): DailyFritzPersistedSnapshot => ({
      schemaVersion: 4,
      challenge: createDailyFritzChallengeIdentity(runDate),
      classification: 'official',
      attemptId,
      gameNumber,
      currentHandIndex: dailyFritzHandIndex,
      lifecyclePhase,
      match,
      handResult,
      movesUsed,
      moveLog: [...moveLog],
      transcript: (() => {
        try {
          return buildDailyFritzTranscript({
            challengeId: createDailyFritzChallengeIdentity(runDate).challengeId,
            attemptId,
            gameNumber: gameNumber as 1 | 2 | 3,
            handIndex: dailyFritzHandIndex,
            handNumber: match.handNumber,
            moveLog,
          });
        } catch {
          return null;
        }
      })(),
      verificationPhase: match.handOver || match.gameOver ? 'pending' : 'collecting',
      startedAt: startedAtRef.current,
      lastTransitionAt: now,
      revision: ++revisionRef.current,
    });
    if (match.gameOver || match.handOver) {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
      }
      const finalSnapshot = buildSnapshot();
      storagePendingRef.current = { key: storageKey, payload: finalSnapshot };
      persistDailyFritzSnapshot(storageKey, finalSnapshot);
      return;
    }
    if (storageTimerRef.current) clearTimeout(storageTimerRef.current);
    const snapshot = buildSnapshot();
    storagePendingRef.current = { key: storageKey, payload: snapshot };
    storageTimerRef.current = setTimeout(() => {
      persistDailyFritzSnapshot(storageKey, snapshot);
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
    runDate,
    gameNumber,
    handResult,
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
        persistDailyFritzSnapshot(pending.key, pending.payload as DailyFritzPersistedSnapshot);
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
