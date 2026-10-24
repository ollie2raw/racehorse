import { beforeEach, describe, expect, it } from 'vitest';
import { clearAccountBoundLocalState } from './accountBoundLocalState';
import { LAST_ROOM_STORAGE_KEY, GUEST_ID_STORAGE_KEY } from '../match/recovery/matchRecovery';
import { PASSWORD_RECOVERY_PENDING_KEY } from './recoveryHash';

describe('clearAccountBoundLocalState', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem(LAST_ROOM_STORAGE_KEY, 'ABCD');
    window.localStorage.setItem(GUEST_ID_STORAGE_KEY, 'guest_keep');
    window.localStorage.setItem('racehorse:daily-fritz:v3:attempt-1:game:1', '{}');
    window.sessionStorage.setItem('rh_fritz_session', '{"localMatchId":"m","verifiedMatchId":"v"}');
    window.sessionStorage.setItem('racehorse:daily-fritz:today:user-a', '{}');
    window.sessionStorage.setItem('racehorse:daily-fritz-admin-key', 'secret');
    window.sessionStorage.setItem(PASSWORD_RECOVERY_PENDING_KEY, '1');
  });

  it('sign-out drops every account-bound key but keeps the guest identity', () => {
    clearAccountBoundLocalState('user-a', null);
    expect(window.localStorage.getItem(LAST_ROOM_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem('racehorse:daily-fritz:v3:attempt-1:game:1')).toBeNull();
    expect(window.sessionStorage.getItem('rh_fritz_session')).toBeNull();
    expect(window.sessionStorage.getItem('racehorse:daily-fritz:today:user-a')).toBeNull();
    expect(window.sessionStorage.getItem('racehorse:daily-fritz-admin-key')).toBeNull();
    expect(window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY)).toBeNull();
    expect(window.localStorage.getItem(GUEST_ID_STORAGE_KEY)).toBe('guest_keep');
  });

  it('an A -> B switch keeps the new account\'s recovery marker', () => {
    clearAccountBoundLocalState('user-a', 'user-b');
    expect(window.localStorage.getItem(LAST_ROOM_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem('rh_fritz_session')).toBeNull();
    expect(window.sessionStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY)).toBe('1');
  });
});
