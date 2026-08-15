import { describe, expect, it } from 'vitest';
import {
  FRIEND_CHALLENGE_EXPIRY_MS,
  isChallengeButtonDisabled,
} from './friendChallenge';

describe('durable friend challenges', () => {
  it('allows an offline friend to be selected because delivery is durable', () => {
    expect(isChallengeButtonDisabled('idle', 'offline')).toBe(false);
    expect(isChallengeButtonDisabled('idle', 'in_game')).toBe(true);
  });

  it('keeps pending invitations long enough for reconnect delivery', () => {
    expect(FRIEND_CHALLENGE_EXPIRY_MS).toBe(5 * 60_000);
  });
});
