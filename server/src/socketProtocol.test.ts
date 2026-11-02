import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('./logger', () => ({ childLogger: () => logger, logger }));

const {
  protocolHandshakeMiddleware,
  protocolMode,
  protocolVersionTallies,
  resetProtocolStateForTests,
  PROTOCOL_REFUSAL_LOG_INTERVAL_MS,
} = await import('./socketProtocol');

const OLD_SERVER = { current: 3, minSupported: 2 };
const fakeSocket = (auth?: unknown) => ({ handshake: { auth } }) as never;

beforeEach(() => {
  resetProtocolStateForTests();
  Object.values(logger).forEach((fn) => fn.mockReset());
});

describe('the protocol mode', () => {
  it('is report unless told otherwise, including for an unrecognised value', () => {
    expect(protocolMode({})).toBe('report');
    expect(protocolMode({ PROTOCOL_VERSION_MODE: 'strict' })).toBe('report');
    expect(protocolMode({ PROTOCOL_VERSION_MODE: 'enforce' })).toBe('enforce');
    expect(protocolMode({ PROTOCOL_VERSION_MODE: 'off' })).toBe('off');
  });
});

describe('report mode (the default): count and log, never refuse', () => {
  const middleware = () => protocolHandshakeMiddleware({ server: OLD_SERVER, mode: () => 'report' });

  it('lets a client that is too old through, and logs it', () => {
    const next = vi.fn();
    middleware()(fakeSocket({ protocolVersion: 1 }), next);
    expect(next).toHaveBeenCalledWith();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ announced: 1, minSupported: 2, mode: 'report' });
  });

  it('reads a missing or malformed version as 1, so an old app is counted with the version-1 clients', () => {
    const mw = middleware();
    for (const auth of [undefined, {}, { protocolVersion: 'two' }, { protocolVersion: -3 }, { protocolVersion: 1.5 }, null]) mw(fakeSocket(auth), vi.fn());
    expect(protocolVersionTallies()).toEqual({ '1': 6 });
  });

  it('tallies each announced version and says so the first time one is seen', () => {
    const mw = middleware();
    for (const v of [3, 3, 2, 3, 4]) mw(fakeSocket({ protocolVersion: v }), vi.fn());
    expect(protocolVersionTallies()).toEqual({ '2': 1, '3': 3, '4': 1 });
    // one "first seen" line per distinct version, not one per connection
    const firstSightings = logger.info.mock.calls.filter(([fields]) => 'announced' in fields).map(([fields]) => fields.announced);
    expect(firstSightings.sort()).toEqual([2, 3, 4]);
  });

  it('accepts a client newer than the server without a warning (a rollback or a deploy in progress)', () => {
    const next = vi.fn();
    middleware()(fakeSocket({ protocolVersion: 9 }), next);
    expect(next).toHaveBeenCalledWith();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs a too-old version once per interval, not once per connection', () => {
    let clock = 1_000_000;
    const mw = protocolHandshakeMiddleware({ server: OLD_SERVER, mode: () => 'report', now: () => clock });
    for (let i = 0; i < 5; i += 1) mw(fakeSocket({ protocolVersion: 1 }), vi.fn());
    expect(logger.warn).toHaveBeenCalledTimes(1);
    clock += PROTOCOL_REFUSAL_LOG_INTERVAL_MS;
    mw(fakeSocket({ protocolVersion: 1 }), vi.fn());
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('never refuses at today\'s real minimum: nothing is too old yet', () => {
    const next = vi.fn();
    protocolHandshakeMiddleware({ mode: () => 'enforce' })(fakeSocket(undefined), next);
    expect(next).toHaveBeenCalledWith();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('enforce mode', () => {
  const middleware = () => protocolHandshakeMiddleware({ server: OLD_SERVER, mode: () => 'enforce' });

  it('refuses a client below the minimum with upgrade_required and the payload the app needs', () => {
    const next = vi.fn();
    middleware()(fakeSocket({ protocolVersion: 1 }), next);
    const error = next.mock.calls[0][0] as Error & { data?: unknown };
    expect(error.message).toBe('upgrade_required');
    expect(error.data).toEqual({ code: 'upgrade_required', minSupported: 2, current: 3 });
  });

  it('refuses a client that announces nothing, as the old version-1 app it is', () => {
    const next = vi.fn();
    middleware()(fakeSocket(undefined), next);
    expect((next.mock.calls[0][0] as Error).message).toBe('upgrade_required');
  });

  it('lets a client at the minimum, and a newer one, through', () => {
    for (const v of [2, 3, 7]) {
      const next = vi.fn();
      middleware()(fakeSocket({ protocolVersion: v }), next);
      expect(next).toHaveBeenCalledWith();
    }
  });
});

describe('off', () => {
  it('does no checking and keeps no count', () => {
    const next = vi.fn();
    protocolHandshakeMiddleware({ server: OLD_SERVER, mode: () => 'off' })(fakeSocket({ protocolVersion: 1 }), next);
    expect(next).toHaveBeenCalledWith();
    expect(protocolVersionTallies()).toEqual({});
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('over a real Socket.IO connection', () => {
  let http: HttpServer;
  let ioServer: Server;
  let url: string;
  const clients: ClientSocket[] = [];

  async function startServer(mode: 'report' | 'enforce'): Promise<void> {
    http = createServer();
    ioServer = new Server(http);
    ioServer.use(protocolHandshakeMiddleware({ server: OLD_SERVER, mode: () => mode }));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  }

  const connectWith = (auth?: Record<string, unknown>) => {
    const client = connect(url, { auth, reconnection: false, transports: ['websocket'], forceNew: true });
    clients.push(client);
    return new Promise<{ connected: boolean; message?: string; data?: unknown }>((resolve) => {
      client.on('connect', () => resolve({ connected: true }));
      client.on('connect_error', (error: Error & { data?: unknown }) => resolve({ connected: false, message: error.message, data: error.data }));
    });
  };

  afterEach(async () => {
    clients.splice(0).forEach((client) => client.close());
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
  });

  it('enforce: an old client is refused and the app receives the payload; a current one connects', async () => {
    await startServer('enforce');
    expect(await connectWith({ protocolVersion: 1 })).toEqual({
      connected: false,
      message: 'upgrade_required',
      data: { code: 'upgrade_required', minSupported: 2, current: 3 },
    });
    expect(await connectWith(undefined)).toMatchObject({ connected: false, message: 'upgrade_required' });
    expect(await connectWith({ protocolVersion: 3 })).toEqual({ connected: true });
  });

  it('report: the same old client connects, and is counted', async () => {
    await startServer('report');
    expect(await connectWith({ protocolVersion: 1 })).toEqual({ connected: true });
    expect(await connectWith(undefined)).toEqual({ connected: true });
    expect(protocolVersionTallies()).toEqual({ '1': 2 });
  });
});
