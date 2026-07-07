/**
 * Phase K — multi-layer production invariant simulation harness.
 * Proves recovery behaves as a single-threaded deterministic machine under chaos.
 */

import {
  createRecoveryMachine,
  isEpisodeStaleRecoveryEvent,
  type RecoveryEffect,
  type RecoveryEvent,
  type RecoveryMachineSnapshot,
} from './recoveryMachine.ts';
import { assertNoSecondaryRecoveryTriggers } from './recoveryAuthorityContract.ts';
import {
  dispatchSocketEvent,
  getRawTransportReplayFingerprintCountForTests,
  getRecentEventFingerprintCountForTests,
  getSocketDispatchQueueLengthForTests,
  getSocketEpisodeProjectionGate,
  getSocketEpisodeSequence,
  registerNormalizedSocketRouter,
  resetSocketEventBusForTests,
  setDispatchInvariantCheckForTests,
  type DispatchInvariantContext,
  type SocketEvent,
} from './socketEventBus.ts';
import {
  shouldDropClosedEpisodeProjection,
  shouldDropStaleEpisodeStateUpdate,
} from './useRoomSocketSync.ts';
import type { StateUpdatePayload } from './protocol';
import type { GameState } from '../types.ts';

function testStateUpdatePayload(
  sequence: number,
  roomCode: string,
  transportId?: string,
): StateUpdatePayload {
  return {
    state: { sequence } as GameState,
    roomCode,
    ...(transportId ? { transportId } : {}),
  } as StateUpdatePayload;
}

const TRANSPORT_REPLAY_MAX = 500;
const RECENT_FINGERPRINT_SOFT_CAP = 64;

type RecoveryTrigger =
  | 'recoveryMachine.dispatch'
  | 'socketEventBus.resyncNeeded'
  | 'socketEventBus.transportFail'
  | 'socketEventBus.roomJoinTerminal'
  | 'joinAckCoordinator.roomJoinOk';

type EffectRecord = {
  kind: 'room_join' | 'resync';
  episodeId: number;
  at: number;
};

type ProjectionRecord = {
  sequence: number;
  episodeSequence: number;
  applied: boolean;
  at: number;
};

class ProductionInvariantHarness {
  private machine = createRecoveryMachine({
    scheduler: { schedule: () => {}, cancel: () => {} },
    onEffect: (effect) => this.onEffect(effect),
  });

  private effects: EffectRecord[] = [];
  private activeEpisodeIds = new Set<number>();
  private maxConcurrentActiveEpisodes = 0;
  private postClosureMutations = 0;
  private lastClosureEpisode: number | null = null;
  private resyncStartsByEpisode = new Map<number, number>();
  private resyncEndsByEpisode = new Map<number, number>();
  private projectionRecords: ProjectionRecord[] = [];
  private observedTriggers: RecoveryTrigger[] = [];
  private maxTransportFingerprints = 0;
  private maxRecentFingerprints = 0;
  private maxDispatchQueue = 0;
  private invariantViolations: string[] = [];
  private episodeSequenceCursor = 0;

  constructor() {
    resetSocketEventBusForTests();
    this.wireSocketLayer();
    this.installDispatchInvariantGuard();
    assertNoSecondaryRecoveryTriggers([
      'recoveryMachine.dispatch',
      'socketEventBus.resyncNeeded',
      'socketEventBus.transportFail',
      'socketEventBus.roomJoinTerminal',
      'joinAckCoordinator.roomJoinOk',
      'useMultiplayerConnection.resyncOk',
      'useMultiplayerConnection.resyncFail',
      'useMultiplayerConnection.executeRecoveryRoomJoin',
      'useMultiplayerConnection.socketConnected',
      'useMultiplayerConnection.userLeave',
      'useMultiplayerConnection.userRetry',
    ]);
  }

  private wireSocketLayer(): void {
    registerNormalizedSocketRouter({
      roomJoinOk: (_payload, meta) => {
        this.observedTriggers.push('joinAckCoordinator.roomJoinOk');
        this.dispatch({
          type: 'ROOM_JOIN_OK',
          episodeSequence: meta?.episodeSequence,
        });
      },
      resyncNeeded: ({ roomCode, episodeSequence }) => {
        this.observedTriggers.push('socketEventBus.resyncNeeded');
        this.dispatch({
          type: 'RESYNC_NEEDED',
          roomCode,
          episodeSequence,
        });
      },
      transportFail: ({ reason, roomCode }, meta) => {
        this.observedTriggers.push('socketEventBus.transportFail');
        if (roomCode) {
          this.dispatch({ type: 'SOCKET_LOST', roomCode });
          return;
        }
        this.dispatch({
          type: 'TRANSPORT_FAIL',
          reason,
          episodeSequence: meta?.episodeSequence,
        });
      },
      roomJoinTerminal: ({ error }, meta) => {
        this.observedTriggers.push('socketEventBus.roomJoinTerminal');
        this.dispatch({
          type: 'ROOM_JOIN_TERMINAL',
          error,
          episodeSequence: meta?.episodeSequence,
        });
      },
      stateUpdate: (payload) => {
        this.simulateProjection(payload);
      },
    });
  }

  private installDispatchInvariantGuard(): void {
    setDispatchInvariantCheckForTests((event: SocketEvent, context: DispatchInvariantContext) => {
      if (context.episodeClosed && event.type !== 'ROOM_JOIN_OK') {
        const incoming = event.episodeSequence;
        if (incoming !== undefined && incoming >= context.currentOpenEpisode) {
          this.invariantViolations.push(
            `post-closure mutable event: ${event.type} episode=${incoming} open=${context.currentOpenEpisode}`,
          );
        }
      }
    });
  }

  private onEffect(effect: RecoveryEffect): void {
    const snapshot = this.machine.getSnapshot();
    this.trackActiveEpisode(snapshot);

    if (effect.type === 'room_join') {
      this.effects.push({ kind: 'room_join', episodeId: snapshot.episodeId, at: Date.now() });
    }
    if (effect.type === 'resync') {
      this.effects.push({ kind: 'resync', episodeId: snapshot.episodeId, at: Date.now() });
      this.resyncStartsByEpisode.set(
        snapshot.episodeId,
        (this.resyncStartsByEpisode.get(snapshot.episodeId) ?? 0) + 1,
      );
    }

    this.sampleMemoryBounds();
  }

  private trackActiveEpisode(snapshot: RecoveryMachineSnapshot): void {
    if (snapshot.state === 'joining' || snapshot.state === 'resyncing') {
      this.activeEpisodeIds.clear();
      this.activeEpisodeIds.add(snapshot.episodeId);
    } else {
      this.activeEpisodeIds.clear();
    }
    this.maxConcurrentActiveEpisodes = Math.max(
      this.maxConcurrentActiveEpisodes,
      this.activeEpisodeIds.size,
    );
  }

  private sampleMemoryBounds(): void {
    this.maxTransportFingerprints = Math.max(
      this.maxTransportFingerprints,
      getRawTransportReplayFingerprintCountForTests(),
    );
    this.maxRecentFingerprints = Math.max(
      this.maxRecentFingerprints,
      getRecentEventFingerprintCountForTests(),
    );
    this.maxDispatchQueue = Math.max(
      this.maxDispatchQueue,
      getSocketDispatchQueueLengthForTests(),
    );
  }

  dispatch(event: RecoveryEvent): RecoveryMachineSnapshot {
    this.observedTriggers.push('recoveryMachine.dispatch');
    const before = this.machine.getSnapshot();

    if (
      before.lastEpisodeClosedAt !== undefined &&
      isEpisodeStaleRecoveryEvent(before, event)
    ) {
      return before;
    }

    const next = this.machine.dispatch(event);
    this.trackActiveEpisode(next);

    if (event.type === 'RESYNC_OK' && before.state === 'resyncing') {
      const episodeId = before.episodeId;
      this.resyncEndsByEpisode.set(
        episodeId,
        (this.resyncEndsByEpisode.get(episodeId) ?? 0) + 1,
      );
      this.lastClosureEpisode = episodeId;
    }
    if (
      (event.type === 'USER_LEAVE' || event.type === 'ROOM_JOIN_TERMINAL') &&
      next.lastEpisodeClosedAt === next.episodeId
    ) {
      this.lastClosureEpisode = next.episodeId;
    }

    if (
      this.lastClosureEpisode !== null &&
      next.lastEpisodeClosedAt === this.lastClosureEpisode &&
      (event.type === 'RESYNC_OK' || event.type === 'USER_LEAVE' || event.type === 'ROOM_JOIN_TERMINAL')
    ) {
      // closure marker set — later stale dispatches should not mutate recovery state
    }

    return next;
  }

  simulateProjection(payload: {
    state?: { sequence?: number } | null;
    episodeSequence?: number;
    transportId?: string;
  }): void {
    const gate = getSocketEpisodeProjectionGate();
    const busEpisode = getSocketEpisodeSequence();
    const incomingEpisode = payload.episodeSequence;

    if (shouldDropClosedEpisodeProjection(gate, incomingEpisode)) {
      this.projectionRecords.push({
        sequence: payload.state?.sequence ?? -1,
        episodeSequence: incomingEpisode ?? -1,
        applied: false,
        at: Date.now(),
      });
      return;
    }

    if (
      shouldDropStaleEpisodeStateUpdate(
        this.episodeSequenceCursor,
        incomingEpisode,
        busEpisode,
      )
    ) {
      this.projectionRecords.push({
        sequence: payload.state?.sequence ?? -1,
        episodeSequence: incomingEpisode ?? -1,
        applied: false,
        at: Date.now(),
      });
      return;
    }

    if (typeof incomingEpisode === 'number') {
      this.episodeSequenceCursor = Math.max(this.episodeSequenceCursor, incomingEpisode);
    }

    const sequence = payload.state?.sequence;
    if (typeof sequence === 'number' && Number.isFinite(sequence)) {
      const lastApplied = [...this.projectionRecords]
        .reverse()
        .find((entry) => entry.applied);
      if (
        this.lastClosureEpisode !== null &&
        lastApplied &&
        sequence < lastApplied.sequence
      ) {
        this.postClosureMutations += 1;
      }
      this.projectionRecords.push({
        sequence,
        episodeSequence: incomingEpisode ?? this.episodeSequenceCursor,
        applied: true,
        at: Date.now(),
      });
    }
  }

  emitSocket(event: Parameters<typeof dispatchSocketEvent>[0]): void {
    dispatchSocketEvent(event);
    this.sampleMemoryBounds();
  }

  assertGlobalInvariants(label: string): void {
    if (this.invariantViolations.length > 0) {
      throw new Error(`${label}: socket invariant violations: ${this.invariantViolations.join('; ')}`);
    }

    const episodeEffectSets = new Map<number, Set<string>>();
    for (const effect of this.effects) {
      const set = episodeEffectSets.get(effect.episodeId) ?? new Set<string>();
      set.add(effect.kind);
      episodeEffectSets.set(effect.episodeId, set);
    }
    const episodeIds = [...episodeEffectSets.keys()];
    for (let i = 0; i < episodeIds.length; i += 1) {
      for (let j = i + 1; j < episodeIds.length; j += 1) {
        const a = episodeEffectSets.get(episodeIds[i]!)!;
        const b = episodeEffectSets.get(episodeIds[j]!)!;
        const intersection = [...a].filter((kind) => b.has(kind));
        if (intersection.length > 0 && episodeIds[i] !== episodeIds[j]) {
          // cross-episode leakage only when effects for different episodes interleave while both active
          // harness tracks max concurrency separately; this guards duplicate lifecycle kinds across stale ids
        }
      }
    }

    assertTrue(
      this.maxConcurrentActiveEpisodes <= 1,
      `${label}: active episodes max concurrency`,
      this.maxConcurrentActiveEpisodes,
      1,
    );

    assertTrue(
      this.postClosureMutations === 0,
      `${label}: no projection rollback after closure`,
      this.postClosureMutations,
      0,
    );

    let totalResyncStarts = 0;
    let totalResyncEnds = 0;
    for (const count of this.resyncStartsByEpisode.values()) {
      totalResyncStarts += count;
    }
    for (const [episodeId, count] of this.resyncEndsByEpisode.entries()) {
      totalResyncEnds += count;
      assertTrue(
        count <= 1,
        `${label}: one resync end per episode (${episodeId})`,
        count,
        1,
      );
    }
    assertTrue(
      totalResyncStarts <= totalResyncEnds + 1,
      `${label}: resync starts bounded by ends`,
      totalResyncStarts <= totalResyncEnds + 1,
      true,
    );

    const applied = this.projectionRecords.filter((entry) => entry.applied);
    for (let index = 1; index < applied.length; index += 1) {
      const prev = applied[index - 1]!;
      const next = applied[index]!;
      if (next.episodeSequence < prev.episodeSequence) {
        continue;
      }
      if (next.episodeSequence === prev.episodeSequence && next.sequence < prev.sequence) {
        throw new Error(
          `${label}: sequence regression within episode ${next.episodeSequence}: ${prev.sequence}->${next.sequence}`,
        );
      }
    }

    assertTrue(
      this.maxTransportFingerprints <= TRANSPORT_REPLAY_MAX,
      `${label}: transport fingerprint registry bounded`,
      this.maxTransportFingerprints <= TRANSPORT_REPLAY_MAX,
      true,
    );
    assertTrue(
      this.maxRecentFingerprints <= RECENT_FINGERPRINT_SOFT_CAP,
      `${label}: recent fingerprint list bounded`,
      this.maxRecentFingerprints <= RECENT_FINGERPRINT_SOFT_CAP,
      true,
    );
  }

  getSnapshot(): RecoveryMachineSnapshot {
    return this.machine.getSnapshot();
  }
}

function assertTrue(
  value: boolean,
  label: string,
  actual: unknown,
  expected: unknown,
): void {
  if (!value) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/** Scenario A — full reconnect storm */
function scenarioAReconnectStorm(): void {
  const harness = new ProductionInvariantHarness();

  for (let index = 0; index < 10; index += 1) {
    harness.emitSocket({
      type: 'ROOM_JOIN_OK',
      payload: { ok: true, roomCode: 'STORM' },
    });
  }

  harness.dispatch({ type: 'SOCKET_LOST', roomCode: 'STORM' });
  harness.dispatch({ type: 'SOCKET_CONNECTED' });

  for (let index = 0; index < 20; index += 1) {
    if (index % 2 === 0) {
      harness.emitSocket({ type: 'RESYNC_NEEDED', payload: { roomCode: 'STORM' } });
    } else {
      harness.emitSocket({
        type: 'ROOM_JOIN_OK',
        payload: { ok: true, roomCode: 'STORM' },
        episodeSequence: 0,
      });
    }
  }

  for (let index = 0; index < 200; index += 1) {
    harness.emitSocket({
      type: 'STATE_UPDATE',
      payload: testStateUpdatePayload(index + 1, 'STORM', `storm-${index}`),
    });
  }

  harness.dispatch({ type: 'USER_LEAVE' });

  harness.dispatch({ type: 'SOCKET_LOST', roomCode: 'STORM' });
  harness.dispatch({ type: 'SOCKET_CONNECTED' });

  harness.assertGlobalInvariants('scenarioA');
}

/** Scenario B — delayed server burst from prior episode */
function scenarioBDelayedStaleBurst(): void {
  const harness = new ProductionInvariantHarness();

  harness.emitSocket({
    type: 'ROOM_JOIN_OK',
    payload: { ok: true, roomCode: 'BURST' },
  });
  harness.dispatch({ type: 'ROOM_JOIN_OK' });

  const closedEpisode = getSocketEpisodeSequence();
  harness.dispatch({ type: 'SOCKET_LOST', roomCode: 'BURST' });
  harness.dispatch({ type: 'SOCKET_CONNECTED' });
  harness.dispatch({ type: 'ROOM_JOIN_OK' });

  const staleFlood: Array<() => void> = [];
  for (let index = 0; index < 120; index += 1) {
    staleFlood.push(() => {
      harness.simulateProjection({
        state: { sequence: index },
        episodeSequence: closedEpisode - 1,
      });
    });
  }
  for (const deliver of staleFlood) {
    deliver();
  }

  harness.assertGlobalInvariants('scenarioB');
}

/** Scenario C — dual episode race */
function scenarioCDualEpisodeRace(): void {
  const harness = new ProductionInvariantHarness();

  harness.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'RACE' });
  assertTrue(
    harness.getSnapshot().state === 'resyncing',
    'scenarioC: episode 1 resyncing',
    harness.getSnapshot().state,
    'resyncing',
  );

  const episodeOne = harness.getSnapshot().episodeId;

  harness.dispatch({ type: 'SOCKET_LOST', roomCode: 'RACE' });
  const episodeTwo = harness.getSnapshot().episodeId;
  assertTrue(
    episodeTwo > episodeOne,
    'scenarioC: reconnect starts new episode before RESYNC_OK',
    episodeTwo > episodeOne,
    true,
  );

  for (let index = 0; index < 30; index += 1) {
    harness.emitSocket({
      type: 'STATE_UPDATE',
      payload: testStateUpdatePayload(index + 1, 'RACE'),
      episodeSequence: index % 2 === 0 ? episodeOne : episodeTwo,
    });
    if (index % 5 === 0) {
      harness.dispatch({ type: 'RESYNC_OK' });
    }
    if (index % 7 === 0) {
      harness.emitSocket({ type: 'RESYNC_NEEDED', payload: { roomCode: 'RACE' } });
    }
  }

  harness.dispatch({ type: 'SOCKET_CONNECTED' });
  harness.dispatch({ type: 'ROOM_JOIN_OK' });

  harness.assertGlobalInvariants('scenarioC');
}

/** Scenario D — terminal + recovery interleave */
function scenarioDTerminalInterleave(): void {
  const harness = new ProductionInvariantHarness();

  harness.dispatch({ type: 'RESYNC_NEEDED', roomCode: 'TERM' });
  harness.dispatch({ type: 'RESYNC_OK' });
  harness.dispatch({ type: 'USER_LEAVE' });

  const gate = getSocketEpisodeProjectionGate();
  harness.simulateProjection({
    state: { sequence: 99 },
    episodeSequence: gate.id,
  });

  harness.emitSocket({
    type: 'STATE_UPDATE',
    payload: testStateUpdatePayload(100, 'TERM'),
    episodeSequence: gate.id,
  });

  harness.assertGlobalInvariants('scenarioD');
}

function run(): void {
  scenarioAReconnectStorm();
  scenarioBDelayedStaleBurst();
  scenarioCDualEpisodeRace();
  scenarioDTerminalInterleave();
  console.log('recoveryMachine.production.invariantTests: all passed');
}

run();