// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { incrementalTile, usePlacementFeedback } from './usePlacementFeedback';

const a = { low: 6, high: 6 };
const b = { low: 0, high: 6 };
const c = { low: 0, high: 0 };

describe('presentation placement feedback', () => {
  it('accepts a single addition on either a double or branch without depending on geometry keys', () => {
    expect(incrementalTile([], ['6-6'])).toBe('6-6');
    expect(incrementalTile(['6-6', '0-6'], ['0-0', '0-6', '6-6'])).toBe('0-0');
    expect(incrementalTile(['6-6'], ['1-1', '2-2'])).toBeNull();
    expect(incrementalTile([], ['6-6', '0-6'])).toBeNull();
    expect(incrementalTile(['6-6'], [])).toBeNull();
  });

  it('skips initial hydration, batches, history, recovery and new hands', () => {
    const { result, rerender } = renderHook(({ tiles, hand, enabled }) => usePlacementFeedback(tiles, hand, enabled), {
      initialProps: { tiles: [a], hand: 1, enabled: true },
    });
    expect(result.current).toBeNull();
    rerender({ tiles: [a, b], hand: 1, enabled: true });
    expect(result.current).toBe('0-6');
    rerender({ tiles: [a, b], hand: 1, enabled: true });
    expect(result.current).toBe('0-6');
    rerender({ tiles: [a], hand: 1, enabled: false });
    expect(result.current).toBeNull();
    rerender({ tiles: [a, b], hand: 1, enabled: true });
    expect(result.current).toBeNull();
    rerender({ tiles: [a, b, c], hand: 2, enabled: true });
    expect(result.current).toBeNull();
    rerender({ tiles: [], hand: 2, enabled: true });
    rerender({ tiles: [a, b], hand: 2, enabled: true });
    expect(result.current).toBeNull();
  });
});
