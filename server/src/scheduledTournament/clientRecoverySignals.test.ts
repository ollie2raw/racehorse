import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  interpretRawSocketEvent,
  resetSocketEventBusForTests,
} from '../../../client/src/multiplayer/socketEventBus';
import { SOCKET_EVENTS } from '../../../client/src/multiplayer/socketEventRegistry';
import { bindTournamentRecoverySignals } from '../../../client/src/tournament/recoverySignals';
import { registerTournamentSocketHandlers } from '../../../client/src/tournament/registerTournamentSocketHandlers';
import type { TournamentHubSocketDelegates } from '../../../client/src/tournament/tournamentSocketTypes';

function makeDocument() {
  const handlers = new Map<string, () => void>();
  const documentLike = {
    visibilityState: 'hidden' as 'hidden' | 'visible',
    addEventListener: (event: 'visibilitychange', handler: () => void) => {
      handlers.set(event, handler);
    },
    removeEventListener: (event: 'visibilitychange') => {
      handlers.delete(event);
    },
    triggerVisible: () => {
      documentLike.visibilityState = 'visible';
      handlers.get('visibilitychange')?.();
    },
  };
  return documentLike;
}

function makeHub(onRecover: () => void): TournamentHubSocketDelegates {
  const noop = () => undefined;
  return {
    onRegistrationOpen: noop,
    onRegistrationUpdated: noop,
    onBracketGenerated: noop,
    onMatchUpdated: noop,
    onMatchReady: noop,
    onMatchCompleted: noop,
    onTournamentCompleted: noop,
    onRecover,
  };
}

describe('tournament client recovery signals', () => {
  beforeEach(() => {
    resetSocketEventBusForTests();
  });

  it('calls onRecover on socket reconnect and visible tab regain', () => {
    const documentLike = makeDocument() as any;
    const onRecover = vi.fn();

    const cleanupVisibility = bindTournamentRecoverySignals({
      documentLike,
      onRecover,
    });

    const cleanupSocket = registerTournamentSocketHandlers({
      getScope: () => ({
        hub: makeHub(onRecover),
        session: null,
      }),
    });

    interpretRawSocketEvent(SOCKET_EVENTS.CONNECT, undefined);
    documentLike.triggerVisible();

    expect(onRecover).toHaveBeenCalledTimes(2);

    cleanupSocket();
    cleanupVisibility();
  });
});