import { describe, expect, it, vi } from 'vitest';
import { MatchEventBus } from './MatchEventBus.ts';

describe('MatchEventBus', () => {
  it('delivers typed and wildcard listeners', () => {
    const bus = new MatchEventBus();
    const typed = vi.fn();
    const wildcard = vi.fn();
    bus.subscribe('HandEnded', typed);
    bus.subscribe('*', wildcard);
    bus.emit({
      type: 'HandEnded',
      handNumber: 2,
      winner: 'you',
      reason: 'domino',
      pointsAwarded: 12,
      gameOver: false,
    });
    expect(typed).toHaveBeenCalledTimes(1);
    expect(wildcard).toHaveBeenCalledTimes(1);
  });
});