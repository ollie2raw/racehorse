/**
 * Version of the live-match wire protocol (the socket events between the app and the server).
 *
 * NOT ENFORCED YET: nothing sends it and nothing rejects on it. This file fixes the rule so the client and the server can adopt
 * it independently and in either order (roadmap 1.13 here; the handshake enforcement is 3.4, after the server freeze).
 *
 * Bump `PROTOCOL_VERSION` when a change would make an old client misbehave against a new server or the reverse: an event
 * renamed or removed, a payload field that becomes required, a changed meaning. Adding an optional field or a new event the
 * old side can ignore does not need a bump. Raise `MIN_SUPPORTED_PROTOCOL_VERSION` only when the server genuinely stops
 * serving the older shape; every client below it then gets `upgrade_required` instead of a half-working match.
 */
export const PROTOCOL_VERSION = 1;
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

/** What the server tells a client it will not serve, so the app can show "Update to keep playing" instead of failing quietly. */
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
 * Whether a server speaking `serverVersion` (serving back to `minSupported`) should accept a client that announced
 * `clientVersion`. A client that announces nothing is an old client, treated as version 1 so today's apps keep working
 * until the server is deliberately moved past it. Anything that is not a positive integer is also treated as version 1: a
 * malformed header must never lock a player out.
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
