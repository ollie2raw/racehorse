import {
  interpretRawSocketEvent,
  resetSocketEventBusForTests,
} from '../multiplayer/socketEventBus';
import { MATCHMAKING_SOCKET_EVENTS, SOCKET_EVENTS } from '../multiplayer/socketEventRegistry';
import { registerMatchmakingSocketHandlers } from './registerMatchmakingSocketHandlers';
import type { MatchmakingSocketDelegates, QueueCountSocketDelegates } from './matchmakingSocketTypes';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

resetSocketEventBusForTests();

const matchmakingCalls: string[] = [];
const queueCountCalls: string[] = [];

const matchmaking: MatchmakingSocketDelegates = {
  onQueueOnline: () => {
    matchmakingCalls.push('queue_online');
  },
  onQueueMatched: () => {
    matchmakingCalls.push('queue_matched');
  },
  onQueueTimeout: () => {
    matchmakingCalls.push('queue_timeout');
  },
  onConnect: () => {
    matchmakingCalls.push('connect');
  },
  onDisconnect: () => {
    matchmakingCalls.push('disconnect');
  },
};

const queueCounts: QueueCountSocketDelegates = {
  onQueueOnline: () => {
    queueCountCalls.push('queue_online');
  },
  onConnect: () => {
    queueCountCalls.push('connect');
  },
};

const unregister = registerMatchmakingSocketHandlers({
  getScope: () => ({ matchmaking, queueCounts }),
});

interpretRawSocketEvent(MATCHMAKING_SOCKET_EVENTS.QUEUE_ONLINE, { online: 4, queued: 2 });
assertTrue(matchmakingCalls.includes('queue_online'), 'matchmaking queue_online delegate');
assertTrue(queueCountCalls.includes('queue_online'), 'queueCounts queue_online fan-out');
assertEqual(queueCountCalls.filter((c) => c === 'queue_online').length, 1, 'single queue_online fan-out to queueCounts');

interpretRawSocketEvent(MATCHMAKING_SOCKET_EVENTS.QUEUE_MATCHED, {
  roomCode: 'ABCD',
  opponent: { userId: 'o1', username: 'opp', rating: 1200, isSim: false },
  yourRating: 1100,
  countdownMs: 5000,
});
assertTrue(matchmakingCalls.includes('queue_matched'), 'matchmaking queue_matched delegate');
assertEqual(queueCountCalls.includes('queue_matched'), false, 'queue_matched not fanned to queueCounts');

interpretRawSocketEvent(MATCHMAKING_SOCKET_EVENTS.QUEUE_TIMEOUT, undefined);
assertTrue(matchmakingCalls.includes('queue_timeout'), 'matchmaking queue_timeout delegate');

interpretRawSocketEvent(SOCKET_EVENTS.CONNECT, undefined);
assertTrue(matchmakingCalls.includes('connect'), 'matchmaking connect delegate');
assertTrue(queueCountCalls.includes('connect'), 'queueCounts connect fan-out');

interpretRawSocketEvent(SOCKET_EVENTS.DISCONNECT, undefined);
assertTrue(matchmakingCalls.includes('disconnect'), 'matchmaking disconnect delegate');
assertEqual(queueCountCalls.includes('disconnect'), false, 'disconnect not fanned to queueCounts');

const callsBeforeDuplicate = matchmakingCalls.length;
const unregisterDuplicate = registerMatchmakingSocketHandlers({
  getScope: () => ({ matchmaking: null, queueCounts: null }),
});
interpretRawSocketEvent(MATCHMAKING_SOCKET_EVENTS.QUEUE_ONLINE, { online: 1, queued: 0 });
assertEqual(
  matchmakingCalls.length,
  callsBeforeDuplicate + 1,
  'primary registrar handler remains active — App must register matchmaking handlers only once',
);
unregisterDuplicate();
interpretRawSocketEvent(MATCHMAKING_SOCKET_EVENTS.QUEUE_ONLINE, { online: 9, queued: 3 });
assertEqual(
  matchmakingCalls.length,
  callsBeforeDuplicate + 2,
  'single bus handler after duplicate registration removed',
);

unregister();
resetSocketEventBusForTests();

console.log('registerMatchmakingSocketHandlers.behaviorTests: all passed');