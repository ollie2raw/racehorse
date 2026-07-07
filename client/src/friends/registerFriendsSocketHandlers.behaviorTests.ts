import {
  interpretRawSocketEvent,
  resetSocketEventBusForTests,
} from '../multiplayer/socketEventBus';
import { SOCKET_EVENTS } from '../multiplayer/socketEventRegistry';
import { registerFriendsSocketHandlers } from './registerFriendsSocketHandlers';
import type { FriendsPresenceSocketDelegates } from './friendsSocketTypes';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  assertEqual(value, true, label);
}

resetSocketEventBusForTests();

const calls: string[] = [];

const presence: FriendsPresenceSocketDelegates = {
  onConnect: () => {
    calls.push('connect');
  },
};

const unregister = registerFriendsSocketHandlers({
  getScope: () => ({ presence }),
});

interpretRawSocketEvent(SOCKET_EVENTS.CONNECT, undefined);
assertTrue(calls.includes('connect'), 'friends presence onConnect delegate');

calls.length = 0;
const unregisterDuplicate = registerFriendsSocketHandlers({
  getScope: () => ({ presence: null }),
});
interpretRawSocketEvent(SOCKET_EVENTS.CONNECT, undefined);
assertEqual(calls.length, 1, 'primary friends handler active — App must register once');
unregisterDuplicate();

interpretRawSocketEvent(SOCKET_EVENTS.CONNECT, undefined);
assertEqual(calls.length, 2, 'single friends connect handler after duplicate removed');

unregister();
resetSocketEventBusForTests();

console.log('registerFriendsSocketHandlers.behaviorTests: all passed');