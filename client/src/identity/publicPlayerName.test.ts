import { describe, expect, it } from 'vitest';
import { ANONYMOUS_PLAYER_NAME, publicPlayerName } from './publicPlayerName';
import { fallbackProfileFor } from '../auth/useAuth';

const EMAIL = 'jane.doe.private@example.com';
const LOCAL_PART = 'jane.doe.private';
const USER_ID = '7f3c2a10-9b8e-4d21-a5c4-0e1f2a3b4c5d';

describe('publicPlayerName (Phase 4A.1)', () => {
  it('uses the real profile username', () => {
    expect(publicPlayerName('racer_jane')).toBe('racer_jane');
    expect(publicPlayerName('  racer_jane  ')).toBe('racer_jane');
  });

  it('is Player when there is no profile username', () => {
    for (const missing of [null, undefined, '', '   ']) expect(publicPlayerName(missing)).toBe(ANONYMOUS_PLAYER_NAME);
    expect(ANONYMOUS_PLAYER_NAME).toBe('Player');
  });
});

describe('the auth fallback profile (profile not loaded yet / request failed)', () => {
  it('is Player — never the email, its local part, or a user-id fragment', () => {
    const profile = fallbackProfileFor({ id: USER_ID, email: EMAIL } as never);
    expect(profile).toEqual({ id: USER_ID, username: 'Player' });
    expect(profile.username).not.toContain(LOCAL_PART);
    expect(profile.username).not.toContain('jane');
    expect(profile.username).not.toContain(USER_ID.replace(/-/g, '').slice(0, 8));
  });
});
