// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Board } from './Board.tsx';
import { FIXTURES } from './board/boardRoutingFixtures.ts';

let containerHeight = 756;

function mockContainer() {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        width: 1456,
        height: containerHeight,
        top: 0,
        left: 0,
        right: 1456,
        bottom: containerHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
}

function mockShortViewport(short: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: short && query.includes('max-height: 430px'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }));
}

/** left: calc(50% +/- Npx) -> signed N, per tile key. */
function tileXs(container: HTMLElement): Map<string, number> {
  const xs = new Map<string, number>();
  container.querySelectorAll<HTMLElement>('.board-tile-wrapper').forEach((el) => {
    const match = /([+-])\s*([\d.]+)px/.exec(el.style.left);
    xs.set(el.dataset.layoutKey ?? '', match ? Number(`${match[1]}${match[2]}`) : 0);
  });
  return xs;
}

const armXs = (xs: Map<string, number>, arm: number) =>
  [...xs.entries()]
    .filter(([key]) => key.startsWith(`branch-0-${arm}-`))
    .sort(([a], [b]) => Number(a.split('-')[3]) - Number(b.split('-')[3]))
    .map(([, x]) => x);

const renderBoard = (props: { staticView?: boolean } = {}) =>
  render(
    <Board board={FIXTURES.longUp()} legalMoves={[]} selectedTile={null} onPositionClick={() => undefined} tileSize={84} {...props} />,
  );

beforeEach(() => {
  containerHeight = 756;
  mockContainer();
  mockShortViewport(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Board routing integration', () => {
  it('turns a long arm sideways once the container is measured', () => {
    const { container } = renderBoard();
    const xs = armXs(tileXs(container), 0);
    expect(xs).toHaveLength(9);
    // 756px container -> reach limit 13.6 units: five tiles straight (same x), then the run moves right.
    expect(new Set(xs.slice(0, 5)).size).toBe(1);
    expect(xs[5]).toBeGreaterThan(xs[4]);
    expect(xs[8]).toBeGreaterThan(xs[5]);
  });

  it('keeps the same arm straight while the container is unmeasured', () => {
    containerHeight = 0;
    const { container } = renderBoard();
    expect(new Set(armXs(tileXs(container), 0)).size).toBe(1);
  });

  it('keeps static diagram boards straight regardless of the container', () => {
    const { container } = renderBoard({ staticView: true });
    expect(new Set(armXs(tileXs(container), 0)).size).toBe(1);
  });

  it('uses the tile-count rule, not the container, on a phone-landscape viewport', () => {
    mockShortViewport(true);
    const { container } = renderBoard();
    const xs = armXs(tileXs(container), 0);
    expect(new Set(xs.slice(0, 2)).size).toBe(1); // two tiles straight
    expect(xs[2]).toBeGreaterThan(xs[1]); // third turns
  });
});
