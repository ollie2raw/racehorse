import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { io, type Socket } from 'socket.io-client';
import '../src/loadEnv';

type Ack = Record<string, unknown> & { ok?: boolean; error?: string };

const port = Number(process.env.MULTIPLAYER_CHAOS_PORT ?? 3101);
const timeoutMs = Number(process.env.MULTIPLAYER_CHAOS_TIMEOUT_MS ?? 30_000);
const serverUrl = `http://127.0.0.1:${port}`;
const serverEntry = path.resolve(process.cwd(), 'dist/index.js');
const suffix = randomUUID().replace(/-/g, '').slice(0, 12);
const hostIdentity = { userId: `guest_chaos_host_${suffix}`, username: `ChaosHost_${suffix}` };
const guestIdentity = { userId: `guest_chaos_guest_${suffix}`, username: `ChaosGuest_${suffix}` };

function emitAck(socket: Socket, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out.`)), timeoutMs);
    socket.emit(event, ...args, (response: Ack) => {
      clearTimeout(timer);
      resolve(response ?? {});
    });
  });
}

function connect(identity: { userId: string; username: string }): Promise<Socket> {
  const socket = io(serverUrl, { transports: ['websocket'], reconnection: false, autoConnect: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out.')), timeoutMs);
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('connect', async () => {
      try {
        const identified = await emitAck(socket, 'presence:identify', identity);
        if (!identified.ok) throw new Error(`presence:identify failed: ${identified.error ?? 'unknown'}`);
        clearTimeout(timer);
        resolve(socket);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    socket.connect();
  });
}

function waitForState(socket: Socket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('state:update timed out.')), timeoutMs);
    socket.once('state:update', (payload) => {
      clearTimeout(timer);
      resolve(payload as Record<string, unknown>);
    });
  });
}

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${serverUrl}/ping`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server did not become ready at ${serverUrl}.`);
}

function startServer(): ChildProcessWithoutNullStreams {
  const child = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[chaos-server] ${String(chunk)}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[chaos-server] ${String(chunk)}`));
  return child;
}

async function stopServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Server shutdown timed out.')), timeoutMs)),
  ]);
}

async function createStartedRoom(): Promise<{ roomCode: string; sequence: number }> {
  const [host, guest] = await Promise.all([connect(hostIdentity), connect(guestIdentity)]);
  try {
    const created = await emitAck(host, 'room:create', hostIdentity);
    if (!created.ok) throw new Error(`room:create failed: ${created.error ?? 'unknown'}`);
    const roomCode = String(created.roomCode ?? '');
    const joined = await emitAck(guest, 'room:join', roomCode, guestIdentity);
    if (!joined.ok) throw new Error(`room:join failed: ${joined.error ?? 'unknown'}`);
    const guestReady = await emitAck(guest, 'player:ready', roomCode);
    if (guestReady.ok === false) throw new Error(`player:ready failed: ${guestReady.error ?? 'unknown'}`);
    const hostState = waitForState(host);
    const guestState = waitForState(guest);
    const started = await emitAck(host, 'game:start', roomCode);
    if (!started.ok) throw new Error(`game:start failed: ${started.error ?? 'unknown'}`);
    const [hostPayload] = await Promise.all([hostState, guestState]);
    const state = hostPayload.state as Record<string, unknown> | undefined;
    const sequence = Number(state?.sequence);
    if (!Number.isInteger(sequence)) throw new Error('Initial authoritative sequence was missing.');
    return { roomCode, sequence };
  } finally {
    host.disconnect();
    guest.disconnect();
  }
}

async function assertHydratedAfterRestart(roomCode: string, sequence: number): Promise<void> {
  const [host, guest] = await Promise.all([connect(hostIdentity), connect(guestIdentity)]);
  try {
    const hostJoin = await emitAck(host, 'room:join', roomCode, hostIdentity);
    if (!hostJoin.ok || hostJoin.matchStarted !== true) {
      throw new Error(`Host did not hydrate the active room: ${hostJoin.error ?? 'unknown'}`);
    }
    const state = hostJoin.state as Record<string, unknown> | undefined;
    if (Number(state?.sequence) !== sequence) {
      throw new Error(`Hydrated sequence mismatch: expected ${sequence}, received ${String(state?.sequence)}.`);
    }
    const guestJoin = await emitAck(guest, 'room:join', roomCode, guestIdentity);
    if (!guestJoin.ok || guestJoin.matchStarted !== true) {
      throw new Error(`Guest did not reclaim the durable room seat: ${guestJoin.error ?? 'unknown'}`);
    }
  } finally {
    host.disconnect();
    guest.disconnect();
  }
}

async function main(): Promise<void> {
  let child = startServer();
  try {
    await waitForServer();
    const checkpoint = await createStartedRoom();
    await stopServer(child);
    child = startServer();
    await waitForServer();
    await assertHydratedAfterRestart(checkpoint.roomCode, checkpoint.sequence);
    process.stdout.write(`${JSON.stringify({ ok: true, ...checkpoint, recovery: 'durable_hydration' })}\n`);
  } finally {
    await stopServer(child).catch((error) => {
      process.stderr.write(`Final server shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
