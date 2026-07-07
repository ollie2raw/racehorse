import type { Socket } from 'socket.io-client';
import { traceSocketEvent } from '../debug/socketTrace';
import { recordIngressDedupDrop, recordIngressReplayDrop } from './mpTelemetry';
import type { RoomAckResponse } from './roomTransport';
import type { StateUpdatePayload } from './protocol';

export type SocketEventBase = {
  /** Optional caller stamp for cross-episode replay detection (Phase G). */
  episodeSequence?: number;
};

export type SocketEvent =
  | (SocketEventBase & { type: 'ROOM_JOIN_OK'; payload: RoomAckResponse })
  | (SocketEventBase & { type: 'STATE_UPDATE'; payload: StateUpdatePayload })
  | (SocketEventBase & { type: 'RESYNC_NEEDED'; payload: { roomCode: string } })
  | (SocketEventBase & {
      type: 'TRANSPORT_FAIL';
      payload: { reason: string; roomCode?: string };
    })
  | (SocketEventBase & { type: 'ROOM_JOIN_TERMINAL'; payload: { error: string } });

export type StampedSocketEvent = SocketEvent & { episodeSequence: number };

export type EpisodeStampedPayload<T> = T & {
  episodeSequence: number;
  transportId?: string;
};

export type NormalizedSocketRouter = {
  roomJoinOk?: (payload: RoomAckResponse, meta?: { episodeSequence: number }) => void;
  stateUpdate?: (payload: EpisodeStampedPayload<StateUpdatePayload>) => void;
  resyncNeeded?: (payload: { roomCode: string; episodeSequence?: number }) => void;
  transportFail?: (
    payload: { reason: string; roomCode?: string },
    meta?: { episodeSequence: number },
  ) => void;
  roomJoinTerminal?: (payload: { error: string }, meta?: { episodeSequence: number }) => void;
};

export type RawSocketHandler = (payload: unknown, ...rest: unknown[]) => void;

const LIFECYCLE_SOCKET_EVENTS = [
  'connect',
  'disconnect',
  'connect_error',
  'reconnect_failed',
] as const;

let normalizedRouter: NormalizedSocketRouter = {};
const rawHandlers = new Map<string, Set<RawSocketHandler>>();
const attachedSockets = new WeakMap<Socket, () => void>();

const DEDUP_WINDOW_MS = 250;

type RecentFingerprint = {
  fingerprint: string;
  at: number;
};

const recentEventFingerprints: RecentFingerprint[] = [];
let roomJoinOkHandled = false;
let roomJoinOkDuplicateBurstLogged = false;
let episodeSequenceRef = 0;
let isDispatching = false;
const queuedSocketEvents: SocketEvent[] = [];

export type SocketEpisodeProjectionGate = {
  id: number;
  isClosed: boolean;
};

let episodeProjectionGate: SocketEpisodeProjectionGate = { id: 0, isClosed: false };

export type DispatchInvariantContext = {
  episodeClosed: boolean;
  currentOpenEpisode: number;
};

let onDispatchInvariantCheck:
  | ((event: SocketEvent, context: DispatchInvariantContext) => void)
  | null = null;

const TRANSPORT_REPLAY_MAX_SIZE = 500;
const TRANSPORT_REPLAY_EVICT_COUNT = 100;
const TRANSPORT_REPLAY_BUCKET_MS = 500;
export const PROCESSED_TRANSPORT_ID_MAX_SIZE = 500;
export const PROCESSED_TRANSPORT_ID_EVICT_COUNT = 100;

const rawTransportReplayFingerprints: string[] = [];
const rawTransportReplayFingerprintSet = new Set<string>();
const processedTransportEventIds: string[] = [];
const processedTransportEventIdSet = new Set<string>();
const rawTransportIngressApproved = new WeakSet<object>();

function normalizeFingerprintRoomCode(value: unknown): string {
  if (typeof value !== 'string') return 'no-room';
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : 'no-room';
}

function readTransportEventId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (typeof record.transportId === 'string' && record.transportId.trim()) {
    return record.transportId.trim();
  }
  if (typeof record.eventId === 'string' && record.eventId.trim()) {
    return record.eventId.trim();
  }
  return undefined;
}

function readTransportSequence(payload: unknown): string | number {
  if (!payload || typeof payload !== 'object') return 'no-seq';
  const record = payload as Record<string, unknown>;
  const state = record.state;
  if (state && typeof state === 'object') {
    const sequence = (state as { sequence?: unknown }).sequence;
    if (typeof sequence === 'number' && Number.isFinite(sequence)) {
      return sequence;
    }
  }
  if (typeof record.sequence === 'number' && Number.isFinite(record.sequence)) {
    return record.sequence;
  }
  return 'no-seq';
}

function readTransportRoomCode(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'no-room';
  const record = payload as Record<string, unknown>;
  return normalizeFingerprintRoomCode(record.roomCode);
}

function buildTransportReplaySuffix(
  eventId: string | undefined,
  sequence: string | number,
  now: number,
): string {
  if (eventId) return eventId;
  const bucket = Math.floor(now / TRANSPORT_REPLAY_BUCKET_MS);
  return `${String(sequence)}:${bucket}`;
}

export function buildTransportReplayFingerprint(
  type: SocketEvent['type'],
  payload: unknown,
  now = Date.now(),
): string {
  const roomCode = readTransportRoomCode(payload);
  const sequence = readTransportSequence(payload);
  const eventId = readTransportEventId(payload);
  const suffix = buildTransportReplaySuffix(eventId, sequence, now);
  return `${type}:${roomCode}:${sequence}:${suffix}`;
}

function rememberRawTransportReplayFingerprint(fingerprint: string): boolean {
  if (rawTransportReplayFingerprintSet.has(fingerprint)) {
    return false;
  }

  rawTransportReplayFingerprints.push(fingerprint);
  rawTransportReplayFingerprintSet.add(fingerprint);

  if (rawTransportReplayFingerprints.length > TRANSPORT_REPLAY_MAX_SIZE) {
    const evicted = rawTransportReplayFingerprints.splice(0, TRANSPORT_REPLAY_EVICT_COUNT);
    for (const entry of evicted) {
      rawTransportReplayFingerprintSet.delete(entry);
    }
  }

  return true;
}

function rememberProcessedTransportEventId(transportId: string): void {
  if (processedTransportEventIdSet.has(transportId)) {
    return;
  }
  processedTransportEventIds.push(transportId);
  processedTransportEventIdSet.add(transportId);
  if (processedTransportEventIds.length > PROCESSED_TRANSPORT_ID_MAX_SIZE) {
    const evicted = processedTransportEventIds.splice(0, PROCESSED_TRANSPORT_ID_EVICT_COUNT);
    for (const entry of evicted) {
      processedTransportEventIdSet.delete(entry);
    }
  }
}

export function resetTransportReplayRegistry(): void {
  rawTransportReplayFingerprints.length = 0;
  rawTransportReplayFingerprintSet.clear();
  processedTransportEventIds.length = 0;
  processedTransportEventIdSet.clear();
}

export function getSocketEpisodeProjectionGate(): SocketEpisodeProjectionGate {
  return { ...episodeProjectionGate };
}

/** Hard reset ingress on episode terminal boundary — does not advance episode sequence. */
export function clearAllIngressState(_reason: 'terminal-reset'): void {
  queuedSocketEvents.length = 0;
  recentEventFingerprints.length = 0;
  resetRoomJoinOkConsumption();
  resetTransportReplayRegistry();
  episodeProjectionGate = { id: episodeSequenceRef, isClosed: true };
}

function reopenEpisodeProjectionGate(episodeId: number): void {
  episodeProjectionGate = { id: episodeId, isClosed: false };
}

export function hasProcessedTransportEventId(transportId: string): boolean {
  return processedTransportEventIdSet.has(transportId);
}

export function markProcessedTransportEventId(transportId: string): void {
  rememberProcessedTransportEventId(transportId);
}

export function getProcessedTransportEventIdCountForTests(): number {
  return processedTransportEventIds.length;
}

export function getRawTransportReplayFingerprintCountForTests(): number {
  return rawTransportReplayFingerprints.length;
}

export function getRecentEventFingerprintCountForTests(): number {
  return recentEventFingerprints.length;
}

export function setDispatchInvariantCheckForTests(
  check: ((event: SocketEvent, context: DispatchInvariantContext) => void) | null,
): void {
  onDispatchInvariantCheck = check;
}

function runDispatchInvariantCheck(event: SocketEvent): void {
  if (!import.meta.env?.DEV) return;

  const context: DispatchInvariantContext = {
    episodeClosed: episodeProjectionGate.isClosed,
    currentOpenEpisode: episodeSequenceRef,
  };

  if (onDispatchInvariantCheck) {
    onDispatchInvariantCheck(event, context);
    return;
  }

  if (context.episodeClosed && event.type !== 'ROOM_JOIN_OK') {
    const incoming = event.episodeSequence;
    if (incoming !== undefined && incoming >= context.currentOpenEpisode) {
      console.error(
        '[socketEventBus] invariant violation: post-closure mutable event',
        event.type,
        incoming,
        context.currentOpenEpisode,
      );
    }
  }
}

function buildTransportReplayFingerprintFromSocketEvent(
  event: SocketEvent,
  now = Date.now(),
): string {
  switch (event.type) {
    case 'ROOM_JOIN_OK':
      return buildTransportReplayFingerprint('ROOM_JOIN_OK', event.payload, now);
    case 'STATE_UPDATE':
      return buildTransportReplayFingerprint('STATE_UPDATE', event.payload, now);
    case 'RESYNC_NEEDED':
      return buildTransportReplayFingerprint('RESYNC_NEEDED', event.payload, now);
    case 'TRANSPORT_FAIL':
      return buildTransportReplayFingerprint('TRANSPORT_FAIL', event.payload, now);
    case 'ROOM_JOIN_TERMINAL':
      return buildTransportReplayFingerprint('ROOM_JOIN_TERMINAL', event.payload, now);
    default:
      return `UNKNOWN:no-room:no-seq:${Math.floor(now / TRANSPORT_REPLAY_BUCKET_MS)}`;
  }
}

function claimTransportReplayFingerprint(fingerprint: string): boolean {
  if (rawTransportReplayFingerprintSet.has(fingerprint)) {
    return false;
  }
  return rememberRawTransportReplayFingerprint(fingerprint);
}

function acceptRawSocketTransportIngress(eventName: string, payload: unknown): boolean {
  if (eventName !== 'state:update') {
    return true;
  }
  const fingerprint = buildTransportReplayFingerprint('STATE_UPDATE', payload);
  if (!claimTransportReplayFingerprint(fingerprint)) {
    return false;
  }
  if (payload && typeof payload === 'object') {
    rawTransportIngressApproved.add(payload);
  }
  return true;
}

function acceptNormalizedTransportIngress(event: SocketEvent): {
  accepted: boolean;
  transportId: string;
} {
  const transportId = buildTransportReplayFingerprintFromSocketEvent(event);
  if (event.type === 'STATE_UPDATE') {
    const payload = event.payload;
    if (payload && typeof payload === 'object' && rawTransportIngressApproved.has(payload)) {
      rawTransportIngressApproved.delete(payload);
      return { accepted: true, transportId };
    }
    return {
      accepted: claimTransportReplayFingerprint(transportId),
      transportId,
    };
  }
  return {
    accepted: claimTransportReplayFingerprint(transportId),
    transportId,
  };
}

function buildEventFingerprint(event: SocketEvent): string | null {
  if (event.type === 'STATE_UPDATE') {
    return null;
  }

  switch (event.type) {
    case 'ROOM_JOIN_OK': {
      const roomCode = normalizeFingerprintRoomCode(event.payload.roomCode);
      const sequence =
        typeof event.payload.state?.sequence === 'number' &&
        Number.isFinite(event.payload.state.sequence)
          ? event.payload.state.sequence
          : 'no-seq';
      return `${event.type}:${roomCode}:${sequence}`;
    }
    case 'RESYNC_NEEDED': {
      const roomCode = normalizeFingerprintRoomCode(event.payload.roomCode);
      return `${event.type}:${roomCode}:no-seq`;
    }
    case 'TRANSPORT_FAIL': {
      const roomCode = normalizeFingerprintRoomCode(event.payload.roomCode);
      return `${event.type}:${roomCode}:${event.payload.reason ?? 'no-reason'}`;
    }
    case 'ROOM_JOIN_TERMINAL': {
      return `${event.type}:no-room:${event.payload.error ?? 'no-error'}`;
    }
    default:
      return null;
  }
}

function pruneExpiredFingerprints(now: number): void {
  for (let index = recentEventFingerprints.length - 1; index >= 0; index -= 1) {
    const entry = recentEventFingerprints[index];
    if (entry && now - entry.at >= DEDUP_WINDOW_MS) {
      recentEventFingerprints.splice(index, 1);
    }
  }
}

function isDuplicateFingerprint(fingerprint: string, now: number): boolean {
  pruneExpiredFingerprints(now);
  return recentEventFingerprints.some(
    (entry) => entry.fingerprint === fingerprint && now - entry.at < DEDUP_WINDOW_MS,
  );
}

function rememberFingerprint(fingerprint: string, now: number): void {
  pruneExpiredFingerprints(now);
  recentEventFingerprints.push({ fingerprint, at: now });
}

function resetRoomJoinOkConsumption(): void {
  roomJoinOkHandled = false;
  roomJoinOkDuplicateBurstLogged = false;
}

function logDuplicateRoomJoinOkSuppressed(): void {
  if (!import.meta.env?.DEV) return;
  if (roomJoinOkDuplicateBurstLogged) return;
  roomJoinOkDuplicateBurstLogged = true;
  console.warn('[socketEventBus] duplicate ROOM_JOIN_OK suppressed');
}

export function getSocketEpisodeSequence(): number {
  return episodeSequenceRef;
}

export function setSocketEpisodeSequenceForTests(value: number): void {
  episodeSequenceRef = value;
}

function advanceEpisodeSequenceBoundary(): void {
  episodeSequenceRef += 1;
}

function isStaleCrossEpisodeReplay(event: SocketEvent): boolean {
  const incomingEpisode = event.episodeSequence;
  return (
    incomingEpisode !== undefined && incomingEpisode < episodeSequenceRef
  );
}

function stampNormalizedEvent(event: SocketEvent): StampedSocketEvent {
  return { ...event, episodeSequence: episodeSequenceRef };
}

function shouldConsumeNormalizedEvent(event: SocketEvent): boolean {
  const now = Date.now();

  if (event.type === 'TRANSPORT_FAIL' || event.type === 'ROOM_JOIN_TERMINAL') {
    resetRoomJoinOkConsumption();
  }

  const fingerprint = buildEventFingerprint(event);
  if (fingerprint) {
    if (isDuplicateFingerprint(fingerprint, now)) {
      if (event.type === 'ROOM_JOIN_OK') {
        logDuplicateRoomJoinOkSuppressed();
      }
      recordIngressDedupDrop(event.type, { fingerprint });
      return false;
    }
    rememberFingerprint(fingerprint, now);
  }

  if (event.type === 'ROOM_JOIN_OK') {
    if (roomJoinOkHandled) {
      logDuplicateRoomJoinOkSuppressed();
      recordIngressDedupDrop('ROOM_JOIN_OK', { reason: 'room_join_ok_handled' });
      return false;
    }
    roomJoinOkHandled = true;
  }

  return true;
}

function flushQueuedSocketEvents(): void {
  while (queuedSocketEvents.length > 0) {
    const next = queuedSocketEvents.shift();
    if (next) {
      processDispatchSocketEvent(next);
    }
  }
}

function processDispatchSocketEvent(event: SocketEvent): void {
  runDispatchInvariantCheck(event);

  const transportIngress = acceptNormalizedTransportIngress(event);
  if (!transportIngress.accepted) {
    recordIngressReplayDrop(event.type, { transportId: transportIngress.transportId });
    return;
  }

  if (event.type === 'ROOM_JOIN_OK' && isStaleCrossEpisodeReplay(event)) {
    recordIngressReplayDrop(event.type, { reason: 'stale_cross_episode' });
    return;
  }

  if (!shouldConsumeNormalizedEvent(event)) {
    return;
  }

  const stamped = stampNormalizedEvent(event);
  const transportId = transportIngress.transportId;

  switch (stamped.type) {
    case 'ROOM_JOIN_OK': {
      const handler = normalizedRouter.roomJoinOk;
      if (!handler) {
        logUnhandledNormalized(stamped.type);
        return;
      }
      handler(stamped.payload, { episodeSequence: stamped.episodeSequence });
      advanceEpisodeSequenceBoundary();
      reopenEpisodeProjectionGate(episodeSequenceRef);
      return;
    }
    case 'STATE_UPDATE': {
      const handler = normalizedRouter.stateUpdate;
      if (!handler) {
        logUnhandledNormalized(stamped.type);
        return;
      }
      handler({
        ...stamped.payload,
        episodeSequence: stamped.episodeSequence,
        transportId,
      });
      return;
    }
    case 'RESYNC_NEEDED': {
      const handler = normalizedRouter.resyncNeeded;
      if (!handler) {
        logUnhandledNormalized(stamped.type);
        return;
      }
      handler({
        roomCode: stamped.payload.roomCode,
        episodeSequence: stamped.episodeSequence,
      });
      return;
    }
    case 'TRANSPORT_FAIL': {
      const handler = normalizedRouter.transportFail;
      if (!handler) {
        logUnhandledNormalized(stamped.type);
      } else {
        handler(stamped.payload, { episodeSequence: stamped.episodeSequence });
      }
      advanceEpisodeSequenceBoundary();
      return;
    }
    case 'ROOM_JOIN_TERMINAL': {
      const handler = normalizedRouter.roomJoinTerminal;
      if (!handler) {
        logUnhandledNormalized(stamped.type);
      } else {
        handler(stamped.payload, { episodeSequence: stamped.episodeSequence });
      }
      clearAllIngressState('terminal-reset');
      return;
    }
    default: {
      const _exhaustive: never = stamped;
      logUnhandledNormalized((_exhaustive as StampedSocketEvent).type);
    }
  }
}

/** Route a normalized socket event to exactly one registered handler. */
export function dispatchSocketEvent(event: SocketEvent): void {
  if (isDispatching) {
    queuedSocketEvents.push(event);
    return;
  }

  isDispatching = true;
  try {
    processDispatchSocketEvent(event);
    flushQueuedSocketEvents();
  } finally {
    isDispatching = false;
  }
}

export function getSocketDispatchQueueLengthForTests(): number {
  return queuedSocketEvents.length;
}

export function isSocketDispatchingForTests(): boolean {
  return isDispatching;
}

/** Sole interpreter for inbound raw socket event names (Phase E). */
export function interpretRawSocketEvent(eventName: string, payload: unknown): void {
  if (eventName === 'state:update') {
    dispatchSocketEvent({ type: 'STATE_UPDATE', payload: payload as StateUpdatePayload });
    return;
  }

  const handlers = rawHandlers.get(eventName);
  if (!handlers || handlers.size === 0) {
    logUnhandledRaw(eventName);
    return;
  }

  for (const handler of handlers) {
    handler(payload);
  }
}

export function registerNormalizedSocketRouter(
  next: Partial<NormalizedSocketRouter>,
): () => void {
  const previous = { ...normalizedRouter };
  normalizedRouter = { ...normalizedRouter, ...next };
  return () => {
    normalizedRouter = previous;
  };
}

export function registerRawSocketEventHandler(
  eventName: string,
  handler: RawSocketHandler,
): () => void {
  let set = rawHandlers.get(eventName);
  if (!set) {
    set = new Set();
    rawHandlers.set(eventName, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
    if (set && set.size === 0) {
      rawHandlers.delete(eventName);
    }
  };
}

/** Single socket attachment entrypoint — registers onAny + lifecycle delivery. */
export function attachSocketEventBus(socket: Socket): () => void {
  const existingDetach = attachedSockets.get(socket);
  if (existingDetach) {
    existingDetach();
  }

  const deliver = (eventName: string, payload: unknown) => {
    traceSocketEvent(eventName, payload);
    if (!acceptRawSocketTransportIngress(eventName, payload)) {
      return;
    }
    interpretRawSocketEvent(eventName, payload);
  };

  const onAnyListener = (event: string, ...args: unknown[]) => {
    deliver(event, args.length <= 1 ? args[0] : args);
  };

  socket.onAny(onAnyListener);

  const lifecycleDisposers = LIFECYCLE_SOCKET_EVENTS.map((eventName) => {
    const listener = (payload: unknown) => {
      deliver(eventName, payload);
    };
    socket.on(eventName, listener);
    return () => {
      socket.off(eventName, listener);
    };
  });

  const detach = () => {
    socket.offAny(onAnyListener);
    for (const dispose of lifecycleDisposers) {
      dispose();
    }
    attachedSockets.delete(socket);
  };

  attachedSockets.set(socket, detach);
  return detach;
}

export function resetSocketEventBusForTests(): void {
  normalizedRouter = {};
  rawHandlers.clear();
  recentEventFingerprints.length = 0;
  resetRoomJoinOkConsumption();
  episodeSequenceRef = 0;
  resetTransportReplayRegistry();
  isDispatching = false;
  queuedSocketEvents.length = 0;
  episodeProjectionGate = { id: 0, isClosed: false };
  onDispatchInvariantCheck = null;
}

export function getNormalizedSocketRouterForTests(): NormalizedSocketRouter {
  return { ...normalizedRouter };
}

function logUnhandledNormalized(type: SocketEvent['type']): void {
  if (import.meta.env?.DEV) {
    console.warn('[socketEventBus] unhandled normalized event', type);
  }
}

function logUnhandledRaw(eventName: string): void {
  if (import.meta.env?.DEV) {
    console.warn('[socketEventBus] unhandled raw event', eventName);
  }
}