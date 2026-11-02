import {
  announcedProtocolVersion,
  checkProtocolVersion,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  UPGRADE_REQUIRED_ERROR,
  type UpgradeRequiredPayload,
} from '@racehorse/game-core';
import type { Socket } from 'socket.io';
import { childLogger } from './logger';

/**
 * The wire protocol version, checked as a socket connects (roadmap 3.4).
 *
 * The app announces its version in the handshake (`auth.protocolVersion`). What happens next is `PROTOCOL_VERSION_MODE`:
 *
 *   report   (default)  count and log it, never refuse. Today's apps announce nothing or 1, and the server's own minimum is 1, so nothing is ever
 *                       "too old" yet; this is how the distribution of versions in the field becomes visible before anyone relies on it.
 *   enforce             a client below the server's minimum is refused with `upgrade_required` (and the payload the app needs to say so).
 *   off                 no check.
 *
 * A missing or malformed value is read as version 1 (checkProtocolVersion), so an old app or a bad handshake can never lock a player out by itself.
 */

const log = childLogger('protocol');

export type ProtocolMode = 'off' | 'report' | 'enforce';

export function protocolMode(env: Record<string, string | undefined> = process.env): ProtocolMode {
  const value = env.PROTOCOL_VERSION_MODE;
  return value === 'off' || value === 'enforce' ? value : 'report';
}

/** How many connections announced each version (a missing value counts as 1) since the process started. */
const connectionsByVersion = new Map<number, number>();
const seenVersions = new Set<number>();
const lastRefusalLogAt = new Map<number, number>();
export const PROTOCOL_REFUSAL_LOG_INTERVAL_MS = 60_000;

export function protocolVersionTallies(): Record<string, number> {
  return Object.fromEntries([...connectionsByVersion].map(([version, count]) => [String(version), count]));
}

export function resetProtocolStateForTests(): void {
  connectionsByVersion.clear();
  seenVersions.clear();
  lastRefusalLogAt.clear();
}

type Handshake = { auth?: { protocolVersion?: unknown } };

export type ProtocolServerSide = { current: number; minSupported: number };

export function protocolHandshakeMiddleware(
  options: { server?: ProtocolServerSide; now?: () => number; mode?: () => ProtocolMode } = {},
): (socket: Socket, next: (error?: Error) => void) => void {
  const server = options.server ?? { current: PROTOCOL_VERSION, minSupported: MIN_SUPPORTED_PROTOCOL_VERSION };
  const now = options.now ?? Date.now;
  const modeOf = options.mode ?? (() => protocolMode());

  return (socket, next) => {
    const mode = modeOf();
    if (mode === 'off') {
      next();
      return;
    }

    const raw = (socket.handshake as Handshake | undefined)?.auth?.protocolVersion;
    const version = announcedProtocolVersion(raw);
    connectionsByVersion.set(version, (connectionsByVersion.get(version) ?? 0) + 1);
    if (!seenVersions.has(version)) {
      seenVersions.add(version);
      // The first sighting of each version is the whole point of report mode: it says what is out there.
      log.info({ announced: version, sent: raw !== undefined, serverCurrent: server.current, serverMin: server.minSupported }, 'a client announced a protocol version for the first time since boot');
    }

    const result = checkProtocolVersion(raw, server);
    if (result.ok) {
      next();
      return;
    }

    const at = now();
    const last = lastRefusalLogAt.get(version);
    if (last === undefined || at - last >= PROTOCOL_REFUSAL_LOG_INTERVAL_MS) {
      lastRefusalLogAt.set(version, at);
      log.warn({ announced: version, minSupported: server.minSupported, mode }, mode === 'enforce' ? 'client protocol too old: refused' : 'client protocol too old (report only: allowed)');
    }

    if (mode === 'enforce') {
      const error = new Error(UPGRADE_REQUIRED_ERROR) as Error & { data?: UpgradeRequiredPayload };
      error.data = result.payload;
      next(error);
      return;
    }
    next();
  };
}
