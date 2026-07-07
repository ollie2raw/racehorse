import { describe, expect, it } from 'vitest';
import { formatGhostName } from './botMatchViewFormatters.tsx';

describe('formatGhostName', () => {
  it('strips ghost suffixes and prefixes with @', () => {
    expect(formatGhostName("Alice's Ghost")).toBe('@Alice');
    expect(formatGhostName('@bob Ghost')).toBe('@Bob');
  });
});