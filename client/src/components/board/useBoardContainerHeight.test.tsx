// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEIGHT_BUCKET_PX } from './boardRouting';
import { useBoardContainerHeight } from './useBoardContainerHeight';

let measured = 756;
let measuredWidth = 1456;
let notify: (() => void) | null = null;

function Probe({ enabled = true }: { enabled?: boolean }) {
  const { containerRef, containerHeight, wideContainer } = useBoardContainerHeight(enabled);
  return <div ref={containerRef} data-testid="probe" data-height={containerHeight} data-wide={String(wideContainer)} />;
}

const heightOf = (el: HTMLElement) => Number(el.getAttribute('data-height'));

beforeEach(() => {
  measured = 756;
  notify = null;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width: 1456, height: measured, top: 0, left: 0, right: 1456, bottom: measured, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        notify = cb;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useBoardContainerHeight', () => {
  it('measures before first paint and reports the bucketed height', () => {
    const { getByTestId } = render(<Probe />);
    expect(heightOf(getByTestId('probe'))).toBe(Math.floor(756 / HEIGHT_BUCKET_PX) * HEIGHT_BUCKET_PX);
  });

  it('ignores resizes inside one bucket and follows them across a bucket edge', () => {
    const { getByTestId } = render(<Probe />);
    const start = heightOf(getByTestId('probe'));
    act(() => {
      measured = 756 + 8; // same bucket
      notify?.();
    });
    expect(heightOf(getByTestId('probe'))).toBe(start);
    act(() => {
      measured = 756 + HEIGHT_BUCKET_PX * 2; // next bucket and beyond
      notify?.();
    });
    expect(heightOf(getByTestId('probe'))).toBeGreaterThan(start);
  });

  it('reports 0 when disabled (static views) so routing never engages', () => {
    const { getByTestId } = render(<Probe enabled={false} />);
    expect(heightOf(getByTestId('probe'))).toBe(0);
  });

  it('reports 0 for an unmeasured (zero-height) container', () => {
    measured = 0;
    const { getByTestId } = render(<Probe />);
    expect(heightOf(getByTestId('probe'))).toBe(0);
  });

  it('reports whether the container is desktop-class wide, and follows it across the threshold', () => {
    const wideOf = (el: HTMLElement) => el.getAttribute('data-wide');
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(
      () => ({ width: measuredWidth, height: measured, top: 0, left: 0, right: measuredWidth, bottom: measured, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    measuredWidth = 1456;
    const { getByTestId } = render(<Probe />);
    expect(wideOf(getByTestId('probe'))).toBe('true');
    act(() => {
      measuredWidth = 700;
      notify?.();
    });
    expect(wideOf(getByTestId('probe'))).toBe('false');
  });

  it('is never wide when disabled', () => {
    measuredWidth = 1456;
    const { getByTestId } = render(<Probe enabled={false} />);
    expect(getByTestId('probe').getAttribute('data-wide')).toBe('false');
  });
});
