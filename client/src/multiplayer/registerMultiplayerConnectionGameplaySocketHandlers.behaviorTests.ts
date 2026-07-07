import {
  interpretRawSocketEvent,
  resetSocketEventBusForTests,
} from './socketEventBus';
import { SOCKET_EVENTS } from './socketEventRegistry';
import type { GameplaySocketDelegates } from './gameplaySocketTypes';
import { registerMultiplayerConnectionGameplaySocketHandlers } from './registerMultiplayerConnectionGameplaySocketHandlers';

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

const gameplay: GameplaySocketDelegates = {
  onHandEnded: () => {
    calls.push('hand_ended');
  },
  onGameRematchStatus: () => {
    calls.push('rematch_status');
  },
  onGameRematchStarted: () => {
    calls.push('rematch_started');
  },
  onPlayerDragging: () => {
    calls.push('player_dragging');
  },
};

const unregister = registerMultiplayerConnectionGameplaySocketHandlers({
  getScope: () => ({ gameplay }),
  recoverState: () => undefined,
});

interpretRawSocketEvent(SOCKET_EVENTS.HAND_ENDED, {
  handNumber: 1,
  opponentRemainingTiles: [],
  yourRemainingTiles: [],
  pointsAwarded: { you: 10, opponent: 0 },
});
assertTrue(calls.includes('hand_ended'), 'gameplay onHandEnded delegate');

interpretRawSocketEvent(SOCKET_EVENTS.GAME_REMATCH_STATUS, { readyPlayerIds: [] });
assertTrue(calls.includes('rematch_status'), 'gameplay onGameRematchStatus delegate');

interpretRawSocketEvent(SOCKET_EVENTS.GAME_REMATCH_STARTED, undefined);
assertTrue(calls.includes('rematch_started'), 'gameplay onGameRematchStarted delegate');

interpretRawSocketEvent(SOCKET_EVENTS.PLAYER_DRAGGING, { playerId: 'opp', dragging: true });
assertTrue(calls.includes('player_dragging'), 'gameplay onPlayerDragging delegate');

unregister();
resetSocketEventBusForTests();

console.log('registerMultiplayerConnectionGameplaySocketHandlers.behaviorTests: all passed');