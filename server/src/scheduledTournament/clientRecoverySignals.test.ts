import { describe, expect, it, vi } from 'vitest';
import { bindTournamentRecoverySignals } from '../../../client/src/tournament/recoverySignals';

function makeSocket() {
  const handlers = new Map<string, () => void>();
  return {
    on: (event: 'connect', handler: () => void) => {
      handlers.set(event, handler);
    },
    off: (event: 'connect') => {
      handlers.delete(event);
    },
    emitConnect: () => handlers.get('connect')?.(),
  };
}

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

describe('bindTournamentRecoverySignals', () => {
  it('calls onRecover on socket reconnect and visible tab regain', () => {
    const socket = makeSocket();
    const documentLike = makeDocument() as any;
    const onRecover = vi.fn();

    const cleanup = bindTournamentRecoverySignals({ socket: socket as any, documentLike, onRecover });

    socket.emitConnect();
    documentLike.triggerVisible();

    expect(onRecover).toHaveBeenCalledTimes(2);

    cleanup();
  });
});
