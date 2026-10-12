import { describe, expect, it } from 'vitest';
import { opponentDisconnectCopy } from './opponentDisconnectCopy';

describe('opponent disconnect copy', () => {
  it('tournament rooms: the turn clock, no reconnect deadline, no forfeit', () => {
    const copy = opponentDisconnectCopy({ graceMs: null, policy: 'turn_clock' });
    expect(copy).toBe('Opponent disconnected. The match continues on the turn clock.');
    expect(copy).not.toMatch(/\d+s|second|forfeit/i);
  });
  it('ordinary rooms keep the reconnect grace copy', () => {
    expect(opponentDisconnectCopy({ graceMs: 30_000 })).toBe('Opponent disconnected. Waiting up to 30s…');
    expect(opponentDisconnectCopy({})).toBe('Opponent disconnected. Waiting up to 30s…');
  });
});
