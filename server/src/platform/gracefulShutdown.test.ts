import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isGracefulShutdownInProgress,
  resetGracefulShutdownStateForTests,
  runGracefulShutdown,
} from './gracefulShutdown';

type MockHttpServer = {
  close: ReturnType<typeof vi.fn>;
};

type MockSocketServer = EventEmitter & {
  emit: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function createMockHttpServer(): MockHttpServer {
  return {
    close: vi.fn((callback?: (error?: Error) => void) => {
      callback?.();
    }),
  };
}

function createMockSocketServer(): MockSocketServer {
  const emitter = new EventEmitter() as MockSocketServer;
  emitter.emit = vi.fn(() => true);
  emitter.close = vi.fn((callback?: () => void) => {
    callback?.();
  });
  return emitter;
}

describe('gracefulShutdown', () => {
  beforeEach(() => {
    resetGracefulShutdownStateForTests();
  });

  it('SIGTERM path flushes live sessions before closing sockets and exiting', async () => {
    const server = createMockHttpServer();
    const io = createMockSocketServer();
    const callOrder: string[] = [];
    const exitProcess = vi.fn();

    const flushLiveSessions = vi.fn(async () => {
      callOrder.push('flush');
      return {
        flushedRoomCodes: ['ROOM01'],
        awaitedInFlightRoomCodes: [],
        timedOut: false,
      };
    });

    server.close.mockImplementation((callback?: (error?: Error) => void) => {
      callOrder.push('http_close');
      callback?.();
    });
    io.close.mockImplementation((callback?: () => void) => {
      callOrder.push('socket_close');
      callback?.();
    });

    await runGracefulShutdown('SIGTERM', {
      server: server as unknown as import('node:http').Server,
      io: io as unknown as import('socket.io').Server,
      flushLiveSessions,
      exitProcess,
      shutdownFlushTimeoutMs: 1_000,
    });

    expect(isGracefulShutdownInProgress()).toBe(true);
    expect(io.emit).toHaveBeenCalledWith('server:shutdown', {
      reason: 'server_restart',
      signal: 'SIGTERM',
    });
    expect(callOrder).toEqual(['http_close', 'flush', 'socket_close']);
    expect(flushLiveSessions).toHaveBeenCalledWith({ timeoutMs: 1_000 });
    expect(exitProcess).toHaveBeenCalledWith(0);
  });

  it('creates dirty live session then shutdown flush executes before exit', async () => {
    const server = createMockHttpServer();
    const io = createMockSocketServer();
    let flushResolved = false;

    const flushLiveSessions = vi.fn(async () => {
      flushResolved = true;
      return {
        flushedRoomCodes: ['DIRTY2'],
        awaitedInFlightRoomCodes: [],
        timedOut: false,
      };
    });
    const exitProcess = vi.fn();

    await runGracefulShutdown('SIGTERM', {
      server: server as unknown as import('node:http').Server,
      io: io as unknown as import('socket.io').Server,
      flushLiveSessions,
      exitProcess,
    });

    expect(flushResolved).toBe(true);
    expect(exitProcess).toHaveBeenCalledWith(0);
  });

  it('continues shutdown when flush times out', async () => {
    const server = createMockHttpServer();
    const io = createMockSocketServer();
    const exitProcess = vi.fn();

    const flushLiveSessions = vi.fn(async () => ({
      flushedRoomCodes: [],
      awaitedInFlightRoomCodes: [],
      timedOut: true,
    }));

    await runGracefulShutdown('SIGINT', {
      server: server as unknown as import('node:http').Server,
      io: io as unknown as import('socket.io').Server,
      flushLiveSessions,
      exitProcess,
    });

    expect(flushLiveSessions).toHaveBeenCalled();
    expect(io.close).toHaveBeenCalled();
    expect(exitProcess).toHaveBeenCalledWith(0);
  });

  it('drains orchestration first and waits for it before closing HTTP, flushing and exiting', async () => {
    const server = createMockHttpServer();
    const io = createMockSocketServer();
    const callOrder: string[] = [];
    const exitProcess = vi.fn(() => { callOrder.push('exit'); });
    let finishDrain!: () => void;
    const drainOrchestration = vi.fn((options: { timeoutMs: number }) => {
      callOrder.push(`drain_start:${options.timeoutMs}`);
      return new Promise<{ drained: boolean; released: boolean }>((resolve) => {
        finishDrain = () => { callOrder.push('drain_done'); resolve({ drained: true, released: true }); };
      });
    });
    server.close.mockImplementation((callback?: (error?: Error) => void) => { callOrder.push('http_close'); callback?.(); });
    io.close.mockImplementation((callback?: () => void) => { callOrder.push('socket_close'); callback?.(); });
    const flushLiveSessions = vi.fn(async () => {
      callOrder.push('flush');
      return { flushedRoomCodes: [], awaitedInFlightRoomCodes: [], timedOut: false };
    });

    const done = runGracefulShutdown('SIGTERM', {
      server: server as any, io: io as any, exitProcess, flushLiveSessions, drainOrchestration, shutdownFlushTimeoutMs: 4321,
    });
    await new Promise((r) => setImmediate(r));
    // The in-flight orchestration is still running: nothing else has closed.
    expect(callOrder).toEqual(['drain_start:4321']);
    expect(io.emit).toHaveBeenCalledWith('server:shutdown', expect.anything());
    finishDrain();
    await done;
    expect(callOrder).toEqual(['drain_start:4321', 'drain_done', 'http_close', 'flush', 'socket_close', 'exit']);
    expect(exitProcess).toHaveBeenCalledWith(0);
  });

  it('a failing orchestration drain does not stop the rest of the shutdown', async () => {
    const server = createMockHttpServer();
    const io = createMockSocketServer();
    const exitProcess = vi.fn();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runGracefulShutdown('SIGTERM', {
      server: server as any,
      io: io as any,
      exitProcess,
      flushLiveSessions: async () => ({ flushedRoomCodes: [], awaitedInFlightRoomCodes: [], timedOut: false }),
      drainOrchestration: async () => { throw new Error('lease rpc down'); },
    });
    expect(server.close).toHaveBeenCalled();
    expect(io.close).toHaveBeenCalled();
    expect(exitProcess).toHaveBeenCalledWith(0);
    errorSpy.mockRestore();
  });
});