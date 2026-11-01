import { clearLastRoomCode } from '../match/recovery/matchRecovery';
import { clearFritzSession } from '../modules/ghost/fritzSessionStorage';
import { clearDailyFritzClientStorage } from '../dailyFritz/clientStorage';
import { clearReviewWriteOutbox } from '../modules/review/reviewWriteOutbox';
import { PASSWORD_RECOVERY_PENDING_KEY } from './recoveryHash';

const ADMIN_KEY_STORAGE = 'racehorse:daily-fritz-admin-key';

/**
 * Browser state that is bound to the signed-in account (not to the browser) and is consumed as that account's
 * identity: the room to auto-rejoin, the in-flight Fritz/Ghost verified-match ids, Daily Fritz checkpoints and hub
 * cache, the admin shared secret. Cleared whenever the principal changes (sign-out, expiry/revocation, A -> B) so a
 * later account — or a guest — on the same browser cannot resume or submit against the previous account's state.
 * Guest identity and UI preferences are deliberately left alone.
 */
export function clearAccountBoundLocalState(previousUserId: string, nextUserId: string | null): void {
  clearLastRoomCode();
  clearFritzSession();
  clearDailyFritzClientStorage(previousUserId);
  // A finished review waiting to be saved belongs to the account that played it.
  clearReviewWriteOutbox(previousUserId);
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(ADMIN_KEY_STORAGE);
    // A recovery session for the NEXT account sets this marker in the same tick; only drop a stale one on sign-out.
    if (!nextUserId) window.sessionStorage.removeItem(PASSWORD_RECOVERY_PENDING_KEY);
  } catch {
    /* noop */
  }
}
