import { useEffect, useRef } from 'react';
import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotHandReveal } from '../match/types.ts';
import { pruneNonPlayableDailyFritzSnapshot } from './dailyFritzSessionStorage';
import { createDailyFritzChallengeIdentity } from '../../dailyFritz/dailyFritzChallengeIdentity.ts';
import {
  DAILY_FRITZ_SESSION_SCHEMA_VERSION,
  persistDailyFritzSnapshot,
  type DailyFritzPersistedSnapshot,
} from './dailyFritzSessionStorage.ts';
import { buildDailyFritzTranscript } from '../../dailyFritz/dailyFritzTranscript.ts';
import { getFritzPolicyContract, isSupportedFritzPolicyVersion } from '@racehorse/game-core';
import { saveDailyFritzCheckpoint, recordDailyFritzTelemetry } from '../../dailyFritz/api.ts';
import { reportDailyFritzOperationalAlert } from '../../dailyFritz/dailyFritzObservability.ts';
import { dailyFritzTelemetryEventId, getDailyFritzTelemetrySession } from '../../dailyFritz/telemetry.ts';

type UseDailyFritzSessionPersistenceArgs = {
  enabled: boolean;
  storageKey: string | null;
  attemptId: string | null | undefined;
  verifiedMatchId: string | null | undefined;
  runDate: string | null | undefined;
  runFingerprint: string | null | undefined;
  gameNumber: number;
  dailyFritzHandIndex: number;
  authorityRevision: number;
  match: BotMatchState;
  moveLog: readonly MoveEntry[];
  movesUsed: number;
  preGameDrawActive: boolean;
  drawSequenceActive: boolean;
  handResult: BotHandReveal | null;
  initialCheckpointRevision?: number;
  initialStartedAt?: string;
  transcriptProtocolVersion?: 1 | 2;
  fritzPolicyVersion?: number;
};

export function useDailyFritzSessionPersistence({
  enabled,
  storageKey,
  attemptId,
  verifiedMatchId,
  runDate,
  runFingerprint,
  gameNumber,
  dailyFritzHandIndex,
  authorityRevision,
  match,
  moveLog,
  movesUsed,
  preGameDrawActive,
  drawSequenceActive,
  handResult,
  initialCheckpointRevision = 0,
  initialStartedAt,
  transcriptProtocolVersion = 2,
  fritzPolicyVersion,
}: UseDailyFritzSessionPersistenceArgs): void {
  const storageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storagePendingRef = useRef<{ key: string; payload: object } | null>(null);
  const startedAtRef = useRef(initialStartedAt ?? new Date().toISOString());
  const checkpointRevisionRef = useRef(initialCheckpointRevision);
  const firstMoveReportedRef = useRef(false);
  const divergenceReportedRef = useRef('');
  const serverSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastServerSyncRevisionRef = useRef(initialCheckpointRevision);

  const syncCheckpointToServer = (snapshot: DailyFritzPersistedSnapshot, immediate: boolean) => {
    if (!attemptId || !verifiedMatchId) return;
    if (snapshot.checkpointRevision <= lastServerSyncRevisionRef.current) return;
    const runSync = () => {
      void saveDailyFritzCheckpoint({
        attemptId,
        verifiedMatchId,
        checkpoint: snapshot as unknown as Record<string, unknown>,
      }).then((response) => {
        if (response?.ok) {
          lastServerSyncRevisionRef.current = Math.max(
            lastServerSyncRevisionRef.current,
            response.checkpoint_revision,
          );
        }
      });
    };
    if (immediate) {
      if (serverSyncTimerRef.current) {
        clearTimeout(serverSyncTimerRef.current);
        serverSyncTimerRef.current = null;
      }
      runSync();
      return;
    }
    if (serverSyncTimerRef.current) clearTimeout(serverSyncTimerRef.current);
    serverSyncTimerRef.current = setTimeout(() => {
      serverSyncTimerRef.current = null;
      runSync();
    }, 1_500);
  };

  useEffect(() => {
    if (!enabled || !attemptId || !runDate || firstMoveReportedRef.current) return;
    const firstPlayerMove = moveLog.find((entry) => entry.player === 'you');
    if (!firstPlayerMove) return;
    firstMoveReportedRef.current = true;
    const sessionId = getDailyFritzTelemetrySession(runDate);
    void recordDailyFritzTelemetry({
      eventId: dailyFritzTelemetryEventId(attemptId, 'first_move'),
      eventType: 'first_move',
      attemptId,
      runDate,
      challengeId: createDailyFritzChallengeIdentity(runDate).challengeId,
      sessionId,
      durationMs: Math.max(0, Date.now() - new Date(startedAtRef.current).getTime()),
      payload: { gameNumber, handIndex: dailyFritzHandIndex },
    });
  }, [attemptId, dailyFritzHandIndex, enabled, gameNumber, moveLog, runDate]);

  useEffect(() => {
    if (!enabled || !storageKey || !attemptId || !runDate || !runFingerprint || typeof window === 'undefined') return;
    // Draw animation commits intermediate rack/boneyard states so the player
    // can see each tile arrive. Those states are not authoritative resume
    // points until the matching transcript actions and final state commit.
    if (preGameDrawActive || drawSequenceActive) return;
    // The authority cursor and match live in different stores. A hand-boundary
    // render can briefly observe one side before the other; never let that torn
    // view replace the last coherent checkpoint.
    if (match.handNumber !== dailyFritzHandIndex + 1) {
      const divergenceKey = `${gameNumber}:${dailyFritzHandIndex}:${authorityRevision}:${match.handNumber}`;
      if (divergenceReportedRef.current !== divergenceKey) {
        divergenceReportedRef.current = divergenceKey;
        console.error('[daily-fritz-authority] checkpoint cursor divergence', {
          gameNumber,
          handIndex: dailyFritzHandIndex,
          authorityRevision,
          matchHandNumber: match.handNumber,
          lifecyclePhase: match.gameOver ? 'completed' : match.handOver ? 'hand_transition' : 'active_hand',
        });
        reportDailyFritzOperationalAlert(
          'cursor_divergence',
          'Daily Fritz checkpoint cursor divergence',
          {
            attemptId,
            gameNumber,
            handIndex: dailyFritzHandIndex,
            authorityRevision,
            matchHandNumber: match.handNumber,
          },
        );
        const sessionId = getDailyFritzTelemetrySession(runDate);
        void recordDailyFritzTelemetry({
          eventId: dailyFritzTelemetryEventId(attemptId, 'recovery_started', `cursor-divergence:${divergenceKey}`),
          eventType: 'recovery_started',
          attemptId,
          runDate,
          challengeId: createDailyFritzChallengeIdentity(runDate).challengeId,
          sessionId,
          failureCode: 'client_authority_cursor_diverged',
          payload: {
            transitionPhase: 'checkpoint',
            clientCursor: { gameNumber, handIndex: dailyFritzHandIndex, authorityRevision },
            matchHandNumber: match.handNumber,
            recoveryDecision: 'skip_torn_checkpoint',
          },
        });
      }
      return;
    }
    divergenceReportedRef.current = '';
    const now = new Date().toISOString();
    const lifecyclePhase = match.gameOver ? 'completed' : match.handOver ? 'hand_transition' : 'active_hand';
    const buildSnapshot = (): DailyFritzPersistedSnapshot => ({
      schemaVersion: DAILY_FRITZ_SESSION_SCHEMA_VERSION,
      challenge: createDailyFritzChallengeIdentity(runDate),
      classification: 'official',
      attemptId,
      runFingerprint,
      gameNumber,
      currentHandIndex: dailyFritzHandIndex,
      authorityRevision,
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
            journal: match.officialJournal ?? null,
            fritzPolicyVersion,
            attemptPredatesJournalRollout: transcriptProtocolVersion === 1,
          });
        } catch {
          return null;
        }
      })(),
      verificationPhase: match.handOver || match.gameOver ? 'pending' : 'collecting',
      startedAt: startedAtRef.current,
      lastTransitionAt: now,
      checkpointRevision: ++checkpointRevisionRef.current,
      transcriptProtocolVersion,
      fritzPolicyVersion: isSupportedFritzPolicyVersion(fritzPolicyVersion)
        ? fritzPolicyVersion
        : undefined,
      fritzPolicyContract: isSupportedFritzPolicyVersion(fritzPolicyVersion)
        ? getFritzPolicyContract(fritzPolicyVersion)
        : undefined,
    });
    if (match.gameOver || match.handOver) {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
      }
      const finalSnapshot = buildSnapshot();
      storagePendingRef.current = { key: storageKey, payload: finalSnapshot };
      persistDailyFritzSnapshot(storageKey, finalSnapshot);
      syncCheckpointToServer(finalSnapshot, true);
      storagePendingRef.current = null;
      return;
    }
    const snapshot = buildSnapshot();
    storagePendingRef.current = { key: storageKey, payload: snapshot };
    // This is the recovery checkpoint for the official run. Persist every
    // state transition synchronously so a route click immediately after a
    // move cannot discard the latest hand/score state.
    persistDailyFritzSnapshot(storageKey, snapshot);
    syncCheckpointToServer(snapshot, false);
    storagePendingRef.current = null;
    return () => {
      if (storageTimerRef.current) {
        clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
      }
      if (serverSyncTimerRef.current) {
        clearTimeout(serverSyncTimerRef.current);
        serverSyncTimerRef.current = null;
      }
    };
  }, [
    attemptId,
    authorityRevision,
    runDate,
    runFingerprint,
    gameNumber,
    handResult,
    dailyFritzHandIndex,
    enabled,
    match,
    moveLog,
    movesUsed,
    preGameDrawActive,
    drawSequenceActive,
    storageKey,
    transcriptProtocolVersion,
    fritzPolicyVersion,
    verifiedMatchId,
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
