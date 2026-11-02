/**
 * The wire protocol version and its compatibility rule. The implementation lives in `@racehorse/game-core` (protocolVersion.ts), the package both the
 * app and the server build against, so the two cannot disagree; this file keeps the existing import path for the app's code.
 */
export {
  PROTOCOL_VERSION,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  UPGRADE_REQUIRED_ERROR,
  announcedProtocolVersion,
  checkProtocolVersion,
} from '@racehorse/game-core';
export type { ProtocolCheck, UpgradeRequiredPayload } from '@racehorse/game-core';
