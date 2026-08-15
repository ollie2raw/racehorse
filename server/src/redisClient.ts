import Redis from 'ioredis';
import { childLogger } from './logger';

const log = childLogger('redis');

/**
 * Redis is optional in local/dev (single-process, in-memory fallbacks apply).
 * In production it is required for cross-instance Socket.io state and rate limiting —
 * Vercel Fluid Compute runs multiple instances, so without Redis, matchmaking/game
 * state and rate limits would silently fragment per-instance.
 */
export const REDIS_URL = process.env.REDIS_URL?.trim() || null;

let pubClient: Redis | null = null;
let subClient: Redis | null = null;
let dataClient: Redis | null = null;

export function isRedisConfigured(): boolean {
  return Boolean(REDIS_URL);
}

function createClient(name: string): Redis {
  const client = new Redis(REDIS_URL as string, {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
  client.on('error', (err) => {
    log.error({ err, client: name }, 'redis client error');
  });
  client.on('connect', () => {
    log.info({ client: name }, 'redis client connected');
  });
  return client;
}

/** Pub/sub pair for @socket.io/redis-adapter. Returns null when REDIS_URL is unset. */
export function getSocketIoPubSubClients(): { pubClient: Redis; subClient: Redis } | null {
  if (!REDIS_URL) return null;
  if (!pubClient) pubClient = createClient('socket.io:pub');
  if (!subClient) subClient = createClient('socket.io:sub');
  return { pubClient, subClient };
}

/** General-purpose client for the Redis-backed rate limiter. Returns null when REDIS_URL is unset. */
export function getRedisDataClient(): Redis | null {
  if (!REDIS_URL) return null;
  if (!dataClient) dataClient = createClient('data');
  return dataClient;
}
