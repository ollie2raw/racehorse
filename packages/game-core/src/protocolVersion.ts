/**
 * Version of the live-match wire protocol (the socket events between the app and the server), and the one rule for what to do when a client
 * announces a version.
 *
 * It lives here, in the package both the app and the server already build against, so the two cannot disagree about it. `match-protocol`
 * re-exports it for the app's code.
 *
 * How it travels: the app announces `PROTOCOL_VERSION` in the socket handshake (`auth.protocolVersion`); the server runs `checkProtocolVersion` on
 * it as the connection is accepted (server/src/socketProtocol.ts). It starts report-only (PROTOCOL_VERSION_MODE), so a client that is too old is
 * counted and logged before anyone is ever refused.
 *
 * Bump `PROTOCOL_VERSION` when a change would make an old client misbehave against a new server or the reverse: an event renamed or removed, a payload
 * field that becomes required, a changed meaning. Adding an optional field or a new event the old side can ignore does not need a bump. Raise
 * `MIN_SUPPORTED_PROTOCOL_VERSION` only when the server genuinely stops serving the older shape; every client below it then gets `upgrade_required`
 * instead of a half-working match.
 */
export const PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

/** The error message a refused connection carries; the app turns it into "update to keep playing". */
export const UPGRADE_REQUIRED_ERROR = 'upgrade_required';

/** What the server tells a client it will not serve, so the app can say "Update to keep playing" instead of failing quietly. */
export type UpgradeRequiredPayload = {
  readonly code: 'upgrade_required';
  /** The oldest protocol version the server still serves. */
  readonly minSupported: number;
  /** The version the server speaks. */
  readonly current: number;
};

export type ProtocolCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'upgrade_required'; readonly payload: UpgradeRequiredPayload }
  /** The client is NEWER than this server (a rollback, or a deploy that has not finished): do not reject, the client decides. */
  | { readonly ok: true; readonly note: 'client_newer' };

/**
 * Whether a server speaking `server.current` (serving back to `server.minSupported`) should accept a client that announced `clientVersion`. A client
 * that announces nothing is an old client, treated as version 1 so today's apps keep working until the server is deliberately moved past them. Anything
 * that is not a positive integer is also treated as version 1: a malformed handshake must never lock a player out.
 */
export function checkProtocolVersion(
  clientVersion: unknown,
  server: { current: number; minSupported: number } = { current: PROTOCOL_VERSION, minSupported: MIN_SUPPORTED_PROTOCOL_VERSION },
): ProtocolCheck {
  const announced = Number.isInteger(clientVersion) && (clientVersion as number) > 0 ? (clientVersion as number) : 1;
  if (announced < server.minSupported) {
    return {
      ok: false,
      reason: 'upgrade_required',
      payload: { code: 'upgrade_required', minSupported: server.minSupported, current: server.current },
    };
  }
  if (announced > server.current) return { ok: true, note: 'client_newer' };
  return { ok: true };
}

/** What the client announced, as a number for tallying: a missing or malformed value counts as the oldest protocol, version 1, as the check treats it. */
export function announcedProtocolVersion(clientVersion: unknown): number {
  return Number.isInteger(clientVersion) && (clientVersion as number) > 0 ? (clientVersion as number) : 1;
}
