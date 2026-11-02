import { UPGRADE_REQUIRED_ERROR } from '@racehorse/match-protocol';

/**
 * What a refused connection means to the player (roadmap 3.4). The server refuses a client whose wire-protocol version is below its minimum with a
 * `connect_error` whose message is `upgrade_required`. That is not "the server is waking up": retrying will never help, and the honest message is
 * that this copy of the app needs updating.
 */
export const UPGRADE_REQUIRED_TEXT = 'This version of Racehorse is out of date. Update the app to keep playing online.';

export function isUpgradeRequiredError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { message?: unknown }).message === UPGRADE_REQUIRED_ERROR;
}
