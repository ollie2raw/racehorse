import { describe, expect, it } from 'vitest';
import { queueJoinErrorMessage } from './useMatchmaking';

describe('queueJoinErrorMessage', () => {
  it('shows a generic try-again for the fail-closed code', () => {
    const message = queueJoinErrorMessage('queue_unavailable');
    expect(message).toMatch(/try again/i);
    expect(message).not.toMatch(/block/i);
  });

  it('keeps existing behaviour for other codes', () => {
    expect(queueJoinErrorMessage('already_queued')).toBe('already_queued');
    expect(queueJoinErrorMessage(undefined)).toBe('Failed to join queue.');
  });
});
