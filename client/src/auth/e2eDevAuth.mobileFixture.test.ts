// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { E2E_DEV_BEARER_KEY, E2E_DEV_BEARER_TOKEN, E2E_DEV_USER_ID_KEY, MOBILE_VISUAL_IDENTITY_KEY, readE2eDevAuth, readMobileVisualIdentity } from './e2eDevAuth';

const principal = 'e2e-mobile-user';
const identity = { userId: principal, username: 'racehorse_qa', rating: 1428, friends: [{ id: 'friend-1', userId: 'friend-user', username: 'ace_player', online: true }] };

function seed() {
  localStorage.setItem(E2E_DEV_USER_ID_KEY, principal);
  localStorage.setItem(E2E_DEV_BEARER_KEY, E2E_DEV_BEARER_TOKEN);
  localStorage.setItem(MOBILE_VISUAL_IDENTITY_KEY, JSON.stringify(identity));
}

afterEach(() => { localStorage.clear(); vi.unstubAllEnvs(); });

describe('mobile fixture identity boundary', () => {
  it('serves only the existing E2E principal in development', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    seed();
    expect(readMobileVisualIdentity(principal)).toEqual(identity);
    expect(readMobileVisualIdentity('another-user')).toBeNull();
    localStorage.removeItem(E2E_DEV_BEARER_KEY);
    expect(readMobileVisualIdentity(principal)).toBeNull();
  });

  it('cannot activate in production configuration even with valid fixture storage', () => {
    seed();
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    expect(readE2eDevAuth()).toBeNull();
    expect(readMobileVisualIdentity(principal)).toBeNull();
    vi.stubEnv('DEV', true);
    expect(readE2eDevAuth()).toBeNull();
    expect(readMobileVisualIdentity(principal)).toBeNull();
  });
});
