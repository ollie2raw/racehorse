import { io, type Socket } from 'socket.io-client';
import { randomUUID } from 'node:crypto';
import '../src/loadEnv';

type Ack = Record<string, unknown> & { ok?: boolean; error?: string };

const baseUrl = (process.env.MULTIPLAYER_JOURNEY_BASE_URL ?? 'http://127.0.0.1:3101').replace(/\/$/, '');
const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = requiredEnv('SUPABASE_SERVICE_KEY');
const anonKey = requiredEnv('VITE_SUPABASE_ANON_KEY');
const timeoutMs = 30_000;
const userInput = { supabaseUrl, serviceKey, anonKey, timeoutMs };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function createEphemeralUser(input: typeof userInput & { prefix: string }) {
  const email = `${input.prefix}-${randomUUID()}@racehorse-test.invalid`;
  const password = `Rh-${randomUUID()}-Aa9!`;
  const createdResponse = await fetch(`${input.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: input.serviceKey, authorization: `Bearer ${input.serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!createdResponse.ok) throw new Error(`User creation failed: ${createdResponse.status}`);
  const created = await createdResponse.json() as { id?: string };
  const signedResponse = await fetch(`${input.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: input.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!signedResponse.ok) throw new Error(`User sign-in failed: ${signedResponse.status}`);
  const signed = await signedResponse.json() as { access_token?: string };
  if (!created.id || !signed.access_token) throw new Error('Ephemeral user credentials were incomplete.');
  return { id: created.id, accessToken: signed.access_token };
}

async function deleteEphemeralUser(input: { id: string; supabaseUrl: string; serviceKey: string; timeoutMs: number }) {
  const response = await fetch(`${input.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(input.id)}`, {
    method: 'DELETE',
    headers: { apikey: input.serviceKey, authorization: `Bearer ${input.serviceKey}` },
    signal: AbortSignal.timeout(input.timeoutMs),
  });
  if (!response.ok && response.status !== 404) throw new Error(`User cleanup failed: ${response.status}`);
}

function emitAck(socket: Socket, event: string, ...args: unknown[]): Promise<Ack> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out.`)), timeoutMs);
    socket.emit(event, ...args, (response: Ack) => {
      clearTimeout(timer);
      resolve(response ?? {});
    });
  });
}

function connect(): Promise<Socket> {
  const socket = io(baseUrl, { transports: ['websocket'], reconnection: false, autoConnect: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out.')), timeoutMs);
    socket.once('connect_error', reject);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.connect();
  });
}

async function main(): Promise<void> {
  const host = await createEphemeralUser({ ...userInput, prefix: 'mp-journey-host' });
  const guest = await createEphemeralUser({ ...userInput, prefix: 'mp-journey-guest' });
  let hostSocket: Socket | null = null;
  let guestSocket: Socket | null = null;
  try {
    [hostSocket, guestSocket] = await Promise.all([connect(), connect()]);
    const hostIdentity = { username: 'AuthenticatedHost', userId: host.id, authToken: host.accessToken };
    const guestIdentity = { username: 'AuthenticatedGuest', userId: guest.id, authToken: guest.accessToken };

    const [hostPresence, guestPresence] = await Promise.all([
      emitAck(hostSocket, 'presence:identify', hostIdentity),
      emitAck(guestSocket, 'presence:identify', guestIdentity),
    ]);
    if (!hostPresence.ok || !guestPresence.ok) throw new Error('Authenticated presence identify failed.');

    const created = await emitAck(hostSocket, 'room:create', {
      ...hostIdentity,
      skipPregameDraw: true,
    });
    if (!created.ok) throw new Error(`Room creation failed: ${created.error ?? 'unknown'}`);
    const roomCode = String(created.roomCode ?? '');

    const joined = await emitAck(guestSocket, 'room:join', roomCode, guestIdentity);
    if (!joined.ok) throw new Error(`Room join failed: ${joined.error ?? 'unknown'}`);

    const ready = await emitAck(guestSocket, 'player:ready', roomCode);
    if (ready.ok === false) throw new Error(`Guest ready failed: ${ready.error ?? 'unknown'}`);

    const started = await emitAck(hostSocket, 'game:start', roomCode);
    if (!started.ok) throw new Error(`Game start failed: ${started.error ?? 'unknown'}`);

    process.stdout.write(`${JSON.stringify({
      ok: true,
      authenticatedPlayers: 2,
      roomCode,
      matchStarted: true,
      hostUserIdVerified: host.id,
      guestUserIdVerified: guest.id,
    }, null, 2)}\n`);
  } finally {
    hostSocket?.disconnect();
    guestSocket?.disconnect();
    await Promise.all([
      deleteEphemeralUser({ id: host.id, supabaseUrl, serviceKey, timeoutMs }),
      deleteEphemeralUser({ id: guest.id, supabaseUrl, serviceKey, timeoutMs }),
    ]);
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
