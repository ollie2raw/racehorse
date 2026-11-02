import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoardOpenEndsPill } from './BoardOpenEndsPill';

/**
 * On the installed phone app in landscape the OPEN pill is drawn into the HUD's meta slot instead of over the board
 * (components/board/useHudMetaSlot.ts, docs/board-camera-baseline.md). Anywhere else it stays where it always was.
 */

const SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 430px)';

function mockViewport(shortLandscape: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === SHORT_LANDSCAPE ? shortLandscape : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderWithSlot() {
  return render(
    <div>
      <div data-ui="hud-meta-slot" data-testid="slot" />
      <div data-testid="board">
        <BoardOpenEndsPill board={null} openEndsSum={0} />
      </div>
    </div>,
  );
}

describe('BoardOpenEndsPill HUD slot', () => {
  beforeEach(() => document.documentElement.classList.remove('rh-native'));
  afterEach(() => {
    document.documentElement.classList.remove('rh-native');
    vi.unstubAllGlobals();
  });

  it('is drawn into the HUD slot on the installed app in short landscape', () => {
    document.documentElement.classList.add('rh-native');
    mockViewport(true);
    const { getByTestId } = renderWithSlot();
    expect(getByTestId('slot').querySelector('.open-ends-pill')).not.toBeNull();
    expect(getByTestId('board').querySelector('.open-ends-pill')).toBeNull();
  });

  it('is drawn into the HUD slot on a phone\'s browser in short landscape too (the web-phone class)', () => {
    document.documentElement.classList.add('rh-web-phone');
    mockViewport(true);
    const { getByTestId } = renderWithSlot();
    expect(getByTestId('slot').querySelector('.open-ends-pill')).not.toBeNull();
    expect(getByTestId('board').querySelector('.open-ends-pill')).toBeNull();
    document.documentElement.classList.remove('rh-web-phone');
  });

  it('stays on the board in a desktop browser, even in a short landscape window', () => {
    mockViewport(true);
    const { getByTestId } = renderWithSlot();
    expect(getByTestId('board').querySelector('.open-ends-pill')).not.toBeNull();
    expect(getByTestId('slot').querySelector('.open-ends-pill')).toBeNull();
  });

  it('stays on the board in the installed app when the viewport is not short landscape (portrait, a tablet)', () => {
    document.documentElement.classList.add('rh-native');
    mockViewport(false);
    const { getByTestId } = renderWithSlot();
    expect(getByTestId('board').querySelector('.open-ends-pill')).not.toBeNull();
    expect(getByTestId('slot').querySelector('.open-ends-pill')).toBeNull();
  });

  it('falls back to the board when there is no slot to draw into', () => {
    document.documentElement.classList.add('rh-native');
    mockViewport(true);
    const { getByTestId } = render(
      <div data-testid="board">
        <BoardOpenEndsPill board={null} openEndsSum={0} />
      </div>,
    );
    expect(getByTestId('board').querySelector('.open-ends-pill')).not.toBeNull();
  });

  it('shows the same count wherever it is drawn', () => {
    document.documentElement.classList.add('rh-native');
    mockViewport(true);
    const { getByTestId } = renderWithSlot();
    expect(getByTestId('slot').querySelector('.open-ends-pill')?.getAttribute('aria-label')).toBe('0 open ends');
  });
});
