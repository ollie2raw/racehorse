import { describe, it, expect } from 'vitest';
import { normalizeRoomPlayers } from './roomProtocol';

describe('normalizeRoomPlayers', () => {
  it('returns empty array for empty input', () => {
    expect(normalizeRoomPlayers([])).toEqual([]);
  });

  it('keeps duplicate ids as separate entries', () => {
    const input = [
      { id: 'a', username: 'Alice', userId: null },
      { id: 'b', username: 'Bob', userId: null },
      { id: 'a', username: 'Alice2', userId: null },
    ];
    const result = normalizeRoomPlayers(input);
    expect(result.filter((p) => p.id === 'a')).toHaveLength(2);
  });

  it('preserves all unique players', () => {
    const input = [
      { id: 'a', username: 'Alice', userId: null },
      { id: 'b', username: 'Bob', userId: null },
    ];
    expect(normalizeRoomPlayers(input)).toHaveLength(2);
  });
});