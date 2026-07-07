import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  computeResponsiveHandTileSize,
  useResponsiveHandTileSize,
} from './useResponsiveHandTileSize';

describe('computeResponsiveHandTileSize', () => {
  it('landscape wide: single row, size capped at 56', () => {
    expect(computeResponsiveHandTileSize(5, 1200, 800)).toEqual({
      handTileSize: 56,
      handCompactStacked: false,
    });
  });

  it('mobile narrow portrait with >7 tiles: stacked two-row layout', () => {
    expect(computeResponsiveHandTileSize(8, 400, 800)).toEqual({
      handTileSize: 56,
      handCompactStacked: true,
    });
  });

  it('mobile narrow portrait with <=7 tiles: single row, computed width below cap', () => {
    expect(computeResponsiveHandTileSize(5, 320, 600)).toEqual({
      handTileSize: 52,
      handCompactStacked: false,
    });
  });

  it('mobile narrow with >7 tiles: halves effective length for width math', () => {
    expect(computeResponsiveHandTileSize(10, 320, 600)).toEqual({
      handTileSize: 52,
      handCompactStacked: true,
    });
  });
});

describe('useResponsiveHandTileSize', () => {
  let addListenerSpy: Mock;
  let removeListenerSpy: Mock;

  beforeEach(() => {
    addListenerSpy = vi.spyOn(window, 'addEventListener');
    removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  });

  afterEach(() => {
    addListenerSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it('initializes from hand length on mount', () => {
    const { result } = renderHook(() => useResponsiveHandTileSize(5));
    expect(result.current).toEqual({ handTileSize: 52, handCompactStacked: false });
    expect(addListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('recomputes on resize', () => {
    const { result } = renderHook(() => useResponsiveHandTileSize(8));

    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toEqual({ handTileSize: 56, handCompactStacked: true });
  });

  it('removes resize listener on unmount', () => {
    const { unmount } = renderHook(() => useResponsiveHandTileSize(5));
    const handler = addListenerSpy.mock.calls.find((call: unknown[]) => call[0] === 'resize')?.[1];

    unmount();

    expect(handler).toBeTypeOf('function');
    expect(removeListenerSpy).toHaveBeenCalledWith('resize', handler);
  });

  it('skips listener setup when hand length is undefined', () => {
    const { result } = renderHook(() => useResponsiveHandTileSize(undefined));
    expect(result.current).toEqual({ handTileSize: 56, handCompactStacked: false });
    expect(addListenerSpy).not.toHaveBeenCalled();
  });
});